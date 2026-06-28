"""Geographic matching for EWS watch zones."""

from __future__ import annotations

import math
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
) -> bool:
    """Check if an event falls within a watch zone's criteria."""
    # Peril filter
    zone_perils = zone.get("peril_types") or []
    if zone_perils and peril_type and peril_type not in zone_perils:
        return False
    # Magnitude filter
    if magnitude < float(zone.get("min_magnitude", 5.0)):
        return False
    # Distance filter
    dist = haversine_km(
        event_lat, event_lon,
        float(zone["latitude"]), float(zone["longitude"]),
    )
    return dist <= float(zone["radius_km"])


def find_matching_subscriber_ids(
    zones: list[dict[str, Any]],
    event_lat: float,
    event_lon: float,
    peril_type: str | None,
    magnitude: float,
) -> set[str]:
    """Return set of subscriber IDs whose zones match the event."""
    matched: set[str] = set()
    for zone in zones:
        if zone_matches(zone, event_lat, event_lon, peril_type, magnitude):
            matched.add(str(zone["subscriber_id"]))
    return matched
