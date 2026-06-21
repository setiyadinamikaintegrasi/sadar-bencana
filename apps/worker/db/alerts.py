"""Persistence helpers for the ``alerts`` table."""

from __future__ import annotations

import asyncpg

_HAS_ALERT_SQL = """
SELECT 1
FROM alerts
WHERE event_id = $1 AND alert_type = $2
LIMIT 1
"""

_CREATE_ALERT_SQL = """
INSERT INTO alerts (event_id, alert_type, severity, message)
VALUES ($1, $2, $3, $4)
RETURNING id, event_id, alert_type, severity, message, acknowledged, created_at
"""

_GET_RECENT_ALERTS_SQL = """
SELECT id, event_id, alert_type, severity, message, acknowledged, created_at
FROM alerts
ORDER BY created_at DESC
LIMIT $1
"""


async def has_alert(pool: asyncpg.Pool, event_id: str, alert_type: str) -> bool:
    """Return True when an alert already exists for the event/type pair."""

    async with pool.acquire() as conn:
        row = await conn.fetchrow(_HAS_ALERT_SQL, event_id, alert_type)
    return row is not None


async def create_alert(
    pool: asyncpg.Pool,
    event_id: str,
    alert_type: str,
    severity: str,
    message: str,
) -> dict[str, object]:
    """Insert an alert row and return the created record."""

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            _CREATE_ALERT_SQL,
            event_id,
            alert_type,
            severity,
            message,
        )
    return dict(row) if row is not None else {}


async def get_recent_alerts(pool: asyncpg.Pool, limit: int = 50) -> list[dict[str, object]]:
    """Fetch recent alerts ordered by newest first."""

    async with pool.acquire() as conn:
        rows = await conn.fetch(_GET_RECENT_ALERTS_SQL, limit)
    return [dict(row) for row in rows]
