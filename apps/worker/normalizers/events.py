"""Normalization helpers for upstream event payloads."""

from __future__ import annotations

from datetime import datetime, timezone

from models.event import EarthquakeEvent


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
