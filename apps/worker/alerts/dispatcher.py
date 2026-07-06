"""EWS dispatcher: match alerts to subscribers and deliver notifications."""

from __future__ import annotations

import logging
from datetime import datetime, time, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import asyncpg

from alerts.geo import find_matching_subscriber_ids
from db.subscribers import (
    enqueue_alert_notification,
    fetch_active_subscribers,
    fetch_active_watch_zones,
    fetch_subscriber_prefs,
    is_channel_enabled,
    is_already_notified,
    log_notification,
)

logger = logging.getLogger(__name__)

_SEVERITY_ORDER = {"Moderate": 1, "High": 2, "Critical": 3}


def _severity_rank(severity: str) -> int:
    return _SEVERITY_ORDER.get(severity, 0)


def _is_within_quiet_hours(
    start: time | None,
    end: time | None,
    now_utc: datetime | None = None,
    timezone_name: str = "Asia/Jakarta",
) -> bool:
    """Check if current time falls within quiet hours window."""
    if not start or not end:
        return False
    now = now_utc or datetime.now(timezone.utc)
    try:
        subscriber_timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        subscriber_timezone = ZoneInfo("Asia/Jakarta")
    current_time = now.astimezone(subscriber_timezone).time()
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
        Number of notifications successfully queued.
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
            event_data,
        )
        # Subscribers must own at least one active zone and match it.

    queued_count = 0

    for sub in subscribers:
        sub_id = str(sub["id"])

        has_zones = any(str(z["subscriber_id"]) == sub_id for z in zones)
        if not has_zones:
            continue
        if (
            matched_subscriber_ids is not None
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
                pref.get("quiet_hours_start"),
                pref.get("quiet_hours_end"),
                timezone_name=sub.get("timezone") or "Asia/Jakarta",
            ):
                await log_notification(
                    pool, sub["id"], alert_id, channel, "skipped",
                    "quiet_hours",
                )
                continue

            # Dedup check
            if await is_already_notified(pool, sub["id"], alert_id, channel):
                continue

            if not await is_channel_enabled(pool, channel):
                await log_notification(
                    pool, sub["id"], alert_id, channel, "skipped",
                    "channel_disabled",
                )
                continue

            # Resolve recipient address for this channel
            recipient = _get_recipient(sub, channel)
            if not recipient:
                await log_notification(
                    pool, sub["id"], alert_id, channel, "skipped",
                    f"no_{channel}_address",
                )
                continue

            queued = await enqueue_alert_notification(
                pool, sub["id"], alert_id, channel
            )
            if queued:
                queued_count += 1
                logger.info(
                    "EWS queued: subscriber_id=%s channel=%s alert=%s",
                    sub_id, channel, alert_id,
                )

    return queued_count


def _get_recipient(subscriber: dict[str, Any], channel: str) -> str | None:
    """Extract the recipient address for a given channel."""
    if channel == "telegram":
        cid = subscriber.get("telegram_chat_id")
        return str(cid) if cid else None
    if channel == "email":
        return subscriber.get("email")
    return None
