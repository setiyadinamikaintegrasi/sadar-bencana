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
payload_checksum, previous_alert_id, is_current, ingested_at, peril_type,
severity, category, area_name, latitude, longitude, source_url
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

_FIND_CAP_MESSAGE_SQL = """
SELECT source_alert_id, raw_payload
FROM official_alerts
WHERE source = $1
  AND (
    raw_payload->>'message_identifier' = $2
    OR source_alert_id = $2
  )
ORDER BY is_current DESC, sent_at DESC, revision DESC
LIMIT 1
"""

_INSERT_SQL = f"""
INSERT INTO official_alerts (
    source, source_alert_id, revision, message_type, status, sent_at,
    effective_at, expires_at, headline, description, area_geojson, raw_payload,
    payload_checksum, previous_alert_id, is_current,
    peril_type, severity, category, area_name, latitude, longitude, source_url
)
VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb,
    $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
)
RETURNING {_RETURNING_COLUMNS}
"""

_EXPIRE_SQL = f"""
WITH active_sources AS MATERIALIZED (
    SELECT source_name
    FROM official_source_settings
    WHERE enabled = TRUE AND run_mode = 'active'
    FOR SHARE
)
UPDATE official_alerts alerts
SET status = 'expired'
FROM active_sources source_settings
WHERE source_settings.source_name = alerts.source
  AND alerts.is_current = TRUE
  AND alerts.status = 'active'
  AND alerts.expires_at IS NOT NULL
  AND alerts.expires_at <= $1
RETURNING {_RETURNING_COLUMNS}
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


def _referenced_message_identifiers(payload: dict[str, Any]) -> list[str]:
    raw_identifiers = payload.get("referenced_message_identifiers")
    if isinstance(raw_identifiers, list):
        return [
            str(identifier).strip()
            for identifier in raw_identifiers
            if str(identifier).strip()
        ]
    references = payload.get("references")
    if not isinstance(references, list):
        return []
    return [
        str(reference.get("identifier") or "").strip()
        for reference in references
        if isinstance(reference, dict)
        and str(reference.get("identifier") or "").strip()
    ]


async def _resolve_cap_lifecycle_id(
    conn: asyncpg.Connection,
    alert: OfficialAlertInput,
) -> str:
    """Resolve immediate CAP references to the persisted canonical lifecycle.

    New rows store the canonical lifecycle in ``source_alert_id`` while retaining
    the CAP message identifier in raw payload. Following legacy rows recursively
    keeps chains coherent across deployments of this resolver.
    """
    if alert.source != "bmkg_cap" or alert.message_type == "alert":
        return alert.source_alert_id
    pending = _referenced_message_identifiers(alert.raw_payload)
    if not pending:
        return alert.source_alert_id
    fallback = pending[0]
    visited: set[str] = {alert.source_alert_id}
    while pending:
        identifier = pending.pop(0)
        if identifier in visited:
            continue
        visited.add(identifier)
        row = await conn.fetchrow(_FIND_CAP_MESSAGE_SQL, alert.source, identifier)
        if row is None:
            return identifier
        canonical = str(row["source_alert_id"])
        if canonical != identifier:
            return canonical
        raw_payload = row["raw_payload"]
        if isinstance(raw_payload, str):
            raw_payload = json.loads(raw_payload)
        parent_identifiers = _referenced_message_identifiers(raw_payload or {})
        if not parent_identifiers:
            return canonical
        pending = [*parent_identifiers, *pending]
    return fallback


async def upsert_official_alert(
    pool: asyncpg.Pool,
    alert: OfficialAlertInput,
    *,
    now: datetime | None = None,
    connection: asyncpg.Connection | None = None,
) -> tuple[dict[str, Any], bool]:
    """Insert one immutable revision, returning ``(row, created)``.

    The transaction is serialized per source alert identifier. Replaying an
    identical raw payload returns the existing revision without writing.
    """
    current_time = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    checksum = payload_checksum(alert.raw_payload)

    async def execute(conn: asyncpg.Connection) -> tuple[dict[str, Any], bool]:
        canonical_source_alert_id = await _resolve_cap_lifecycle_id(conn, alert)
        persisted_alert = (
            alert
            if canonical_source_alert_id == alert.source_alert_id
            else alert.model_copy(update={"source_alert_id": canonical_source_alert_id})
        )
        await conn.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            f"{persisted_alert.source}:{persisted_alert.source_alert_id}",
        )

        duplicate = await conn.fetchrow(
            _FIND_PAYLOAD_SQL,
            persisted_alert.source,
            persisted_alert.source_alert_id,
            checksum,
        )
        if duplicate is not None:
            return dict(duplicate), False

        previous = await conn.fetchrow(
            _FIND_CURRENT_SQL,
            persisted_alert.source,
            persisted_alert.source_alert_id,
        )
        revision = int(
            await conn.fetchval(
                _NEXT_REVISION_SQL,
                persisted_alert.source,
                persisted_alert.source_alert_id,
            )
        )
        previous_id = None
        is_current = True
        if previous is not None:
            previous_id = previous["id"]
            is_current = persisted_alert.sent_at > previous["sent_at"]
            if is_current:
                await conn.execute(_SUPERSEDE_SQL, previous_id)

        status = _current_status(persisted_alert, current_time)
        if not is_current and status == "active":
            status = "updated"

        row = await conn.fetchrow(
            _INSERT_SQL,
            persisted_alert.source,
            persisted_alert.source_alert_id,
            revision,
            persisted_alert.message_type,
            status,
            persisted_alert.sent_at,
            persisted_alert.effective_at,
            persisted_alert.expires_at,
            persisted_alert.headline,
            persisted_alert.description,
            _json_value(persisted_alert.area_geojson),
            _json_value(persisted_alert.raw_payload),
            checksum,
            previous_id,
            is_current,
            persisted_alert.peril_type,
            persisted_alert.severity,
            persisted_alert.category,
            persisted_alert.area_name,
            persisted_alert.latitude,
            persisted_alert.longitude,
            persisted_alert.source_url,
        )
        return (dict(row), True) if row is not None else ({}, False)

    if connection is not None:
        return await execute(connection)
    async with pool.acquire() as conn:
        async with conn.transaction():
            return await execute(conn)


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


async def expire_official_alert_revisions(
    pool: asyncpg.Pool,
    *,
    now: datetime | None = None,
    connection: asyncpg.Connection | None = None,
) -> list[dict[str, Any]]:
    """Expire due current revisions and return their lifecycle payloads."""
    current_time = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if connection is not None:
        rows = await connection.fetch(_EXPIRE_SQL, current_time)
    else:
        async with pool.acquire() as conn:
            rows = await conn.fetch(_EXPIRE_SQL, current_time)
    return [dict(row) for row in rows]


__all__ = [
    "expire_official_alerts",
    "expire_official_alert_revisions",
    "payload_checksum",
    "upsert_official_alert",
]
