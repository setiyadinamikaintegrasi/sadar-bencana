"""EWS dispatcher: match alerts to subscribers and deliver notifications."""

from __future__ import annotations

import logging
from datetime import datetime, time, timezone
from typing import Any

import asyncpg

from alerts.channels import CHANNELS
from alerts.geo import find_matching_subscriber_ids
from db.subscribers import (
    fetch_active_subscribers,
    fetch_active_watch_zones,
    fetch_subscriber_prefs,
    is_already_notified,
    log_notification,
)

logger = logging.getLogger(__name__)

_SEVERITY_ORDER = {"Moderate": 1, "High": 2, "Critical": 3}


def _severity_rank(severity: str) -> int:
    return _SEVERITY_ORDER.get(severity, 0)


def _is_within_quiet_hours(
    start: time | None, end: time | None, now_utc: datetime | None = None
) -> bool:
    """Check if current time falls within quiet hours window."""
    if not start or not end:
        return False
    now = now_utc or datetime.now(timezone.utc)
    current_time = now.astimezone().time()
    if start <= end:
        return start <= current_time <= end
    # Wraps midnight (e.g., 22:00–07:00)
    return current_time >= start or current_time <= end


async def dispatch_alert(
    pool: asyncpg.Pool,
    alert: dict[str, Any],
    event_data: dict[str, Any] | None = None,
) -> int:
    """
    Dispatch a single alert to all matching subscribers.

    Args:
        pool: Database connection pool.
        alert: Alert dict with keys: id, alert_type, severity, message.
        event_data: Optional event dict with lat, lon, magnitude, event_type.

    Returns:
        Number of notifications successfully sent.
    """
    alert_id = alert.get("id")
    severity = alert.get("severity", "High")
    alert_type = alert.get("alert_type", "")
    message = alert.get("message", "")

    if not alert_id:
        logger.warning("Dispatch called with alert missing 'id', skipping")
        return 0

    # Load all active subscribers + watch zones
    subscribers = await fetch_active_subscribers(pool)
    if not subscribers:
        return 0

    zones = await fetch_active_watch_zones(pool)

    # Geo-matching: find which subscribers have zones matching this event.
    matched_subscriber_ids: set[str] | None = None
    if event_data and event_data.get("latitude") is not None:
        matched_subscriber_ids = find_matching_subscriber_ids(
            zones,
            float(event_data["latitude"]),
            float(event_data["longitude"]),
            event_data.get("event_type"),
            float(event_data.get("magnitude", 0)),
        )
        # Subscribers WITH zones must match; subscribers WITHOUT any zones
        # remain global watchers and are always included.

    sent_count = 0

    for sub in subscribers:
        sub_id = str(sub["id"])

        has_zones = any(
            str(z["subscriber_id"]) == sub_id for z in zones
        )
        if (
            has_zones
            and matched_subscriber_ids is not None
            and sub_id not in matched_subscriber_ids
        ):
            continue

        # Load this subscriber's channel preferences
        prefs = await fetch_subscriber_prefs(pool, sub["id"])
        if not prefs:
            continue

        for pref in prefs:
            channel = pref["channel"]

            # Severity filter
            if _severity_rank(severity) < _severity_rank(
                pref.get("min_severity", "High")
            ):
                continue

            # Alert type filter
            pref_types = pref.get("alert_types") or []
            if pref_types and alert_type not in pref_types:
                continue

            # Quiet hours filter
            if _is_within_quiet_hours(
                pref.get("quiet_hours_start"), pref.get("quiet_hours_end")
            ):
                await log_notification(
                    pool, sub["id"], alert_id, channel, "skipped",
                    "quiet_hours",
                )
                continue

            # Dedup check
            if await is_already_notified(pool, sub["id"], alert_id, channel):
                continue

            # Resolve recipient address for this channel
            recipient = _get_recipient(sub, channel)
            if not recipient:
                await log_notification(
                    pool, sub["id"], alert_id, channel, "skipped",
                    f"no_{channel}_address",
                )
                continue

            # Send via channel adapter
            adapter = CHANNELS.get(channel)
            if not adapter:
                continue

            send_kwargs: dict[str, Any] = {}
            if channel == "email":
                send_kwargs["subject"] = (
                    f"[Sadar Bencana EWS][{severity.upper()}] {alert_type}"
                )

            result = await adapter.send(recipient, message, **send_kwargs)

            status = "sent" if result.get("success") else "failed"
            error = result.get("error")

            await log_notification(
                pool, sub["id"], alert_id, channel, status,
                error, datetime.now(timezone.utc),
            )

            if result.get("success"):
                sent_count += 1
                logger.info(
                    "EWS sent: subscriber=%s channel=%s alert=%s",
                    sub["name"], channel, alert_id,
                )
            else:
                logger.warning(
                    "EWS failed: subscriber=%s channel=%s error=%s",
                    sub["name"], channel, error,
                )

    return sent_count


def _get_recipient(subscriber: dict[str, Any], channel: str) -> str | None:
    """Extract the recipient address for a given channel."""
    if channel == "telegram":
        cid = subscriber.get("telegram_chat_id")
        return str(cid) if cid else None
    if channel == "whatsapp":
        return subscriber.get("phone_whatsapp")
    if channel == "email":
        return subscriber.get("email")
    return None
