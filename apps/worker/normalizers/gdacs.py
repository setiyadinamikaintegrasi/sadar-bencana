"""Normalization helpers for GDACS (Global Disaster Alert System) event payloads.

GDACS returns GeoJSON FeatureCollections. Both Flood (FL) and Volcano (VO)
share the same response structure — only the ``eventlist`` query parameter
differs. This module provides a single :func:`normalize_gdacs_feature` that
maps any GDACS feature onto the canonical :class:`~models.event.EarthquakeEvent`.

Mapping rules (verified 2026-06-22):

Flood (``event_type="flood"``):
    alertscore (0.0–3.0) → magnitude = clamp(round(alertscore), 1, 4)

Volcano (``event_type="volcano"``):
    alertlevel → magnitude:  Green=1, Orange=3, Red=4

The ``event_id`` is namespaced as ``gdacs_fl_<eventid>`` or ``gdacs_vo_<eventid>``
so it never collides with earthquake ``event_id`` values from BMKG/USGS.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from typing import Any

from models.event import EarthquakeEvent

# GDACS alert-level → numeric magnitude mapping for volcano events.
_VOLCANO_ALERT_MAP: dict[str, float] = {
    "green": 1.0,
    "orange": 3.0,
    "red": 4.0,
}


def normalize_gdacs_feature(
    feature: dict[str, Any], event_type: str
) -> EarthquakeEvent:
    """Convert a GDACS GeoJSON feature into the canonical event schema.

    Args:
        feature: A single ``features[]`` entry from a GDACS FeatureCollection.
        event_type: Either ``"flood"`` or ``"volcano"``.

    Returns:
        A populated :class:`EarthquakeEvent` with GDACS-derived ``event_id``
        and ``source`` fields.
    """

    properties: dict[str, Any] = feature.get("properties") or {}
    geometry: dict[str, Any] = feature.get("geometry") or {}
    raw_coords = geometry.get("coordinates") or []

    # GDACS sometimes puts lat/lon in properties, sometimes in geometry.
    latitude = float(properties.get("latitude") or (raw_coords[1] if len(raw_coords) >= 2 else 0.0))
    longitude = float(properties.get("longitude") or (raw_coords[0] if len(raw_coords) >= 2 else 0.0))

    # Determine the 2-letter GDACS event prefix (fl / vo).
    prefix_code = "fl" if event_type == "flood" else "vo"
    source = f"gdacs_{prefix_code}"
    place = properties.get("name") or ""

    # Extract the GDACS eventid and build the canonical event_id.
    gdacs_event_id = str(properties.get("eventid") or "")
    event_id = (
        f"{source}_{gdacs_event_id}"
        if gdacs_event_id
        else f"{source}_{hashlib.sha1(f'{latitude},{longitude},{place}'.encode()).hexdigest()[:16]}"
    )

    # Map alert data → magnitude (proxy scale 1–4 for GDACS events).
    magnitude = _gdacs_magnitude(properties, event_type)

    # Parse the event time. GDACS uses ``todate`` (ISO 8601 or dd/MM/yyyy).
    raw_time = properties.get("todate") or properties.get("fromdate") or ""
    time_str = _parse_gdacs_time(raw_time)

    raw_url = properties.get("url") or ""
    if isinstance(raw_url, dict):
        url = str(raw_url.get("report") or raw_url.get("details") or "")
    else:
        url = str(raw_url)

    return EarthquakeEvent(
        event_id=event_id,
        source=source,
        event_type=event_type,
        magnitude=magnitude,
        latitude=latitude,
        longitude=longitude,
        place=place,
        time=time_str,
        url=url,
        created_at=datetime.now(timezone.utc).isoformat(),
    )


def _gdacs_magnitude(props: dict[str, Any], event_type: str) -> float:
    """Map GDACS alert fields onto a 1–4 proxy magnitude."""

    if event_type == "flood":
        alertscore = float(props.get("alertscore") or 0.0)
        return max(1.0, min(4.0, round(alertscore)))

    if event_type == "volcano":
        alertlevel = str(props.get("alertlevel") or "green").lower()
        return _VOLCANO_ALERT_MAP.get(alertlevel, 1.0)

    return 0.0


def _parse_gdacs_time(raw: str) -> str:
    """Best-effort parse of GDACS date fields → ISO 8601 string.

    GDACS ``todate`` is usually ISO 8601 (e.g. ``2026-06-22T00:00:00.000Z``)
    but can be ``dd/MM/yyyy``.  We pass through valid ISO strings and fall
    back to ``now()`` for unparseable values.
    """

    if not raw:
        return datetime.now(timezone.utc).isoformat()

    # Already ISO 8601?
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt.isoformat()
    except (ValueError, TypeError):
        pass

    # Try dd/MM/yyyy (GDACS legacy format).
    try:
        dt = datetime.strptime(raw, "%d/%m/%Y")
        return dt.replace(tzinfo=timezone.utc).isoformat()
    except (ValueError, TypeError):
        pass

    return datetime.now(timezone.utc).isoformat()
