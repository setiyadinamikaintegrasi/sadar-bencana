"""Normalization helpers for Smithsonian GVP Weekly Volcanic Activity Report.

The GVP feed (https://volcano.si.edu/news/WeeklyVolcanoRSS.xml) is a standard
RSS 2.0 document with one ``<item>`` per volcano reported that week. Each item
carries a ``<georss:point>`` (``"lat lon"``), a ``<guid>`` ending in
``#vn_<number>`` (the Smithsonian volcano number), and a description that often
states the PVMBG Alert Level (``"Level N (on a scale of 1-4)"``).

This module maps a parsed item dict onto the canonical
:class:`~models.event.EarthquakeEvent`, mirroring :mod:`normalizers.gdacs`.

> **Verified 2026-06-25.** Updated by 2300 UTC every Thursday. Indonesia is
> consistently represented (7 volcanoes in the latest report), so GVP provides
> fresher volcano signal than the sparse GDACS VO feed.
"""

from __future__ import annotations

from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import hashlib
import re

from models.event import EarthquakeEvent

# Default proxy magnitude for a reported-but-unscored volcano. GVP weekly
# reports list notable ongoing activity; on the GDACS 1–4 proxy scale that is
# a moderate "Orange"-equivalent signal.
_DEFAULT_VOLCANO_MAGNITUDE = 2.0

_VN_RE = re.compile(r"vn_(\d+)")
_ALERT_LEVEL_RE = re.compile(r"Level\s+(\d)\s*\(on a scale of 1-4\)", re.IGNORECASE)


def normalize_gvp_item(item: dict[str, str]) -> EarthquakeEvent:
    """Convert a parsed GVP RSS item into the canonical event schema.

    Args:
        item: Mapping with ``title``, ``description``, ``guid``, ``link``,
            ``pubDate`` and ``point`` ("lat lon") string values.

    Returns:
        A populated :class:`EarthquakeEvent` with ``source="gvp"`` and
        ``event_type="volcano"``.
    """

    title = (item.get("title") or "").strip()
    # Volcano name is the leading segment before the " (Country)" qualifier.
    place = title.split(" (", 1)[0].strip()

    latitude, longitude = _parse_point(item.get("point") or "")

    guid = item.get("guid") or ""
    vn_match = _VN_RE.search(guid)
    if vn_match:
        event_id = f"gvp_{vn_match.group(1)}"
    else:
        digest = hashlib.sha1(place.encode()).hexdigest()[:16]
        event_id = f"gvp_{digest}"

    magnitude = _gvp_magnitude(item.get("description") or "")
    time_str = _parse_rss_time(item.get("pubDate") or "")
    url = guid or item.get("link") or ""

    return EarthquakeEvent(
        event_id=event_id,
        source="gvp",
        event_type="volcano",
        magnitude=magnitude,
        latitude=latitude,
        longitude=longitude,
        place=place,
        time=time_str,
        url=url,
        created_at=datetime.now(timezone.utc).isoformat(),
    )


def _parse_point(raw: str) -> tuple[float, float]:
    """Parse a GeoRSS ``"lat lon"`` string into ``(latitude, longitude)``."""

    parts = raw.split()
    if len(parts) >= 2:
        try:
            return float(parts[0]), float(parts[1])
        except (ValueError, TypeError):
            pass
    return 0.0, 0.0


def _gvp_magnitude(description: str) -> float:
    """Map a PVMBG Alert Level in the description onto a 1–4 proxy magnitude."""

    match = _ALERT_LEVEL_RE.search(description)
    if match:
        return float(match.group(1))
    return _DEFAULT_VOLCANO_MAGNITUDE


def _parse_rss_time(raw: str) -> str:
    """Best-effort parse of an RFC 822 RSS ``pubDate`` → ISO 8601 string."""

    if not raw:
        return datetime.now(timezone.utc).isoformat()
    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc)
        return dt.isoformat()
    except (ValueError, TypeError):
        return datetime.now(timezone.utc).isoformat()
