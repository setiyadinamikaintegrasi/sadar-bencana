"""Database helpers for EWS subscribers, preferences, and watch zones."""

from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

# ── Subscribers ──────────────────────────────────────────────

_LOAD_ACTIVE_SUBSCRIBERS_SQL = """
SELECT id, name, email, phone_whatsapp, telegram_chat_id, role
FROM ews_subscribers
WHERE is_active = TRUE
"""


async def fetch_active_subscribers(
    pool: asyncpg.Pool,
) -> list[dict[str, Any]]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(_LOAD_ACTIVE_SUBSCRIBERS_SQL)
    return [dict(r) for r in rows]


# ── Notification Preferences ─────────────────────────────────

_LOAD_PREFS_SQL = """
SELECT channel, min_severity, alert_types, quiet_hours_start, quiet_hours_end, is_enabled
FROM ews_notification_prefs
WHERE subscriber_id = $1 AND is_enabled = TRUE
"""


async def fetch_subscriber_prefs(
    pool: asyncpg.Pool, subscriber_id: UUID
) -> list[dict[str, Any]]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(_LOAD_PREFS_SQL, subscriber_id)
    return [dict(r) for r in rows]


# ── Watch Zones ──────────────────────────────────────────────

_LOAD_ACTIVE_ZONES_SQL = """
SELECT id, subscriber_id, label, latitude, longitude,
       radius_km, peril_types, min_magnitude
FROM ews_watch_zones
WHERE is_active = TRUE
"""


async def fetch_active_watch_zones(
    pool: asyncpg.Pool,
) -> list[dict[str, Any]]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(_LOAD_ACTIVE_ZONES_SQL)
    return [dict(r) for r in rows]


# ── Notification Log ─────────────────────────────────────────

_INSERT_LOG_SQL = """
INSERT INTO ews_notification_log
    (subscriber_id, alert_id, channel, status, error_message, sent_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id
"""


async def log_notification(
    pool: asyncpg.Pool,
    subscriber_id: UUID,
    alert_id: UUID | None,
    channel: str,
    status: str,
    error_message: str | None = None,
    sent_at: Any = None,
) -> UUID | None:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            _INSERT_LOG_SQL,
            subscriber_id, alert_id, channel, status,
            error_message, sent_at,
        )
    return row["id"] if row else None


# ── Dedup: check if already notified ─────────────────────────

_CHECK_ALREADY_NOTIFIED_SQL = """
SELECT 1 FROM ews_notification_log
WHERE subscriber_id = $1 AND alert_id = $2 AND channel = $3
    AND status IN ('sent','pending')
LIMIT 1
"""


async def is_already_notified(
    pool: asyncpg.Pool,
    subscriber_id: UUID,
    alert_id: UUID,
    channel: str,
) -> bool:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            _CHECK_ALREADY_NOTIFIED_SQL, subscriber_id, alert_id, channel
        )
    return row is not None
