"""Persistence helpers for the news_items table."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Sequence

import asyncpg

logger = logging.getLogger(__name__)

_UPSERT_SQL = """
INSERT INTO news_items (
    item_id,
    source,
    title,
    summary,
    url,
    published_at,
    perils,
    lat,
    lon,
    place_name
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (source, item_id) DO UPDATE
SET
    title        = EXCLUDED.title,
    summary      = EXCLUDED.summary,
    url          = EXCLUDED.url,
    published_at = EXCLUDED.published_at,
    perils       = EXCLUDED.perils,
    lat          = EXCLUDED.lat,
    lon          = EXCLUDED.lon,
    place_name   = EXCLUDED.place_name
RETURNING id, item_id
"""

_FETCH_SQL = """
SELECT id, item_id, source, title, summary, url, published_at, perils,
       lat, lon, place_name, created_at
FROM news_items
ORDER BY published_at DESC NULLS LAST
LIMIT $1
"""


def _parse_published_at(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


async def upsert_news_items(pool: asyncpg.Pool, items: Sequence[Any]) -> dict[str, str]:
    """Upsert news items and return {item_id: db_uuid} for all affected rows."""
    if not items:
        return {}

    id_map: dict[str, str] = {}
    async with pool.acquire() as conn:
        for item in items:
            row = await conn.fetchrow(
                _UPSERT_SQL,
                item.item_id,
                item.source,
                item.title,
                item.summary,
                item.url,
                _parse_published_at(item.published_at),
                item.perils,
                getattr(item, "lat", None),
                getattr(item, "lon", None),
                getattr(item, "place_name", None),
            )
            if row is None:
                continue

            item_id = row["item_id"] if "item_id" in row else item.item_id
            row_id = row["id"] if "id" in row else None
            if row_id is not None:
                id_map[str(item_id)] = str(row_id)

    logger.info("Upserted %d/%d news items", len(id_map), len(items))
    return id_map


async def fetch_news(pool: asyncpg.Pool, limit: int = 100) -> list[dict]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(_FETCH_SQL, limit)
    return [dict(r) for r in rows]
