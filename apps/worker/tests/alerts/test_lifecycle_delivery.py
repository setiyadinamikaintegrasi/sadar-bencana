from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from alerts import lifecycle_delivery
from alerts.lifecycle_delivery import (
    enqueue_official_alert_revision,
    expire_and_enqueue_official_alert_revisions,
    lifecycle_action,
    lifecycle_message,
    persist_official_alert_revision,
    retry_delay,
)
from observability import disaster_correlation_id


def fake_pool(returning):
    conn = AsyncMock()
    conn.fetch.return_value = returning
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
    transaction = MagicMock()
    transaction.__aenter__ = AsyncMock(return_value=None)
    transaction.__aexit__ = AsyncMock(return_value=None)
    conn.transaction = MagicMock(return_value=transaction)
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
        "CASE",
        "ST_IsValid",
        "ST_Intersects",
        "oa.area_geojson IS NOT NULL",
        "ELSE FALSE",
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
async def test_out_of_order_non_current_revision_never_supersedes_or_enqueues():
    pool, conn = fake_pool([])

    result = await enqueue_official_alert_revision(
        pool,
        official_alert(revision=3, is_current=False),
    )

    assert result == 0
    conn.fetch.assert_not_awaited()
    conn.execute.assert_not_awaited()


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
    assert "l.status IN ('pending', 'failed', 'sent', 'acknowledged')" in sql
    assert (
        "ORDER BY l.subscriber_id, l.channel, l.alert_revision DESC, "
        "l.created_at DESC"
    ) in " ".join(sql.split())
    assert "ON CONFLICT DO NOTHING" in sql
    assert "ST_Intersects" not in sql
    assert "ST_DWithin" not in sql
    assert "ews_watch_zones" not in sql
    assert "ews_notification_prefs" not in sql

    supersede_call = conn.execute.await_args.args
    assert supersede_call[1:] == ("bmkg_cap", "cap-1", 2)
    assert "status = 'skipped'" in supersede_call[0]
    assert "alert_revision < $3" in supersede_call[0]


def test_claim_only_dispatches_the_current_official_alert_revision():
    sql = " ".join(lifecycle_delivery._CLAIM_DUE_SQL.split())

    assert "current_alert.is_current = TRUE" in sql
    assert "current_alert.id = l.official_alert_id" in sql


def test_claim_uses_lease_and_active_source_barrier():
    sql = " ".join(lifecycle_delivery._CLAIM_DUE_SQL.split())

    assert "next_attempt_at = now() +" in sql
    assert "official_source_settings" in sql
    assert "source_setting.enabled = TRUE" in sql
    assert "source_setting.run_mode = 'active'" in sql


def test_pre_send_cas_revalidates_lease_revision_and_source():
    sql = " ".join(lifecycle_delivery._PREPARE_SEND_SQL.split())

    assert "attempt_count = $2" in sql
    assert "status IN ('pending', 'failed')" in sql
    assert "next_attempt_at > now()" in sql
    assert "current_alert.is_current = TRUE" in sql
    assert "source_setting.enabled = TRUE" in sql
    assert "source_setting.run_mode = 'active'" in sql
    assert "RETURNING id" in sql


def test_delivery_callbacks_compare_and_set_the_claim_attempt():
    sent_sql = " ".join(lifecycle_delivery._MARK_SENT_SQL.split())
    failed_sql = " ".join(lifecycle_delivery._MARK_FAILED_SQL.split())

    for sql in (sent_sql, failed_sql):
        assert "attempt_count = $" in sql
        assert "status IN ('pending', 'failed')" in sql
        assert "current_alert.is_current = TRUE" in sql
        assert "source_setting.enabled = TRUE" in sql
        assert "source_setting.run_mode = 'active'" in sql
        assert "RETURNING id" in sql


def test_disabled_official_source_rows_are_deterministically_skipped():
    sql = " ".join(lifecycle_delivery._SKIP_DISABLED_SQL.split())

    assert "status = 'skipped'" in sql
    assert "source_disabled_or_not_active" in sql
    assert "official_source_settings" in sql
    assert "source_setting.enabled = TRUE" in sql
    assert "source_setting.run_mode = 'active'" in sql


def test_stale_official_delivery_is_deterministically_skipped():
    sql = " ".join(lifecycle_delivery._SKIP_STALE_SQL.split())

    assert "status = 'skipped'" in sql
    assert "official_alert_revision_not_current" in sql
    assert "current_alert.is_current = TRUE" in sql


def test_claimed_official_delivery_prefers_official_severity_and_peril_type():
    sql = lifecycle_delivery._CLAIM_DUE_SQL

    assert "COALESCE(oa.severity, a.severity, '') AS severity" in sql
    assert (
        "COALESCE(oa.peril_type, a.alert_type, c.lifecycle_action, 'alert') "
        "AS alert_type"
    ) in " ".join(sql.split())


@pytest.mark.asyncio
async def test_duplicate_revision_recovers_missing_enqueue_in_same_transaction(
    monkeypatch,
):
    pool, conn = fake_pool([])
    row = official_alert(is_current=True)
    input_alert = object()
    source_record = object()
    upsert = AsyncMock(return_value=(row, False))
    enqueue = AsyncMock(return_value=1)
    create_source = AsyncMock()
    monkeypatch.setattr(lifecycle_delivery, "upsert_official_alert", upsert)
    monkeypatch.setattr(lifecycle_delivery, "enqueue_official_alert_revision", enqueue)
    monkeypatch.setattr(lifecycle_delivery, "create_source_record", create_source)

    persisted, created, allowed = await persist_official_alert_revision(
        pool,
        input_alert,
        source_record=source_record,
        delivery_enabled=True,
    )

    assert (persisted, created, allowed) == (row, False, True)
    upsert.assert_awaited_once_with(pool, input_alert, connection=conn)
    create_source.assert_awaited_once_with(pool, source_record, connection=conn)
    enqueue.assert_awaited_once_with(pool, row, connection=conn)
    conn.transaction.assert_called_once()


@pytest.mark.asyncio
async def test_current_config_barrier_blocks_revision_and_enqueue(monkeypatch):
    pool, conn = fake_pool([])
    barrier = AsyncMock(return_value=False)
    upsert = AsyncMock()
    enqueue = AsyncMock()
    monkeypatch.setattr(lifecycle_delivery, "source_write_is_allowed", barrier)
    monkeypatch.setattr(lifecycle_delivery, "upsert_official_alert", upsert)
    monkeypatch.setattr(lifecycle_delivery, "enqueue_official_alert_revision", enqueue)

    result = await persist_official_alert_revision(
        pool,
        object(),
        source_name="bmkg_air_quality",
        expected_config_version=7,
        delivery_enabled=True,
    )

    assert result == ({}, False, False)
    barrier.assert_awaited_once_with(conn, "bmkg_air_quality", 7)
    upsert.assert_not_awaited()
    enqueue.assert_not_awaited()


@pytest.mark.asyncio
async def test_expiry_and_enqueue_share_one_transaction(monkeypatch):
    pool, conn = fake_pool([])
    expired = [official_alert(status="expired")]
    expire = AsyncMock(return_value=expired)
    enqueue = AsyncMock(return_value=1)
    monkeypatch.setattr(lifecycle_delivery, "expire_official_alert_revisions", expire)
    monkeypatch.setattr(lifecycle_delivery, "enqueue_official_alert_revision", enqueue)

    result = await expire_and_enqueue_official_alert_revisions(
        pool,
        delivery_enabled=True,
    )

    assert result == expired
    expire.assert_awaited_once_with(pool, connection=conn)
    enqueue.assert_awaited_once_with(pool, expired[0], connection=conn)
