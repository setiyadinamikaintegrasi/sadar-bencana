"""Persistence and lifecycle operations for authoritative alert revisions."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

import asyncpg

from models.official_alert import OfficialAlertInput

_RETURNING_COLUMNS = """
id, source, source_alert_id, revision, message_type, status, sent_at,
effective_at, expires_at, headline, description, area_geojson, raw_payload,
payload_checksum, previous_alert_id, is_current, ingested_at
"""

_FIND_PAYLOAD_SQL = f"""
SELECT {_RETURNING_COLUMNS}
FROM official_alerts
WHERE source = $1 AND source_alert_id = $2 AND payload_checksum = $3
LIMIT 1
"""

_FIND_CURRENT_SQL = f"""
SELECT {_RETURNING_COLUMNS}
FROM official_alerts
WHERE source = $1 AND source_alert_id = $2 AND is_current = TRUE
FOR UPDATE
"""

_SUPERSEDE_SQL = """
UPDATE official_alerts
SET is_current = FALSE,
    status = CASE WHEN status = 'active' THEN 'updated' ELSE status END
WHERE id = $1
"""

_NEXT_REVISION_SQL = """
SELECT COALESCE(MAX(revision), 0) + 1
FROM official_alerts
WHERE source = $1 AND source_alert_id = $2
"""

_INSERT_SQL = f"""
INSERT INTO official_alerts (
    source, source_alert_id, revision, message_type, status, sent_at,
    effective_at, expires_at, headline, description, area_geojson, raw_payload,
    payload_checksum, previous_alert_id, is_current
)
VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb,
    $13, $14, $15
)
RETURNING {_RETURNING_COLUMNS}
"""

_EXPIRE_SQL = """
UPDATE official_alerts
SET status = 'expired'
WHERE is_current = TRUE
  AND status = 'active'
  AND expires_at IS NOT NULL
  AND expires_at <= $1
RETURNING id
"""


def payload_checksum(payload: dict[str, Any]) -> str:
    """Return a stable SHA-256 checksum for a JSON-compatible payload."""
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _json_value(value: dict[str, Any] | None) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _current_status(alert: OfficialAlertInput, now: datetime) -> str:
    if alert.message_type == "cancel" or alert.status == "cancelled":
        return "cancelled"
    if alert.status == "expired":
        return "expired"
    if alert.expires_at is not None and alert.expires_at <= now:
        return "expired"
    return "active"


async def upsert_official_alert(
    pool: asyncpg.Pool,
    alert: OfficialAlertInput,
    *,
    now: datetime | None = None,
) -> tuple[dict[str, Any], bool]:
    """Insert one immutable revision, returning ``(row, created)``.

    The transaction is serialized per source alert identifier. Replaying an
    identical raw payload returns the existing revision without writing.
    """
    current_time = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    checksum = payload_checksum(alert.raw_payload)
    lock_key = f"{alert.source}:{alert.source_alert_id}"

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                lock_key,
            )

            duplicate = await conn.fetchrow(
                _FIND_PAYLOAD_SQL,
                alert.source,
                alert.source_alert_id,
                checksum,
            )
            if duplicate is not None:
                return dict(duplicate), False

            previous = await conn.fetchrow(
                _FIND_CURRENT_SQL,
                alert.source,
                alert.source_alert_id,
            )
            revision = int(
                await conn.fetchval(
                    _NEXT_REVISION_SQL,
                    alert.source,
                    alert.source_alert_id,
                )
            )
            previous_id = None
            is_current = True
            if previous is not None:
                previous_id = previous["id"]
                is_current = alert.sent_at > previous["sent_at"]
                if is_current:
                    await conn.execute(_SUPERSEDE_SQL, previous_id)

            status = _current_status(alert, current_time)
            if not is_current and status == "active":
                status = "updated"

            row = await conn.fetchrow(
                _INSERT_SQL,
                alert.source,
                alert.source_alert_id,
                revision,
                alert.message_type,
                status,
                alert.sent_at,
                alert.effective_at,
                alert.expires_at,
                alert.headline,
                alert.description,
                _json_value(alert.area_geojson),
                _json_value(alert.raw_payload),
                checksum,
                previous_id,
                is_current,
            )

    return (dict(row), True) if row is not None else ({}, False)


async def expire_official_alerts(
    pool: asyncpg.Pool,
    *,
    now: datetime | None = None,
) -> int:
    """Mark current active alerts expired after their explicit expiry."""
    current_time = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    async with pool.acquire() as conn:
        rows = await conn.fetch(_EXPIRE_SQL, current_time)
    return len(rows)


__all__ = [
    "expire_official_alerts",
    "payload_checksum",
    "upsert_official_alert",
]
