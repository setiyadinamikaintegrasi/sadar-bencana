from unittest.mock import AsyncMock, MagicMock

import pytest

from db.source_settings import (
    MissingSourceSettingError,
    acquire_source_poll_slot,
    capture_worker_shadow_persistence_counts,
    complete_source_poll,
    record_worker_shadow_evidence,
    resolve_source_setting,
    source_write_is_allowed,
)


def _pool(row):
    conn = AsyncMock()
    conn.fetchrow.return_value = row
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
    return pool


@pytest.mark.asyncio
async def test_auto_prefers_custom_url_over_environment(monkeypatch):
    monkeypatch.setenv("INATEWS_FEED_URL", "https://data.bmkg.go.id/environment")
    setting = await resolve_source_setting(_pool({
        "source_name": "inatews",
        "enabled": True,
        "mode": "auto",
        "default_api_url": None,
        "custom_api_url": "https://rtsp.bmkg.go.id/custom",
        "attribution": "Sumber: BMKG",
        "api_token": "secret",
    }), "inatews")
    assert setting.api_url == "https://rtsp.bmkg.go.id/custom"
    assert setting.api_token == "secret"
    assert setting.run_mode == "active"
    assert setting.adapter_version == "v1"


@pytest.mark.asyncio
async def test_auto_uses_environment_then_default(monkeypatch):
    monkeypatch.setenv("BNPB_FEED_URL", "https://data.bnpb.go.id/environment")
    setting = await resolve_source_setting(_pool({
        "source_name": "bnpb", "enabled": True, "mode": "auto",
        "default_api_url": "https://data.bnpb.go.id/default",
        "custom_api_url": None, "attribution": "BNPB", "api_token": None,
    }), "bnpb")
    assert setting.api_url.endswith("/environment")


@pytest.mark.asyncio
async def test_dry_run_setting_loads_versioned_mapping():
    setting = await resolve_source_setting(_pool({
        "source_name": "bnpb", "enabled": True, "mode": "custom_api",
        "default_api_url": None, "custom_api_url": "https://data.bnpb.go.id/feed",
        "attribution": "BNPB", "api_token": None, "run_mode": "dry_run",
        "adapter_version": "v1",
        "field_mapping": '{"report_id":"id","observed_at":"time.observed"}',
        "config_version": 3,
        "poll_interval_seconds": 1800,
        "expected_interval_seconds": 3600,
    }), "bnpb")
    assert setting.enabled
    assert setting.run_mode == "dry_run"
    assert setting.field_mapping["report_id"] == "id"
    assert setting.config_version == 3
    assert setting.poll_interval_seconds == 1800
    assert setting.expected_interval_seconds == 3600


@pytest.mark.asyncio
async def test_air_quality_auto_mode_uses_gated_environment_endpoint(monkeypatch):
    monkeypatch.setenv(
        "BMKG_AIR_QUALITY_FEED_URL",
        "https://iklim.bmkg.go.id/api/air-quality",
    )
    setting = await resolve_source_setting(_pool({
        "source_name": "bmkg_air_quality",
        "enabled": False,
        "mode": "auto",
        "default_api_url": None,
        "custom_api_url": None,
        "attribution": "BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)",
        "api_token": None,
        "run_mode": "disabled",
        "expected_interval_seconds": 3600,
    }), "bmkg_air_quality")

    assert setting.api_url == "https://iklim.bmkg.go.id/api/air-quality"
    assert not setting.enabled
    assert setting.run_mode == "disabled"
    assert setting.expected_interval_seconds == 3600


@pytest.mark.asyncio
async def test_enabled_flag_and_run_mode_must_both_allow_polling():
    setting = await resolve_source_setting(_pool({
        "source_name": "bmkg_cap",
        "enabled": False,
        "mode": "default_public",
        "default_api_url": "https://www.bmkg.go.id/alerts/nowcast/id",
        "custom_api_url": None,
        "attribution": "BMKG",
        "api_token": None,
        "run_mode": "active",
    }), "bmkg_cap")

    assert setting.enabled is False


@pytest.mark.asyncio
async def test_missing_settings_table_falls_back_to_legacy_env():
    conn = AsyncMock()
    conn.fetchrow.side_effect = __import__("asyncpg").UndefinedTableError(
        "relation does not exist"
    )
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
    assert await resolve_source_setting(pool, "bnpb") is None


@pytest.mark.asyncio
async def test_settings_read_error_is_not_converted_to_legacy_fallback():
    conn = AsyncMock()
    conn.fetchrow.side_effect = RuntimeError("database unavailable")
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)

    with pytest.raises(RuntimeError, match="database unavailable"):
        await resolve_source_setting(pool, "bmkg_cap")


@pytest.mark.asyncio
async def test_missing_settings_row_fails_closed():
    with pytest.raises(MissingSourceSettingError, match="bmkg_cap"):
        await resolve_source_setting(_pool(None), "bmkg_cap")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("row", "expected"),
    [
        ({"enabled": True, "run_mode": "active", "config_version": 7}, True),
        ({"enabled": False, "run_mode": "disabled", "config_version": 7}, False),
        ({"enabled": True, "run_mode": "dry_run", "config_version": 7}, False),
        ({"enabled": True, "run_mode": "active", "config_version": 8}, False),
        (None, False),
    ],
)
async def test_source_write_barrier_locks_and_matches_active_config(row, expected):
    conn = AsyncMock()
    conn.fetchrow.return_value = row

    assert await source_write_is_allowed(conn, "bmkg_air_quality", 7) is expected
    sql = " ".join(conn.fetchrow.await_args.args[0].split())
    assert "FOR SHARE" in sql


@pytest.mark.asyncio
async def test_worker_shadow_audit_records_current_version_and_zero_persistence():
    conn = AsyncMock()
    pool = _pool({})
    pool.acquire.return_value.__aenter__.return_value = conn
    setting = type("Setting", (), {
        "source_name": "bmkg_air_quality",
        "config_version": 7,
        "adapter_version": "v1",
    })()

    await record_worker_shadow_evidence(
        pool,
        setting,
        success=True,
        item_count=2,
        errors=[],
        persistence_counts={
            "official_alerts": 0,
            "air_quality_observations": 0,
            "ews_notification_log": 0,
            "source_records": 0,
            "disaster_observability_events": 0,
        },
    )

    args = conn.execute.await_args.args
    assert args[1:5] == ("bmkg_air_quality", 7, True, "worker@sadarbencana.local")
    metadata = __import__("json").loads(args[5])
    assert metadata["stage"] == "worker_shadow"
    assert metadata["config_version"] == 7
    assert metadata["zero_persistence"] is True
    assert metadata["persistence_counts"] == {
        "official_alerts": 0,
        "air_quality_observations": 0,
        "ews_notification_log": 0,
        "source_records": 0,
        "disaster_observability_events": 0,
    }


@pytest.mark.asyncio
async def test_worker_shadow_nonzero_delta_fails_evidence():
    conn = AsyncMock()
    pool = _pool({})
    pool.acquire.return_value.__aenter__.return_value = conn
    setting = type("Setting", (), {
        "source_name": "bmkg_cap",
        "config_version": 11,
        "adapter_version": "v1",
    })()

    await record_worker_shadow_evidence(
        pool,
        setting,
        success=True,
        item_count=1,
        errors=[],
        persistence_counts={
            "official_alerts": 1,
            "air_quality_observations": 0,
            "ews_notification_log": 0,
            "source_records": 0,
            "disaster_observability_events": 0,
        },
    )

    args = conn.execute.await_args.args
    metadata = __import__("json").loads(args[5])
    assert args[3] is False
    assert metadata["zero_persistence"] is False
    assert metadata["persistence_counts"]["official_alerts"] == 1
    assert "unexpected_shadow_persistence" in metadata["errors"]


@pytest.mark.asyncio
async def test_shadow_counts_are_source_scoped():
    conn = AsyncMock()
    conn.fetchval.side_effect = [2, 3, 4, 5, 6]
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)

    counts = await capture_worker_shadow_persistence_counts(pool, "bmkg_cap")

    assert counts == {
        "official_alerts": 2,
        "air_quality_observations": 3,
        "ews_notification_log": 4,
        "source_records": 5,
        "disaster_observability_events": 6,
    }
    assert conn.fetchval.await_count == 5
    assert all(call.args[1] == "bmkg_cap" for call in conn.fetchval.await_args_list)


@pytest.mark.asyncio
async def test_air_quality_shadow_uses_persisted_bmkg_source_identifier():
    conn = AsyncMock()
    conn.fetchval.side_effect = [0, 1, 0, 0, 0]
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)

    counts = await capture_worker_shadow_persistence_counts(
        pool,
        "bmkg_air_quality",
    )

    assert counts["air_quality_observations"] == 1
    calls = conn.fetchval.await_args_list
    assert calls[1].args[1] == "bmkg"
    assert all(
        call.args[1] == "bmkg_air_quality"
        for index, call in enumerate(calls)
        if index != 1
    )


@pytest.mark.asyncio
async def test_poll_slot_uses_session_lock_without_mutating_health():
    conn = AsyncMock()
    conn.fetchval.side_effect = [True, True]
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)

    async with acquire_source_poll_slot(
        pool, "bmkg_cap", config_version=7, poll_interval_seconds=600
    ) as slot:
        assert slot is not None
        assert conn.execute.await_count == 0

    lock_sql, lock_key = conn.fetchval.await_args_list[0].args
    due_sql, source, version, _now, interval = conn.fetchval.await_args_list[1].args
    assert "pg_try_advisory_lock" in lock_sql
    assert lock_key == "official-source-poll:bmkg_cap"
    assert "connector_health" in due_sql
    assert "config_version" in due_sql
    assert (source, version, interval) == ("bmkg_cap", 7, 600)
    assert "pg_advisory_unlock" in conn.execute.await_args.args[0]


@pytest.mark.asyncio
async def test_complete_source_poll_records_only_completed_result():
    conn = AsyncMock()
    slot = type("Slot", (), {"source_name": "bmkg_cap", "connection": conn})()

    await complete_source_poll(slot, items_fetched=3, error_message=None)

    sql, source, completed_at, items, error = conn.execute.await_args.args
    assert "connector_health" in sql
    assert (source, items, error) == ("bmkg_cap", 3, None)
    assert completed_at.tzinfo is not None
