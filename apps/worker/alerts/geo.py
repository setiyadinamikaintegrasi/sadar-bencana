"""Geographic matching for EWS watch zones."""

from __future__ import annotations

import math
import json
from typing import Any

_EARTH_RADIUS_KM = 6371.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate great-circle distance between two points in km."""
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return _EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def zone_matches(
    zone: dict[str, Any],
    event_lat: float,
    event_lon: float,
    peril_type: str | None,
    magnitude: float,
    event_data: dict[str, Any] | None = None,
) -> bool:
    """Check if an event falls within a watch zone's criteria."""
    # Peril filter
    zone_perils = zone.get("peril_types") or []
    if zone_perils and peril_type and peril_type not in zone_perils:
        return False
    if not _threshold_matches(zone, peril_type, magnitude, event_data or {}):
        return False
    # Distance filter
    dist = haversine_km(
        event_lat, event_lon,
        float(zone["latitude"]), float(zone["longitude"]),
    )
    return dist <= float(zone["radius_km"])


def _threshold_config(zone: dict[str, Any]) -> dict[str, Any]:
    raw = zone.get("thresholds")
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return raw if isinstance(raw, dict) else {}


def _flood_depth_level(depth_cm: float) -> float:
    if depth_cm < 70:
        return 1.0
    if depth_cm < 150:
        return 2.0
    if depth_cm < 300:
        return 3.0
    return 4.0


def _threshold_matches(
    zone: dict[str, Any],
    peril_type: str | None,
    magnitude: float,
    event_data: dict[str, Any],
) -> bool:
    thresholds = _threshold_config(zone)
    if not thresholds:
        legacy = zone.get("min_magnitude")
        return legacy is None or magnitude >= float(legacy)

    config = thresholds.get(peril_type or "")
    if not isinstance(config, dict):
        return True

    if peril_type == "earthquake":
        minimum = float(config.get("min_magnitude", 0))
        return magnitude >= minimum

    if peril_type == "flood":
        minimum_depth = float(config.get("min_depth_cm", 0))
        actual_depth = event_data.get("flood_depth_cm")
        if actual_depth is not None:
            return float(actual_depth) >= minimum_depth
        if event_data.get("source") == "petabencana":
            return magnitude >= _flood_depth_level(minimum_depth)
        return False

    if peril_type == "volcano":
        minimum_level = float(config.get("min_activity_level", 1))
        actual_level = event_data.get("activity_level", magnitude)
        return float(actual_level) >= minimum_level

    if peril_type == "wildfire":
        minimum_frp = float(config.get("min_frp", 0))
        actual_frp = event_data.get("frp")
        if actual_frp is None and event_data.get("source") == "nasa_firms":
            actual_frp = magnitude * 50
        if actual_frp is None:
            return False
        return float(actual_frp) >= minimum_frp

    return True


def find_matching_subscriber_ids(
    zones: list[dict[str, Any]],
    event_lat: float,
    event_lon: float,
    peril_type: str | None,
    magnitude: float,
    event_data: dict[str, Any] | None = None,
) -> set[str]:
    """Return set of subscriber IDs whose zones match the event."""
    matched: set[str] = set()
    for zone in zones:
        if zone_matches(
            zone,
            event_lat,
            event_lon,
            peril_type,
            magnitude,
            event_data,
        ):
            matched.add(str(zone["subscriber_id"]))
    return matched
