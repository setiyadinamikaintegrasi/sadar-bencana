"""Normalization helpers for PetaBencana.id flood reports.

PetaBencana (https://data.petabencana.id) returns GeoJSON FeatureCollections of
geolocated, government-confirmed disaster reports. Flood reports carry a
``report_data.flood_depth`` (centimetres) which we map onto the same 1–4 proxy
magnitude scale used for GDACS floods. The feed mixes disaster types, so callers
must filter on ``disaster_type == "flood"``.

> **Verified 2026-06-25.** Real-time Indonesia source; empty during the dry
> season, populated during the Nov–Mar wet season.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from typing import Any

from models.event import EarthquakeEvent

# Default proxy magnitude for a confirmed flood report with no depth datum.
_DEFAULT_FLOOD_MAGNITUDE = 2.0


def normalize_petabencana_feature(feature: dict[str, Any]) -> EarthquakeEvent:
    """Convert a PetaBencana flood GeoJSON feature into the canonical schema."""

    properties: dict[str, Any] = feature.get("properties") or {}
    geometry: dict[str, Any] = feature.get("geometry") or {}
    coords = geometry.get("coordinates") or []

    longitude = float(coords[0]) if len(coords) >= 2 else 0.0
    latitude = float(coords[1]) if len(coords) >= 2 else 0.0

    pkey = str(properties.get("pkey") or "")
    if pkey:
        event_id = f"petabencana_{pkey}"
    else:
        digest = hashlib.sha1(f"{latitude},{longitude}".encode()).hexdigest()[:16]
        event_id = f"petabencana_{digest}"

    magnitude = _flood_depth_magnitude(properties.get("report_data"))

    raw_text = (properties.get("title") or properties.get("text") or "").strip()
    place = raw_text or "Banjir (PetaBencana)"

    time_str = _parse_iso_time(properties.get("created_at"))

    report_uuid = properties.get("url") or ""
    url = f"https://petabencana.id/reports/{report_uuid}" if report_uuid else "https://petabencana.id"

    return EarthquakeEvent(
        event_id=event_id,
        source="petabencana",
        event_type="flood",
        magnitude=magnitude,
        latitude=latitude,
        longitude=longitude,
        place=place,
        time=time_str,
        url=url,
        created_at=datetime.now(timezone.utc).isoformat(),
    )


def _flood_depth_magnitude(report_data: Any) -> float:
    """Map ``flood_depth`` (cm) onto a 1–4 proxy magnitude."""

    if not isinstance(report_data, dict):
        return _DEFAULT_FLOOD_MAGNITUDE

    depth = report_data.get("flood_depth")
    if depth is None:
        return _DEFAULT_FLOOD_MAGNITUDE

    try:
        depth_cm = float(depth)
    except (ValueError, TypeError):
        return _DEFAULT_FLOOD_MAGNITUDE

    if depth_cm < 70:
        return 1.0
    if depth_cm < 150:
        return 2.0
    if depth_cm < 300:
        return 3.0
    return 4.0


def _parse_iso_time(raw: Any) -> str:
    """Best-effort parse of PetaBencana ``created_at`` → ISO 8601 string."""

    if not raw:
        return datetime.now(timezone.utc).isoformat()
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        return dt.isoformat()
    except (ValueError, TypeError):
        return datetime.now(timezone.utc).isoformat()
