"""Normalization helpers for upstream event payloads."""

from __future__ import annotations

from datetime import datetime, timezone

from models.event import EarthquakeEvent


def merge_events_by_proximity(
    primary: list[EarthquakeEvent],
    secondary: list[EarthquakeEvent],
    precision: int = 1,
) -> list[EarthquakeEvent]:
    """Merge two event lists, dropping secondary events that coincide with a
    primary event location.

    Used to combine overlapping hazard sources (e.g. GVP and GDACS both report
    the same volcano) without duplicating map markers. ``primary`` is always
    retained in full; a secondary event is dropped when its coordinates round —
    at ``precision`` decimal places (~11 km at precision 1) — to the same bucket
    as any primary event. ``primary`` should be the fresher/preferred source.
    """

    occupied = {
        (round(ev.latitude, precision), round(ev.longitude, precision))
        for ev in primary
    }
    merged = list(primary)
    for ev in secondary:
        bucket = (round(ev.latitude, precision), round(ev.longitude, precision))
        if bucket in occupied:
            continue
        occupied.add(bucket)
        merged.append(ev)
    return merged


def normalize_usgs_feature(feature: dict) -> EarthquakeEvent:
    """Convert a USGS GeoJSON feature into the canonical earthquake event schema."""

    geometry = feature.get("geometry") or {}
    coordinates = geometry.get("coordinates")
    if not coordinates or len(coordinates) < 2:
        raise ValueError("USGS feature is missing valid geometry coordinates.")

    properties = feature.get("properties") or {}
    magnitude = float(properties.get("mag") or 0.0)
    epoch_ms = properties.get("time") or 0
    event_time = datetime.fromtimestamp(epoch_ms / 1000, tz=timezone.utc).isoformat()

    return EarthquakeEvent(
        event_id=f"usgs:{feature['id']}",
        source="usgs",
        event_type="earthquake",
        magnitude=magnitude,
        latitude=coordinates[1],
        longitude=coordinates[0],
        place=properties.get("place") or "",
        time=event_time,
        url=properties.get("url") or "",
        created_at=datetime.now(timezone.utc).isoformat(),
    )
