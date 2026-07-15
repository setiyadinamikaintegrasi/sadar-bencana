from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from alerts import lifecycle_delivery
from alerts.lifecycle_delivery import (
    enqueue_official_alert_revision,
    lifecycle_action,
    lifecycle_message,
    retry_delay,
)
from observability import disaster_correlation_id


def fake_pool(returning):
    conn = AsyncMock()
    conn.fetch.return_value = returning
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
    return pool, conn


def official_alert(**overrides):
    alert = {
        "id": "alert-1",
        "source": "bmkg_cap",
        "source_alert_id": "cap-1",
        "revision": 1,
        "message_type": "alert",
        "status": "active",
    }
    alert.update(overrides)
    return alert


def test_lifecycle_action_maps_update_cancel_and_expiry():
    assert lifecycle_action("alert", "active") == "alert"
    assert lifecycle_action("update", "active") == "update"
    assert lifecycle_action("cancel", "cancelled") == "cancellation"
    assert lifecycle_action("alert", "expired") == "expiry"


def test_retry_uses_bounded_exponential_schedule():
    assert retry_delay(1) == timedelta(seconds=30)
    assert retry_delay(2) == timedelta(seconds=60)
    assert retry_delay(5) == timedelta(seconds=480)


def test_cancellation_message_preserves_official_text():
    message = lifecycle_message(
        {
            "lifecycle_action": "cancellation",
            "headline": "Peringatan Dini Cuaca",
            "description": "Peringatan telah dicabut BMKG.",
        }
    )
    assert message.startswith("[DIBATALKAN] Peringatan Dini Cuaca")
    assert "dicabut BMKG" in message


def test_regular_alert_message_uses_persisted_alert_text():
    assert lifecycle_message(
        {"delivery_kind": "alert", "headline": "Gempa M6.1 dekat Jakarta"}
    ) == "Gempa M6.1 dekat Jakarta"


@pytest.mark.asyncio
async def test_initial_alert_matches_geometry_zone_peril_severity_and_preferences():
    pool, conn = fake_pool([{"id": "delivery-1"}])
    alert = official_alert()

    assert await enqueue_official_alert_revision(pool, alert) == 1

    call = conn.fetch.await_args.args
    sql = call[0]
    assert call[1:] == (
        "alert-1",
        "alert",
        disaster_correlation_id("bmkg_cap", "cap-1"),
    )
    for fragment in (
        "FROM official_alerts oa",
        "JOIN LATERAL",
        "ST_Intersects",
        "oa.area_geojson IS NOT NULL",
        "ST_DWithin",
        "oa.latitude IS NOT NULL AND oa.longitude IS NOT NULL",
        "cardinality(z.peril_types) = 0 OR oa.peril_type = ANY(z.peril_types)",
        "z.is_active = TRUE",
        "p.is_enabled = TRUE",
        "oa.severity IS NOT NULL",
        ">= CASE p.min_severity",
        "cardinality(p.alert_types) = 0 OR oa.peril_type = ANY(p.alert_types)",
        "ORDER BY z.created_at, z.id",
        "matched_watch_zone_id",
        "ON CONFLICT DO NOTHING",
    ):
        assert fragment in sql


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("message_type", "status", "expected_action"),
    [
        ("update", "active", "update"),
        ("cancel", "cancelled", "cancellation"),
        ("alert", "expired", "expiry"),
    ],
)
async def test_lifecycle_changes_use_latest_successful_prior_recipient_and_zone(
    message_type,
    status,
    expected_action,
):
    pool, conn = fake_pool([])
    alert = official_alert(
        id="alert-2",
        revision=2,
        message_type=message_type,
        status=status,
    )

    assert await enqueue_official_alert_revision(pool, alert) == 0

    call = conn.fetch.await_args.args
    sql = call[0]
    assert call[1:] == (
        "alert-2",
        "bmkg_cap",
        "cap-1",
        2,
        expected_action,
        disaster_correlation_id("bmkg_cap", "cap-1"),
    )
    assert "matched_watch_zone_id" in sql
    assert "l.matched_watch_zone_id" in sql
    assert "SELECT DISTINCT ON (l.subscriber_id, l.channel)" in sql
    assert "l.status IN ('sent', 'acknowledged')" in sql
    assert (
        "ORDER BY l.subscriber_id, l.channel, l.alert_revision DESC, "
        "l.created_at DESC"
    ) in " ".join(sql.split())
    assert "ON CONFLICT DO NOTHING" in sql
    assert "ST_Intersects" not in sql
    assert "ST_DWithin" not in sql
    assert "ews_watch_zones" not in sql
    assert "ews_notification_prefs" not in sql


def test_claimed_official_delivery_prefers_official_severity_and_peril_type():
    sql = lifecycle_delivery._CLAIM_DUE_SQL

    assert "COALESCE(oa.severity, a.severity, '') AS severity" in sql
    assert (
        "COALESCE(oa.peril_type, a.alert_type, c.lifecycle_action, 'alert') "
        "AS alert_type"
    ) in " ".join(sql.split())
