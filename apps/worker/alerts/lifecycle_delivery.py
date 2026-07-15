"""Reliable official-alert lifecycle delivery with revision dedup and retries."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg

from alerts.channels import CHANNELS
from db.official_alerts import (
    expire_official_alert_revisions,
    upsert_official_alert,
)
from db.evidence import create_source_record
from db.source_settings import source_write_is_allowed
from models.evidence import SourceRecordInput
from models.official_alert import OfficialAlertInput
from observability import disaster_correlation_id, record_observation

MAX_DELIVERY_ATTEMPTS = 5
BASE_RETRY_SECONDS = 30
CHANNEL_SEND_TIMEOUT_SECONDS = {"email": 30, "telegram": 15}
DELIVERY_LEASE_MARGIN_SECONDS = 30
DELIVERY_LEASE_SECONDS = (
    max(CHANNEL_SEND_TIMEOUT_SECONDS.values()) + DELIVERY_LEASE_MARGIN_SECONDS
)

_ENQUEUE_ACTIVE_SQL = """
INSERT INTO ews_notification_log (
    subscriber_id, official_alert_id, channel, status, source, source_alert_id,
    alert_revision, lifecycle_action, next_attempt_at, correlation_id,
    delivery_kind, matched_watch_zone_id
)
SELECT s.id, oa.id, p.channel, 'pending', oa.source, oa.source_alert_id,
       oa.revision, $2, now(), $3, 'official_lifecycle', matched.id
FROM official_alerts oa
JOIN ews_subscribers s ON s.is_active = TRUE
JOIN ews_notification_prefs p
  ON p.subscriber_id = s.id AND p.is_enabled = TRUE
JOIN ews_channel_settings cs
  ON cs.channel = p.channel AND cs.is_enabled = TRUE
JOIN LATERAL (
    SELECT z.id
    FROM ews_watch_zones z
    WHERE z.subscriber_id = s.id
      AND z.is_active = TRUE
      AND (cardinality(z.peril_types) = 0 OR oa.peril_type = ANY(z.peril_types))
      AND (
        CASE
          WHEN oa.area_geojson IS NOT NULL AND ST_IsValid(
            ST_SetSRID(ST_GeomFromGeoJSON(oa.area_geojson::text), 4326)
          ) THEN ST_Intersects(
            ST_SetSRID(ST_GeomFromGeoJSON(oa.area_geojson::text), 4326)::geography,
            ST_Buffer(
                ST_SetSRID(ST_MakePoint(z.longitude, z.latitude), 4326)::geography,
                z.radius_km * 1000
            )
          )
          ELSE FALSE
        END
        OR
        (oa.latitude IS NOT NULL AND oa.longitude IS NOT NULL AND ST_DWithin(
            ST_SetSRID(ST_MakePoint(oa.longitude, oa.latitude), 4326)::geography,
            ST_SetSRID(ST_MakePoint(z.longitude, z.latitude), 4326)::geography,
            z.radius_km * 1000
        ))
      )
    ORDER BY z.created_at, z.id
    LIMIT 1
) matched ON TRUE
WHERE oa.id = $1
  AND oa.severity IS NOT NULL
  AND CASE oa.severity WHEN 'Critical' THEN 3 WHEN 'High' THEN 2 ELSE 1 END
      >= CASE p.min_severity WHEN 'Critical' THEN 3 WHEN 'High' THEN 2 ELSE 1 END
  AND (cardinality(p.alert_types) = 0 OR oa.peril_type = ANY(p.alert_types))
ON CONFLICT DO NOTHING
RETURNING id
"""

_ENQUEUE_PRIOR_RECIPIENTS_SQL = """
INSERT INTO ews_notification_log (
    subscriber_id, official_alert_id, channel, status, source, source_alert_id,
    alert_revision, lifecycle_action, next_attempt_at, correlation_id,
    delivery_kind, matched_watch_zone_id
)
SELECT DISTINCT ON (l.subscriber_id, l.channel)
       l.subscriber_id, $1::uuid, l.channel, 'pending', $2::varchar(64),
       $3::varchar(255), $4::int, $5::varchar(16), now(), $6::uuid,
       'official_lifecycle', l.matched_watch_zone_id
FROM ews_notification_log l
JOIN ews_channel_settings cs ON cs.channel = l.channel AND cs.is_enabled = TRUE
WHERE l.source = $2::varchar(64) AND l.source_alert_id = $3::varchar(255)
  AND l.status IN ('pending', 'failed', 'sent', 'acknowledged')
ORDER BY l.subscriber_id, l.channel, l.alert_revision DESC, l.created_at DESC
ON CONFLICT DO NOTHING
RETURNING id
"""

_SUPERSEDE_STALE_SQL = """
UPDATE ews_notification_log
SET status = 'skipped',
    error_message = 'superseded_by_official_alert_revision',
    next_attempt_at = NULL
WHERE source = $1
  AND source_alert_id = $2
  AND alert_revision < $3
  AND status IN ('pending', 'failed')
"""

_SKIP_DISABLED_SQL = """
UPDATE ews_notification_log l
SET status = 'skipped',
    error_message = 'source_disabled_or_not_active',
    next_attempt_at = NULL
WHERE l.delivery_kind = 'official_lifecycle'
  AND l.status IN ('pending', 'failed')
  AND NOT EXISTS (
    SELECT 1
    FROM official_source_settings source_setting
    WHERE source_setting.source_name = l.source
      AND source_setting.enabled = TRUE
      AND source_setting.run_mode = 'active'
  )
"""

_SKIP_STALE_SQL = """
UPDATE ews_notification_log l
SET status = 'skipped',
    error_message = 'official_alert_revision_not_current',
    next_attempt_at = NULL
WHERE l.delivery_kind = 'official_lifecycle'
  AND l.status IN ('pending', 'failed')
  AND NOT EXISTS (
    SELECT 1
    FROM official_alerts current_alert
    WHERE current_alert.id = l.official_alert_id
      AND current_alert.is_current = TRUE
  )
"""

_CLAIM_DUE_SQL = """
WITH due AS (
    SELECT l.id
    FROM ews_notification_log l
    JOIN ews_channel_settings cs
      ON cs.channel = l.channel AND cs.is_enabled = TRUE
    WHERE l.status IN ('pending', 'failed')
      AND l.next_attempt_at <= now()
      AND l.attempt_count < $1
      AND (
        l.delivery_kind <> 'official_lifecycle'
        OR EXISTS (
          SELECT 1
          FROM official_alerts current_alert
          JOIN official_source_settings source_setting
            ON source_setting.source_name = current_alert.source
          WHERE current_alert.id = l.official_alert_id
            AND current_alert.is_current = TRUE
            AND source_setting.enabled = TRUE
            AND source_setting.run_mode = 'active'
        )
      )
    ORDER BY l.next_attempt_at
    LIMIT $2
    FOR UPDATE SKIP LOCKED
), claimed AS (
    UPDATE ews_notification_log l
    SET attempt_count = l.attempt_count + 1,
        last_attempt_at = now(),
        next_attempt_at = now() + ($3 * interval '1 second')
    FROM due
    WHERE l.id = due.id
    RETURNING l.*
)
SELECT c.*, s.email, s.telegram_chat_id,
       COALESCE(oa.headline, a.message, 'Peringatan SadarBencana') AS headline,
       COALESCE(oa.description, '') AS description,
       COALESCE(oa.sent_at, a.created_at, c.created_at) AS source_sent_at,
       COALESCE(oa.severity, a.severity, '') AS severity,
       COALESCE(oa.peril_type, a.alert_type, c.lifecycle_action, 'alert') AS alert_type
FROM claimed c
JOIN ews_subscribers s ON s.id = c.subscriber_id
LEFT JOIN official_alerts oa ON oa.id = c.official_alert_id
LEFT JOIN alerts a ON a.id = c.alert_id
"""

_PREPARE_SEND_SQL = """
UPDATE ews_notification_log
SET next_attempt_at = now() + ($3 * interval '1 second')
WHERE id = $1
  AND attempt_count = $2
  AND status IN ('pending', 'failed')
  AND next_attempt_at > now()
  AND (
    delivery_kind <> 'official_lifecycle'
    OR EXISTS (
      SELECT 1
      FROM official_alerts current_alert
      JOIN official_source_settings source_setting
        ON source_setting.source_name = current_alert.source
      WHERE current_alert.id = ews_notification_log.official_alert_id
        AND current_alert.is_current = TRUE
        AND source_setting.enabled = TRUE
        AND source_setting.run_mode = 'active'
    )
  )
RETURNING id
"""

_MARK_SENT_SQL = """
UPDATE ews_notification_log
SET status = 'sent', error_message = NULL, sent_at = $2,
    next_attempt_at = NULL,
    provider_id = $4,
    delivery_latency_ms = GREATEST(
        0,
        (EXTRACT(EPOCH FROM ($2::timestamptz - $3::timestamptz)) * 1000)::bigint
    )
WHERE id = $1
  AND attempt_count = $5
  AND status IN ('pending', 'failed')
  AND (
    delivery_kind <> 'official_lifecycle'
    OR EXISTS (
      SELECT 1
      FROM official_alerts current_alert
      JOIN official_source_settings source_setting
        ON source_setting.source_name = current_alert.source
      WHERE current_alert.id = ews_notification_log.official_alert_id
        AND current_alert.is_current = TRUE
        AND source_setting.enabled = TRUE
        AND source_setting.run_mode = 'active'
    )
  )
RETURNING id
"""

_MARK_FAILED_SQL = """
UPDATE ews_notification_log
SET status = $2, error_message = $3, next_attempt_at = $4,
    dead_lettered_at = CASE WHEN $2 = 'dead_letter' THEN now() ELSE NULL END
WHERE id = $1
  AND attempt_count = $5
  AND status IN ('pending', 'failed')
  AND (
    delivery_kind <> 'official_lifecycle'
    OR EXISTS (
      SELECT 1
      FROM official_alerts current_alert
      JOIN official_source_settings source_setting
        ON source_setting.source_name = current_alert.source
      WHERE current_alert.id = ews_notification_log.official_alert_id
        AND current_alert.is_current = TRUE
        AND source_setting.enabled = TRUE
        AND source_setting.run_mode = 'active'
    )
  )
RETURNING id
"""


def retry_delay(attempt_count: int) -> timedelta:
    exponent = max(0, attempt_count - 1)
    return timedelta(seconds=BASE_RETRY_SECONDS * (2**exponent))


def lifecycle_action(message_type: str, status: str) -> str:
    if status == "expired":
        return "expiry"
    if message_type == "cancel" or status == "cancelled":
        return "cancellation"
    if message_type == "update":
        return "update"
    return "alert"


def lifecycle_message(row: dict[str, Any]) -> str:
    if row.get("delivery_kind") == "alert":
        return str(row.get("headline") or "Peringatan SadarBencana")
    label = {
        "alert": "PERINGATAN",
        "update": "PEMBARUAN",
        "expiry": "BERAKHIR",
        "cancellation": "DIBATALKAN",
    }.get(str(row.get("lifecycle_action")), "PERINGATAN")
    headline = str(row.get("headline") or "Peringatan resmi")
    description = str(row.get("description") or "")
    return f"[{label}] {headline}" + (f"\n{description}" if description else "")


async def enqueue_official_alert_revision(
    pool: asyncpg.Pool,
    alert: dict[str, Any],
    *,
    connection: asyncpg.Connection | None = None,
) -> int:
    if alert.get("is_current") is False:
        return 0
    action = lifecycle_action(str(alert["message_type"]), str(alert["status"]))
    correlation_id = disaster_correlation_id(
        str(alert["source"]),
        str(alert["source_alert_id"]),
    )
    sql = (
        _ENQUEUE_PRIOR_RECIPIENTS_SQL
        if action in {"update", "cancellation", "expiry"}
        else _ENQUEUE_ACTIVE_SQL
    )
    async def enqueue(conn: asyncpg.Connection) -> int:
        if action == "alert":
            rows = await conn.fetch(sql, alert["id"], action, correlation_id)
        else:
            rows = await conn.fetch(
                sql,
                alert["id"],
                alert["source"],
                alert["source_alert_id"],
                alert["revision"],
                action,
                correlation_id,
            )
        await conn.execute(
            _SUPERSEDE_STALE_SQL,
            alert["source"],
            alert["source_alert_id"],
            alert["revision"],
        )
        return len(rows)

    if connection is not None:
        return await enqueue(connection)
    async with pool.acquire() as conn:
        return await enqueue(conn)


async def persist_official_alert_revision(
    pool: asyncpg.Pool,
    alert: OfficialAlertInput,
    *,
    source_record: SourceRecordInput | None = None,
    source_name: str | None = None,
    expected_config_version: int | None = None,
    delivery_enabled: bool,
) -> tuple[dict[str, Any], bool, bool]:
    """Persist a revision and its queue rows atomically.

    The enqueue runs for duplicate current revisions as a recovery path when
    older code committed the alert before queueing its notification.
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            if source_name is not None and expected_config_version is not None:
                allowed = await source_write_is_allowed(
                    conn,
                    source_name,
                    expected_config_version,
                )
                if not allowed:
                    return {}, False, False
            if source_record is not None:
                await create_source_record(
                    pool,
                    source_record,
                    connection=conn,
                )
            row, created = await upsert_official_alert(
                pool,
                alert,
                connection=conn,
            )
            if delivery_enabled and row.get("is_current", True):
                await enqueue_official_alert_revision(
                    pool,
                    row,
                    connection=conn,
                )
            return row, created, True


async def expire_and_enqueue_official_alert_revisions(
    pool: asyncpg.Pool,
    *,
    delivery_enabled: bool,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Expire current alerts and enqueue lifecycle delivery in one transaction."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            expired = await expire_official_alert_revisions(
                pool,
                now=now,
                connection=conn,
            ) if now is not None else await expire_official_alert_revisions(
                pool,
                connection=conn,
            )
            if delivery_enabled:
                for revision in expired:
                    await enqueue_official_alert_revision(
                        pool,
                        revision,
                        connection=conn,
                    )
            return expired


def _recipient(row: dict[str, Any]) -> str | None:
    channel = row["channel"]
    if channel == "telegram" and row.get("telegram_chat_id"):
        return str(row["telegram_chat_id"])
    if channel == "email":
        return row.get("email")
    return None


async def process_due_deliveries(
    pool: asyncpg.Pool,
    *,
    batch_size: int = 100,
    now: datetime | None = None,
) -> dict[str, int]:
    result = {"sent": 0, "failed": 0, "dead_letter": 0}
    for _ in range(batch_size):
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(_SKIP_DISABLED_SQL)
                await conn.execute(_SKIP_STALE_SQL)
                rows = await conn.fetch(
                    _CLAIM_DUE_SQL,
                    MAX_DELIVERY_ATTEMPTS,
                    1,
                    DELIVERY_LEASE_SECONDS,
                )
        if not rows:
            break

        raw = rows[0]
        row = dict(raw)
        adapter = CHANNELS.get(row["channel"])
        recipient = _recipient(row)
        error: str | None = None
        send_result: dict[str, Any] = {"success": False}
        if adapter is None:
            error = "unsupported_channel"
        elif recipient is None:
            error = "recipient_unavailable"
        else:
            send_timeout = CHANNEL_SEND_TIMEOUT_SECONDS.get(
                row["channel"],
                max(CHANNEL_SEND_TIMEOUT_SECONDS.values()),
            )
            lease_seconds = send_timeout + DELIVERY_LEASE_MARGIN_SECONDS
            async with pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(_SKIP_DISABLED_SQL)
                    await conn.execute(_SKIP_STALE_SQL)
                    prepared_id = await conn.fetchval(
                        _PREPARE_SEND_SQL,
                        row["id"],
                        row["attempt_count"],
                        lease_seconds,
                    )
            if prepared_id is None:
                continue
            subject = (
                f"[SadarBencana][{row.get('severity') or 'ALERT'}] "
                f"{row.get('alert_type') or 'alert'}"
                if row.get("delivery_kind") == "alert"
                else f"[SadarBencana] {row['lifecycle_action']}"
            )
            try:
                send_result = await asyncio.wait_for(
                    adapter.send(
                        recipient,
                        lifecycle_message(row),
                        subject=subject,
                        notification_kind=row.get("delivery_kind"),
                        severity=row.get("severity"),
                        alert_type=row.get("alert_type"),
                        headline=row.get("headline"),
                        description=row.get("description"),
                        source=row.get("source"),
                        occurred_at=row.get("source_sent_at"),
                        lifecycle_action=row.get("lifecycle_action"),
                    ),
                    timeout=send_timeout,
                )
                error = send_result.get("error")
            except TimeoutError:
                error = "delivery_timeout"

        current = now or datetime.now(timezone.utc)
        async with pool.acquire() as conn:
            # Recheck containment/currentness after network I/O. A disable,
            # rollback, update, or cancellation may have committed meanwhile.
            await conn.execute(_SKIP_DISABLED_SQL)
            await conn.execute(_SKIP_STALE_SQL)
            if send_result.get("success"):
                updated_id = await conn.fetchval(
                    _MARK_SENT_SQL,
                    row["id"],
                    current,
                    row["source_sent_at"],
                    send_result.get("provider_id"),
                    row["attempt_count"],
                )
                if updated_id is None:
                    continue
                result["sent"] += 1
                if row.get("correlation_id"):
                    await record_observation(
                        pool,
                        correlation_id=row["correlation_id"],
                        stage="notification_sent",
                        source_name=row.get("source"),
                        success=True,
                        duration_ms=max(
                            0,
                            int((current - row["source_sent_at"]).total_seconds() * 1000),
                        ),
                        metadata={
                            "channel": row["channel"],
                            "lifecycle_action": row["lifecycle_action"],
                        },
                    )
            else:
                attempts = int(row["attempt_count"])
                dead = attempts >= MAX_DELIVERY_ATTEMPTS
                status = "dead_letter" if dead else "failed"
                next_attempt = None if dead else current + retry_delay(attempts)
                updated_id = await conn.fetchval(
                    _MARK_FAILED_SQL,
                    row["id"],
                    status,
                    error or "delivery_failed",
                    next_attempt,
                    row["attempt_count"],
                )
                if updated_id is None:
                    continue
                result[status] += 1
                if row.get("correlation_id"):
                    await record_observation(
                        pool,
                        correlation_id=row["correlation_id"],
                        stage="notification_delivery",
                        source_name=row.get("source"),
                        success=False,
                        error_code=error or "delivery_failed",
                        metadata={"channel": row["channel"], "status": status},
                    )
    return result


__all__ = [
    "enqueue_official_alert_revision",
    "expire_and_enqueue_official_alert_revisions",
    "lifecycle_action",
    "lifecycle_message",
    "process_due_deliveries",
    "persist_official_alert_revision",
    "retry_delay",
]
