"""Create or deduplicate alerts from geolocated news items."""

from __future__ import annotations

import logging

import asyncpg

logger = logging.getLogger(__name__)

PERIL_SEVERITY: dict[str, str] = {
    "volcano": "Critical",
    "flood": "High",
    "wildfire": "High",
    "earthquake": "High",
}


def _geo_bucket(peril: str, lat: float, lon: float) -> str:
    """Return a rounded geo bucket string for dedup."""
    return f"{peril}:{round(lat, 1)}:{round(lon, 1)}"


async def process_news_alerts(
    pool: asyncpg.Pool, news_item, db_uuid: str
) -> None:
    """For each peril tag on a geolocated item: insert alert or increment source_count."""
    if news_item.lat is None or not news_item.perils:
        return

    async with pool.acquire() as conn:
        for peril in news_item.perils:
            bucket = _geo_bucket(peril, news_item.lat, news_item.lon)
            severity = PERIL_SEVERITY.get(peril, "High")

            existing = await conn.fetchrow(
                "SELECT id FROM alerts WHERE geo_bucket = $1 AND acknowledged = FALSE",
                bucket,
            )
            if existing:
                await conn.execute(
                    "UPDATE alerts SET source_count = source_count + 1 WHERE id = $1",
                    existing["id"],
                )
            else:
                await conn.execute(
                    """INSERT INTO alerts
                         (news_item_id, alert_type, severity, message, geo_bucket, source_count)
                       VALUES ($1::uuid, 'news_signal', $2, $3, $4, 1)
                       ON CONFLICT DO NOTHING""",
                    db_uuid,
                    severity,
                    f"[{news_item.source.upper()}] {news_item.title[:200]}",
                    bucket,
                )
                logger.info("Created news_signal alert for bucket %s", bucket)


__all__ = [
    "PERIL_SEVERITY",
    "_geo_bucket",
    "process_news_alerts",
]
