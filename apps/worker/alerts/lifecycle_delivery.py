"""Reliable official-alert lifecycle delivery with revision dedup and retries."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg

from alerts.channels import CHANNELS

MAX_DELIVERY_ATTEMPTS = 5
BASE_RETRY_SECONDS = 30

_ENQUEUE_ACTIVE_SQL = """
INSERT INTO ews_notification_log (
    subscriber_id, official_alert_id, channel, status, source, source_alert_id,
    alert_revision, lifecycle_action, next_attempt_at
)
SELECT s.id, $1, p.channel, 'pending', $2, $3, $4, $5, now()
FROM ews_subscribers s
JOIN ews_notification_prefs p ON p.subscriber_id = s.id
WHERE s.is_active = TRUE AND p.is_enabled = TRUE
ON CONFLICT DO NOTHING
RETURNING id
"""

_ENQUEUE_PRIOR_RECIPIENTS_SQL = """
INSERT INTO ews_notification_log (
    subscriber_id, official_alert_id, channel, status, source, source_alert_id,
    alert_revision, lifecycle_action, next_attempt_at
)
SELECT DISTINCT subscriber_id, $1, channel, 'pending', $2, $3, $4, $5, now()
FROM ews_notification_log
WHERE source = $2 AND source_alert_id = $3
  AND status IN ('sent', 'acknowledged')
ON CONFLICT DO NOTHING
RETURNING id
"""

_CLAIM_DUE_SQL = """
WITH due AS (
    SELECT l.id
    FROM ews_notification_log l
    WHERE l.status IN ('pending', 'failed')
      AND l.next_attempt_at <= now()
      AND l.attempt_count < $1
    ORDER BY l.next_attempt_at
    LIMIT $2
    FOR UPDATE SKIP LOCKED
)
UPDATE ews_notification_log l
SET attempt_count = l.attempt_count + 1,
    last_attempt_at = now()
FROM due, ews_subscribers s, official_alerts oa
WHERE l.id = due.id
  AND s.id = l.subscriber_id
  AND oa.id = l.official_alert_id
RETURNING l.*, s.email, s.phone_whatsapp, s.telegram_chat_id,
          oa.headline, oa.description, oa.sent_at
"""

_MARK_SENT_SQL = """
UPDATE ews_notification_log
SET status = 'sent', error_message = NULL, sent_at = $2,
    next_attempt_at = NULL,
    delivery_latency_ms = GREATEST(0, (EXTRACT(EPOCH FROM ($2 - $3)) * 1000)::bigint)
WHERE id = $1
"""

_MARK_FAILED_SQL = """
UPDATE ews_notification_log
SET status = $2, error_message = $3, next_attempt_at = $4,
    dead_lettered_at = CASE WHEN $2 = 'dead_letter' THEN now() ELSE NULL END
WHERE id = $1
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
) -> int:
    action = lifecycle_action(str(alert["message_type"]), str(alert["status"]))
    sql = (
        _ENQUEUE_PRIOR_RECIPIENTS_SQL
        if action in {"cancellation", "expiry"}
        else _ENQUEUE_ACTIVE_SQL
    )
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            sql,
            alert["id"],
            alert["source"],
            alert["source_alert_id"],
            alert["revision"],
            action,
        )
    return len(rows)


def _recipient(row: dict[str, Any]) -> str | None:
    channel = row["channel"]
    if channel == "telegram" and row.get("telegram_chat_id"):
        return str(row["telegram_chat_id"])
    if channel == "whatsapp":
        return row.get("phone_whatsapp")
    if channel == "email":
        return row.get("email")
    return None


async def process_due_deliveries(
    pool: asyncpg.Pool,
    *,
    batch_size: int = 100,
    now: datetime | None = None,
) -> dict[str, int]:
    current = now or datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        async with conn.transaction():
            rows = await conn.fetch(
                _CLAIM_DUE_SQL,
                MAX_DELIVERY_ATTEMPTS,
                batch_size,
            )

    result = {"sent": 0, "failed": 0, "dead_letter": 0}
    for raw in rows:
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
            send_result = await adapter.send(
                recipient,
                lifecycle_message(row),
                subject=f"[SadarBencana] {row['lifecycle_action']}",
            )
            error = send_result.get("error")

        async with pool.acquire() as conn:
            if send_result.get("success"):
                await conn.execute(
                    _MARK_SENT_SQL,
                    row["id"],
                    current,
                    row["sent_at"],
                )
                result["sent"] += 1
            else:
                attempts = int(row["attempt_count"])
                dead = attempts >= MAX_DELIVERY_ATTEMPTS
                status = "dead_letter" if dead else "failed"
                next_attempt = None if dead else current + retry_delay(attempts)
                await conn.execute(
                    _MARK_FAILED_SQL,
                    row["id"],
                    status,
                    error or "delivery_failed",
                    next_attempt,
                )
                result[status] += 1
    return result


__all__ = [
    "enqueue_official_alert_revision",
    "lifecycle_action",
    "lifecycle_message",
    "process_due_deliveries",
    "retry_delay",
]
