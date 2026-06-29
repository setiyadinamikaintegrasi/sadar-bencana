"""Create or deduplicate alerts from geolocated news items."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg

logger = logging.getLogger(__name__)

NEWS_ALERT_MAX_AGE = timedelta(hours=6)
NEWS_ALERT_FUTURE_SKEW = timedelta(minutes=15)
UNVERIFIED_SEVERITY = "Moderate"

CORROBORATED_PERIL_SEVERITY: dict[str, str] = {
    "volcano": "High",
    "flood": "High",
    "wildfire": "High",
    "earthquake": "High",
    "fire": "High",
}

NON_INCIDENT_TERMS = (
    "simulasi",
    "latihan",
    "uji coba",
    "drill",
    "edukasi",
    "sejarah bencana",
    "peringatan hari",
)


def _geo_bucket(peril: str, lat: float, lon: float) -> str:
    """Return a rounded geo bucket string for dedup."""
    return f"{peril}:{round(lat, 1)}:{round(lon, 1)}"


def _as_utc_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _is_recent_news_item(news_item: Any, now: datetime | None = None) -> bool:
    """Accept only items inside the safety freshness window."""
    published_at = _as_utc_datetime(getattr(news_item, "published_at", None))
    if published_at is None:
        return False
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    age = current - published_at
    return -NEWS_ALERT_FUTURE_SKEW <= age <= NEWS_ALERT_MAX_AGE


def _is_incident_report(news_item: Any) -> bool:
    """Reject obvious drills, education pieces, and historical retrospectives."""
    text = " ".join(
        str(getattr(news_item, field, "") or "")
        for field in ("title", "summary")
    ).lower()
    return not any(term in text for term in NON_INCIDENT_TERMS)


async def process_news_alerts(
    pool: asyncpg.Pool,
    news_item: Any,
    db_uuid: str,
    now: datetime | None = None,
) -> None:
    """Create conservative news signals and promote only independent corroboration."""
    if news_item.lat is None or not news_item.perils:
        return
    if not _is_recent_news_item(news_item, now):
        logger.info("Skipping stale or invalid news alert candidate: %s", news_item.title)
        return
    if not _is_incident_report(news_item):
        logger.info("Skipping non-incident news alert candidate: %s", news_item.title)
        return

    async with pool.acquire() as conn:
        for peril in news_item.perils:
            bucket = _geo_bucket(peril, news_item.lat, news_item.lon)
            source = str(news_item.source).lower()

            existing = await conn.fetchrow(
                """SELECT id, source_names
                   FROM alerts
                  WHERE geo_bucket = $1 AND acknowledged = FALSE""",
                bucket,
            )
            if existing:
                existing_sources = set(existing["source_names"] or [])
                if source in existing_sources:
                    continue
                severity = CORROBORATED_PERIL_SEVERITY.get(peril, "High")
                await conn.execute(
                    """UPDATE alerts
                          SET source_names = array_append(source_names, $2),
                              source_count = source_count + 1,
                              verification_status = 'corroborated',
                              severity = $3
                        WHERE id = $1
                          AND NOT ($2 = ANY(source_names))""",
                    existing["id"],
                    source,
                    severity,
                )
            else:
                await conn.execute(
                    """INSERT INTO alerts
                         (news_item_id, alert_type, severity, message, geo_bucket,
                          source_count, verification_status, source_names)
                       VALUES ($1::uuid, 'news_signal', $2, $3, $4, 1,
                               'unverified', ARRAY[$5]::text[])
                       ON CONFLICT DO NOTHING""",
                    db_uuid,
                    UNVERIFIED_SEVERITY,
                    f"[{news_item.source.upper()}] {news_item.title[:200]}",
                    bucket,
                    source,
                )
                logger.info("Created unverified news_signal alert for bucket %s", bucket)


__all__ = [
    "CORROBORATED_PERIL_SEVERITY",
    "NEWS_ALERT_MAX_AGE",
    "NON_INCIDENT_TERMS",
    "UNVERIFIED_SEVERITY",
    "_geo_bucket",
    "_is_incident_report",
    "_is_recent_news_item",
    "process_news_alerts",
]
