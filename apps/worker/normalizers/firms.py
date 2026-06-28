"""Normalization helpers for NASA FIRMS VIIRS CSV rows.

Source verified 2026-06-22:
https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_SouthEast_Asia_24h.csv

Mapping:
- event_id = firms_<acq_date>_<acq_time>_<lat>_<lon>
- source = nasa_firms
- event_type = wildfire
- magnitude = min(frp / 50.0, 10.0)
- place = Hotspot <lat> <lon>
- time = ISO 8601 from acq_date + acq_time (HHMM)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from models.event import EarthquakeEvent


def normalize_firms_row(row: dict[str, Any]) -> EarthquakeEvent:
    """Convert one FIRMS CSV row into the canonical event schema."""

    latitude = float(row.get("latitude") or 0.0)
    longitude = float(row.get("longitude") or 0.0)
    acq_date = str(row.get("acq_date") or "")
    acq_time = str(row.get("acq_time") or "").zfill(4)
    frp = float(row.get("frp") or 0.0)

    event_id = f"firms_{acq_date}_{acq_time}_{latitude:.3f}_{longitude:.3f}"
    magnitude = min(frp / 50.0, 10.0)
    place = _format_place(latitude, longitude)
    time_str = _parse_firms_time(acq_date, acq_time)

    return EarthquakeEvent(
        event_id=event_id,
        source="nasa_firms",
        event_type="wildfire",
        magnitude=magnitude,
        latitude=latitude,
        longitude=longitude,
        place=place,
        time=time_str,
        url="https://firms.modaps.eosdis.nasa.gov/",
        created_at=datetime.now(timezone.utc).isoformat(),
    )


def confidence_score(raw_confidence: Any) -> int:
    """Map FIRMS confidence to a comparable 0-100 score.

    NOAA-20 VIIRS archive CSV uses string buckets (`low`, `nominal`, `high`).
    Some FIRMS variants emit numeric strings. We normalize both forms so the
    connector can apply the spec's `confidence >= 70` rule consistently.
    """

    text = str(raw_confidence or "").strip().lower()
    if not text:
        return 0
    if text.isdigit():
        return int(text)
    if text == "low":
        return 30
    if text == "nominal":
        return 70
    if text == "high":
        return 90
    return 0


def _parse_firms_time(acq_date: str, acq_time: str) -> str:
    if not acq_date:
        return datetime.now(timezone.utc).isoformat()

    try:
        dt = datetime.strptime(f"{acq_date} {acq_time.zfill(4)}", "%Y-%m-%d %H%M")
        return dt.replace(tzinfo=timezone.utc).isoformat()
    except (ValueError, TypeError):
        return datetime.now(timezone.utc).isoformat()


def _format_place(latitude: float, longitude: float) -> str:
    lat_suffix = "N" if latitude >= 0 else "S"
    lon_suffix = "E" if longitude >= 0 else "W"
    return f"Hotspot {abs(latitude):.2f}°{lat_suffix} {abs(longitude):.2f}°{lon_suffix}"
