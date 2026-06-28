"""Persistence helpers for the connector_health table."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import asyncpg

logger = logging.getLogger(__name__)

_UPSERT_SQL = """
INSERT INTO connector_health (name, last_polled_at, items_fetched, error_message, updated_at)
VALUES ($1, $2, $3, $4, now())
ON CONFLICT (name) DO UPDATE SET
    last_polled_at = EXCLUDED.last_polled_at,
    items_fetched  = EXCLUDED.items_fetched,
    error_message  = EXCLUDED.error_message,
    updated_at     = now()
"""


async def upsert_connector_health(
    pool: asyncpg.Pool,
    name: str,
    items_fetched: int,
    error_message: str | None = None,
) -> None:
    now = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        await conn.execute(_UPSERT_SQL, name, now, items_fetched, error_message)
    logger.debug(
        "connector_health upserted: %s items=%d err=%s", name, items_fetched, error_message
    )
