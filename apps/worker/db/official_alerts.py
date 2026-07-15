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
  AND ($2::varchar[] IS NULL OR alerts.source = ANY($2::varchar[]))
RETURNING {_RETURNING_COLUMNS}
"""

_DUE_EXPIRY_SOURCES_SQL = """
SELECT DISTINCT alerts.source
FROM official_alerts alerts
JOIN official_source_settings source_settings
  ON source_settings.source_name = alerts.source
WHERE source_settings.enabled = TRUE
  AND source_settings.run_mode = 'active'
  AND alerts.is_current = TRUE
  AND alerts.status = 'active'
  AND alerts.expires_at IS NOT NULL
  AND alerts.expires_at <= $1
ORDER BY alerts.source
"""

_SOURCE_LIFECYCLE_LOCK_SQL = (
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))"
)
_LEGACY_CAP_SENDER = "__legacy_cap_sender__"
CAPIdentity = tuple[str, str]


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


def source_lifecycle_lock_key(source: str) -> str:
    return f"{source}:lifecycle-graph"


async def lock_source_lifecycle(conn: asyncpg.Connection, source: str) -> None:
    """Acquire the first lock in the source -> alert -> queue lock order."""
    await conn.execute(
        _SOURCE_LIFECYCLE_LOCK_SQL,
        source_lifecycle_lock_key(source),
    )


def _cap_identity_key(identity: CAPIdentity) -> str:
    sender, identifier = identity
    digest = hashlib.sha256(f"{sender}\0{identifier}".encode("utf-8")).hexdigest()
    return f"cap:{digest}"


def _payload_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        decoded = json.loads(value)
        return decoded if isinstance(decoded, dict) else {}
    return {}


def _cap_sender(payload: dict[str, Any]) -> str:
    return str(payload.get("sender") or _LEGACY_CAP_SENDER).strip()


def _cap_message_identity(row: dict[str, Any]) -> CAPIdentity:
    payload = _payload_dict(row.get("raw_payload"))
    identifier = str(
        payload.get("message_identifier")
        or payload.get("identifier")
        or payload.get("source_alert_id")
        or row["source_alert_id"]
    ).strip()
    return _cap_sender(payload), identifier


def _referenced_message_identities(
    payload: dict[str, Any],
    *,
    current_sender: str,
) -> list[CAPIdentity]:
    references = payload.get("references")
    if isinstance(references, list):
        identities: list[CAPIdentity] = []
        for reference in references:
            if not isinstance(reference, dict):
                continue
            identifier = str(reference.get("identifier") or "").strip()
            sender = str(reference.get("sender") or current_sender).strip()
            if identifier and sender:
                identities.append((sender, identifier))
        return identities
    raw_identifiers = payload.get("referenced_message_identifiers")
    if not isinstance(raw_identifiers, list):
        return []
    return [
        (current_sender, str(identifier).strip())
        for identifier in raw_identifiers
        if str(identifier).strip()
    ]


def _reference_sent_times(
    payload: dict[str, Any],
    *,
    current_sender: str,
) -> dict[CAPIdentity, datetime]:
    result: dict[CAPIdentity, datetime] = {}
    references = payload.get("references")
    if not isinstance(references, list):
        return result
    for reference in references:
        if not isinstance(reference, dict):
            continue
        identifier = str(reference.get("identifier") or "").strip()
        sender = str(reference.get("sender") or current_sender).strip()
        raw_sent = str(reference.get("sent") or "").strip()
        if not identifier or not sender or not raw_sent:
            continue
        try:
            sent = datetime.fromisoformat(raw_sent.replace("Z", "+00:00"))
        except ValueError:
            continue
        if sent.tzinfo is None:
            continue
        sent = sent.astimezone(timezone.utc)
        identity = (sender, identifier)
        current = result.get(identity)
        if current is None or sent < current:
            result[identity] = sent
    return result


def _cap_component(
    rows: list[dict[str, Any]],
    alert: OfficialAlertInput,
) -> tuple[set[CAPIdentity], CAPIdentity]:
    """Return the connected CAP component and its deterministic root."""
    adjacency: dict[CAPIdentity, set[CAPIdentity]] = {}
    predecessors: dict[CAPIdentity, set[CAPIdentity]] = {}
    sent_times: dict[CAPIdentity, datetime] = {}

    def add_node(identity: CAPIdentity, sent_at: datetime | None = None) -> None:
        adjacency.setdefault(identity, set())
        predecessors.setdefault(identity, set())
        if sent_at is not None:
            normalized = sent_at.astimezone(timezone.utc)
            current = sent_times.get(identity)
            if current is None or normalized < current:
                sent_times[identity] = normalized

    def add_message(
        identity: CAPIdentity,
        payload: dict[str, Any],
        sent_at: datetime,
    ) -> None:
        add_node(identity, sent_at)
        current_sender = identity[0]
        reference_times = _reference_sent_times(
            payload,
            current_sender=current_sender,
        )
        for referenced in _referenced_message_identities(
            payload,
            current_sender=current_sender,
        ):
            add_node(referenced, reference_times.get(referenced))
            if referenced[0] != current_sender:
                continue
            predecessors[identity].add(referenced)
            adjacency[identity].add(referenced)
            adjacency[referenced].add(identity)

    for row in rows:
        identity = _cap_message_identity(row)
        add_message(
            identity,
            _payload_dict(row.get("raw_payload")),
            row["sent_at"],
        )

    incoming_payload = _payload_dict(alert.raw_payload)
    incoming_identifier = str(
        incoming_payload.get("message_identifier")
        or incoming_payload.get("identifier")
        or incoming_payload.get("source_alert_id")
        or alert.source_alert_id
    ).strip()
    incoming_identity = (_cap_sender(incoming_payload), incoming_identifier)
    add_message(incoming_identity, incoming_payload, alert.sent_at)

    component: set[CAPIdentity] = set()
    pending = [incoming_identity]
    while pending:
        identity = pending.pop()
        if identity in component:
            continue
        component.add(identity)
        pending.extend(adjacency.get(identity, ()))

    roots = [
        identity
        for identity in component
        if not (predecessors.get(identity, set()) & component)
    ]
    candidates = roots or list(component)
    missing_time = datetime.max.replace(tzinfo=timezone.utc)
    canonical = min(
        candidates,
        key=lambda identity: (sent_times.get(identity, missing_time), identity),
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
    component_rows = [row for row in rows if _cap_message_identity(row) in component]
    component_rows.sort(
        key=lambda row: (
            row["sent_at"],
            _cap_message_identity(row),
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
            _cap_identity_key(canonical),
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
                _cap_identity_key(canonical),
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
    await lock_source_lifecycle(conn, alert.source)
    rows = [dict(row) for row in await conn.fetch(_LOCK_CAP_ROWS_SQL, alert.source)]
    message_identifier = str(
        alert.raw_payload.get("message_identifier")
        or alert.raw_payload.get("identifier")
        or alert.raw_payload.get("source_alert_id")
        or alert.source_alert_id
    ).strip()
    message_identity = (_cap_sender(alert.raw_payload), message_identifier)
    duplicate = next(
        (
            row
            for row in rows
            if _cap_message_identity(row) == message_identity
        ),
        None,
    )

    created = duplicate is None
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
        rows.append(duplicate)

    reconciled = await _reconcile_cap_lifecycle(conn, alert, rows, now=now)
    current = next((row for row in reconciled if row["is_current"]), None)
    return (current or duplicate or {}), created


async def upsert_official_alert(
    pool: asyncpg.Pool,
    alert: OfficialAlertInput,
    *,
    now: datetime | None = None,
    connection: asyncpg.Connection | None = None,
) -> tuple[dict[str, Any], bool]:
    """Insert one immutable revision, returning ``(current_row, created)``.

    The transaction is serialized per source alert identifier. Replaying an
    identical raw payload returns the reconciled current revision without
    writing. For CAP, ``created`` describes the incoming message even when
    graph reconciliation makes another row current and eligible for enqueue.
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
        rows = await conn.fetch(_EXPIRE_SQL, current_time, None)
    return len(rows)


async def due_official_alert_sources(
    pool: asyncpg.Pool,
    *,
    now: datetime | None = None,
    connection: asyncpg.Connection | None = None,
) -> list[str]:
    """Return due source names without taking alert or queue row locks."""
    current_time = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if connection is not None:
        rows = await connection.fetch(_DUE_EXPIRY_SOURCES_SQL, current_time)
    else:
        async with pool.acquire() as conn:
            rows = await conn.fetch(_DUE_EXPIRY_SOURCES_SQL, current_time)
    return [str(row["source"]) for row in rows]


async def expire_official_alert_revisions(
    pool: asyncpg.Pool,
    *,
    now: datetime | None = None,
    sources: list[str] | None = None,
    connection: asyncpg.Connection | None = None,
) -> list[dict[str, Any]]:
    """Expire due current revisions and return their lifecycle payloads."""
    current_time = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if connection is not None:
        rows = await connection.fetch(_EXPIRE_SQL, current_time, sources)
    else:
        async with pool.acquire() as conn:
            rows = await conn.fetch(_EXPIRE_SQL, current_time, sources)
    return [dict(row) for row in rows]


__all__ = [
    "due_official_alert_sources",
    "expire_official_alerts",
    "expire_official_alert_revisions",
    "lock_source_lifecycle",
    "payload_checksum",
    "source_lifecycle_lock_key",
    "upsert_official_alert",
]
