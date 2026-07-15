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

_LOCK_CAP_ROWS_SQL = f"""
SELECT {_RETURNING_COLUMNS}
FROM official_alerts
WHERE source = $1
FOR UPDATE
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


def _payload_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        decoded = json.loads(value)
        return decoded if isinstance(decoded, dict) else {}
    return {}


def _cap_message_identifier(row: dict[str, Any]) -> str:
    payload = _payload_dict(row.get("raw_payload"))
    return str(
        payload.get("message_identifier")
        or payload.get("identifier")
        or payload.get("source_alert_id")
        or row["source_alert_id"]
    ).strip()


def _reference_sent_times(payload: dict[str, Any]) -> dict[str, datetime]:
    result: dict[str, datetime] = {}
    references = payload.get("references")
    if not isinstance(references, list):
        return result
    for reference in references:
        if not isinstance(reference, dict):
            continue
        identifier = str(reference.get("identifier") or "").strip()
        raw_sent = str(reference.get("sent") or "").strip()
        if not identifier or not raw_sent:
            continue
        try:
            sent = datetime.fromisoformat(raw_sent.replace("Z", "+00:00"))
        except ValueError:
            continue
        if sent.tzinfo is None:
            continue
        sent = sent.astimezone(timezone.utc)
        current = result.get(identifier)
        if current is None or sent < current:
            result[identifier] = sent
    return result


def _cap_component(
    rows: list[dict[str, Any]],
    alert: OfficialAlertInput,
) -> tuple[set[str], str]:
    """Return the connected CAP component and its deterministic root."""
    adjacency: dict[str, set[str]] = {}
    predecessors: dict[str, set[str]] = {}
    sent_times: dict[str, datetime] = {}

    def add_node(identifier: str, sent_at: datetime | None = None) -> None:
        adjacency.setdefault(identifier, set())
        predecessors.setdefault(identifier, set())
        if sent_at is not None:
            normalized = sent_at.astimezone(timezone.utc)
            current = sent_times.get(identifier)
            if current is None or normalized < current:
                sent_times[identifier] = normalized

    def add_message(
        identifier: str,
        payload: dict[str, Any],
        sent_at: datetime,
        persisted_lifecycle: str | None = None,
    ) -> None:
        add_node(identifier, sent_at)
        if (
            persisted_lifecycle
            and persisted_lifecycle != identifier
            and not persisted_lifecycle.startswith("__cap_")
        ):
            add_node(persisted_lifecycle, sent_at)
            adjacency[identifier].add(persisted_lifecycle)
            adjacency[persisted_lifecycle].add(identifier)
        reference_times = _reference_sent_times(payload)
        for referenced in _referenced_message_identifiers(payload):
            add_node(referenced, reference_times.get(referenced))
            predecessors[identifier].add(referenced)
            adjacency[identifier].add(referenced)
            adjacency[referenced].add(identifier)

    for row in rows:
        identifier = _cap_message_identifier(row)
        add_message(
            identifier,
            _payload_dict(row.get("raw_payload")),
            row["sent_at"],
            str(row["source_alert_id"]),
        )

    incoming_payload = _payload_dict(alert.raw_payload)
    incoming_identifier = str(
        incoming_payload.get("message_identifier")
        or incoming_payload.get("identifier")
        or incoming_payload.get("source_alert_id")
        or alert.source_alert_id
    ).strip()
    add_message(incoming_identifier, incoming_payload, alert.sent_at)

    component: set[str] = set()
    pending = [incoming_identifier]
    while pending:
        identifier = pending.pop()
        if identifier in component:
            continue
        component.add(identifier)
        pending.extend(adjacency.get(identifier, ()))

    roots = [
        identifier
        for identifier in component
        if not (predecessors.get(identifier, set()) & component)
    ]
    candidates = roots or list(component)
    missing_time = datetime.max.replace(tzinfo=timezone.utc)
    canonical = min(
        candidates,
        key=lambda identifier: (sent_times.get(identifier, missing_time), identifier),
    )
    return component, canonical


def _reconciled_status(
    row: dict[str, Any],
    *,
    is_current: bool,
    now: datetime,
) -> str:
    if row["message_type"] == "cancel":
        return "cancelled"
    expires_at = row.get("expires_at")
    if expires_at is not None and expires_at <= now:
        return "expired"
    return "active" if is_current else "updated"


async def _reconcile_cap_lifecycle(
    conn: asyncpg.Connection,
    alert: OfficialAlertInput,
    rows: list[dict[str, Any]],
    *,
    now: datetime,
) -> list[dict[str, Any]]:
    component, canonical = _cap_component(rows, alert)
    component_rows = [row for row in rows if _cap_message_identifier(row) in component]
    component_rows.sort(
        key=lambda row: (
            row["sent_at"],
            _cap_message_identifier(row),
            str(row["id"]),
        )
    )

    for row in component_rows:
        await conn.execute(
            """
            UPDATE official_alerts
            SET source_alert_id = $2, revision = 1, previous_alert_id = NULL,
                is_current = FALSE
            WHERE id = $1
            """,
            row["id"],
            f"__cap_reconcile__:{row['id']}",
        )

    previous_id = None
    final_rows: list[dict[str, Any]] = []
    for revision, row in enumerate(component_rows, start=1):
        is_current = revision == len(component_rows)
        status = _reconciled_status(row, is_current=is_current, now=now)
        updated = await conn.fetchrow(
            f"""
            UPDATE official_alerts
            SET source_alert_id = $2, revision = $3, previous_alert_id = $4,
                is_current = $5, status = $6
            WHERE id = $1
            RETURNING {_RETURNING_COLUMNS}
            """,
            row["id"],
            canonical,
            revision,
            previous_id,
            is_current,
            status,
        )
        if updated is not None:
            final_rows.append(dict(updated))
        previous_id = row["id"]

    queue_supports_lifecycle = await conn.fetchval(
        """
        SELECT count(*) = 2
        FROM pg_attribute
        WHERE attrelid = to_regclass('ews_notification_log')
          AND attname IN ('source_alert_id', 'alert_revision')
          AND NOT attisdropped
        """
    )
    if queue_supports_lifecycle:
        for row in final_rows:
            await conn.execute(
                """
                UPDATE ews_notification_log
                SET source_alert_id = $2, alert_revision = $3
                WHERE official_alert_id = $1
                """,
                row["id"],
                canonical,
                row["revision"],
            )
    return final_rows


async def _upsert_cap_alert(
    conn: asyncpg.Connection,
    alert: OfficialAlertInput,
    *,
    checksum: str,
    now: datetime,
) -> tuple[dict[str, Any], bool]:
    await conn.execute(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        f"{alert.source}:lifecycle-graph",
    )
    rows = [dict(row) for row in await conn.fetch(_LOCK_CAP_ROWS_SQL, alert.source)]
    message_identifier = str(
        alert.raw_payload.get("message_identifier")
        or alert.raw_payload.get("identifier")
        or alert.raw_payload.get("source_alert_id")
        or alert.source_alert_id
    ).strip()
    duplicate = next(
        (
            row
            for row in rows
            if _cap_message_identifier(row) == message_identifier
            and row["payload_checksum"] == checksum
        ),
        None,
    )

    created = duplicate is None
    incoming_id = duplicate["id"] if duplicate is not None else None
    if duplicate is None:
        status = _current_status(alert, now)
        inserted = await conn.fetchrow(
            _INSERT_SQL,
            alert.source,
            f"__cap_pending__:{checksum}",
            1,
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
            None,
            False,
            alert.peril_type,
            alert.severity,
            alert.category,
            alert.area_name,
            alert.latitude,
            alert.longitude,
            alert.source_url,
        )
        if inserted is None:
            return {}, False
        duplicate = dict(inserted)
        incoming_id = duplicate["id"]
        rows.append(duplicate)

    reconciled = await _reconcile_cap_lifecycle(conn, alert, rows, now=now)
    incoming = next((row for row in reconciled if row["id"] == incoming_id), None)
    return (incoming or duplicate or {}), created


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
        if alert.source == "bmkg_cap":
            return await _upsert_cap_alert(
                conn,
                alert,
                checksum=checksum,
                now=current_time,
            )

        persisted_alert = alert
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
