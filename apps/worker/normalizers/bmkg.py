"""Normalization helpers for BMKG earthquake payloads.

BMKG provides three JSON feeds:
  * autogempa.json      — latest single event (any magnitude)
  * gempaterkini.json   — 15 most recent M5.0+ events
  * gempadirasakan.json — 15 most recent felt events

All three share the same event object shape under ``Infogempa.gempa``.
This module converts that shape into the canonical ``EarthquakeEvent`` schema.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

from models.event import EarthquakeEvent


def _parse_coordinates(raw: str) -> tuple[float, float]:
    """Parse a ``"lat,lon"`` BMKG coordinate string into (lat, lon) floats."""

    parts = raw.split(",")
    if len(parts) != 2:
        raise ValueError(f"Invalid BMKG coordinates: {raw!r}")
    return float(parts[0].strip()), float(parts[1].strip())


def _generate_event_id(payload: dict[str, Any]) -> str:
    """Build a deterministic BMKG event ID from DateTime + coordinates.

    BMKG feeds do not expose a stable upstream identifier, so we derive one
    from the fields least likely to change post-publication: the exact
    event timestamp and the epicenter coordinates. This keeps the source
    prefix deterministic and prevents accidental cross-source collisions.
    """

    fingerprint = "|".join(
        [
            str(payload.get("DateTime") or ""),
            str(payload.get("Coordinates") or ""),
        ]
    )
    digest = hashlib.sha1(fingerprint.encode("utf-8")).hexdigest()[:12]
    return f"bmkg:{digest}"


def normalize_bmkg_event(payload: dict[str, Any]) -> EarthquakeEvent:
    """Convert a single BMKG ``gempa`` object into the canonical event schema.

    Raises ``ValueError`` if the coordinate string is missing or malformed.
    """

    coords_raw = str(payload.get("Coordinates") or "")
    latitude, longitude = _parse_coordinates(coords_raw)

    magnitude = float(payload.get("Magnitude") or 0.0)
    time_str = str(payload.get("DateTime") or "")
    # BMKG already returns ISO 8601 with offset; validate it parses.
    datetime.fromisoformat(time_str)

    wilayah = str(payload.get("Wilayah") or "").strip()
    potensi = str(payload.get("Potensi") or "").strip()
    # ``Wilayah`` is the human-readable location summary used for place
    # matching against exposure-rule keywords. ``Potensi`` (tsunami
    # potential) is preserved in the ``url`` field for now — it is a
    # free-text string that does not fit the canonical schema yet.
    place = wilayah
    if potensi and potensi not in place:
        place = f"{place} ({potensi})"

    return EarthquakeEvent(
        event_id=_generate_event_id(payload),
        source="bmkg",
        event_type="earthquake",
        magnitude=magnitude,
        latitude=latitude,
        longitude=longitude,
        place=place,
        time=time_str,
        url="",
        created_at=datetime.now(timezone.utc).isoformat(),
    )


def normalize_bmkg_feed(payload: dict[str, Any]) -> list[EarthquakeEvent]:
    """Normalize a full BMKG JSON feed payload into canonical events.

    Handles both the single-event shape (``autogempa.json`` — ``gempa`` is an
    object) and the list shape (``gempaterkini`` / ``gempadirasakan`` —
    ``gempa`` is an array). Invalid entries are skipped with a warning
    rather than aborting the whole batch.
    """

    import logging

    log = logging.getLogger(__name__)

    infogempa = payload.get("Infogempa") or {}
    raw = infogempa.get("gempa")
    if raw is None:
        return []

    entries = raw if isinstance(raw, list) else [raw]

    events: list[EarthquakeEvent] = []
    for entry in entries:
        try:
            events.append(normalize_bmkg_event(entry))
        except (ValueError, TypeError) as exc:
            log.warning("Skipping malformed BMKG entry: %s", exc)
    return events
