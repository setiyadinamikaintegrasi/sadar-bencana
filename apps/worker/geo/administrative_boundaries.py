"""Validated GeoJSON boundary import and dependency-free point lookup."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Iterable

SUPPORTED_LEVELS = {"province", "regency", "district", "village"}


def _rings(geometry: dict[str, Any]) -> Iterable[list[list[float]]]:
    kind = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if kind == "Polygon" and isinstance(coordinates, list):
        yield coordinates
    elif kind == "MultiPolygon" and isinstance(coordinates, list):
        yield from coordinates
    else:
        raise ValueError("boundary geometry must be Polygon or MultiPolygon")


def geometry_bbox(geometry: dict[str, Any]) -> tuple[float, float, float, float]:
    points = [
        point
        for polygon in _rings(geometry)
        for ring in polygon
        for point in ring
        if isinstance(point, list) and len(point) >= 2
    ]
    if not points:
        raise ValueError("boundary geometry has no coordinates")
    longitudes = [float(point[0]) for point in points]
    latitudes = [float(point[1]) for point in points]
    return min(longitudes), min(latitudes), max(longitudes), max(latitudes)


def _inside_ring(longitude: float, latitude: float, ring: list[list[float]]) -> bool:
    inside = False
    previous = ring[-1]
    for current in ring:
        x1, y1 = float(previous[0]), float(previous[1])
        x2, y2 = float(current[0]), float(current[1])
        crosses = (y1 > latitude) != (y2 > latitude)
        if crosses and longitude < (x2 - x1) * (latitude - y1) / (y2 - y1) + x1:
            inside = not inside
        previous = current
    return inside


def point_in_geometry(longitude: float, latitude: float, geometry: dict[str, Any]) -> bool:
    for polygon in _rings(geometry):
        if not polygon or not _inside_ring(longitude, latitude, polygon[0]):
            continue
        if not any(_inside_ring(longitude, latitude, hole) for hole in polygon[1:]):
            return True
    return False


def parse_boundary_geojson(
    payload: dict[str, Any],
    *,
    code_field: str,
    name_field: str,
    level: str,
    parent_field: str | None,
    source_name: str,
    dataset_version: str,
) -> list[dict[str, Any]]:
    if payload.get("type") != "FeatureCollection" or not isinstance(payload.get("features"), list):
        raise ValueError("boundary payload must be a GeoJSON FeatureCollection")
    if level not in SUPPORTED_LEVELS:
        raise ValueError("unsupported administrative boundary level")
    if not source_name.strip() or not dataset_version.strip():
        raise ValueError("boundary source and dataset version are required")

    boundaries: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, feature in enumerate(payload["features"], start=1):
        properties = feature.get("properties") if isinstance(feature, dict) else None
        geometry = feature.get("geometry") if isinstance(feature, dict) else None
        if not isinstance(properties, dict) or not isinstance(geometry, dict):
            raise ValueError(f"feature {index} is missing properties or geometry")
        code = str(properties.get(code_field, "")).strip()
        name = str(properties.get(name_field, "")).strip()
        if not code or not name:
            raise ValueError(f"feature {index} is missing code or name")
        if code in seen:
            raise ValueError(f"duplicate administrative code: {code}")
        seen.add(code)
        min_lon, min_lat, max_lon, max_lat = geometry_bbox(geometry)
        canonical = json.dumps(geometry, sort_keys=True, separators=(",", ":"))
        boundaries.append({
            "code": code,
            "name": name,
            "level": level,
            "parent_code": str(properties.get(parent_field, "")).strip() or None if parent_field else None,
            "geometry": geometry,
            "min_longitude": min_lon,
            "min_latitude": min_lat,
            "max_longitude": max_lon,
            "max_latitude": max_lat,
            "geometry_checksum": hashlib.sha256(canonical.encode()).hexdigest(),
            "source_name": source_name.strip(),
            "dataset_version": dataset_version.strip(),
        })
    return boundaries


def resolve_boundary(
    longitude: float,
    latitude: float,
    boundaries: Iterable[dict[str, Any]],
) -> dict[str, Any] | None:
    matches = [
        boundary for boundary in boundaries
        if boundary["min_longitude"] <= longitude <= boundary["max_longitude"]
        and boundary["min_latitude"] <= latitude <= boundary["max_latitude"]
        and point_in_geometry(longitude, latitude, boundary["geometry"])
    ]
    if not matches:
        return None
    rank = {"village": 4, "district": 3, "regency": 2, "province": 1}
    return max(matches, key=lambda item: rank.get(item["level"], 0))


__all__ = [
    "geometry_bbox",
    "parse_boundary_geojson",
    "point_in_geometry",
    "resolve_boundary",
]

