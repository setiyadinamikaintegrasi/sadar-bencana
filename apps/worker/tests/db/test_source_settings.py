from unittest.mock import AsyncMock, MagicMock

import pytest

from db.source_settings import (
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
async def test_missing_settings_table_falls_back_to_legacy_env():
    conn = AsyncMock()
    conn.fetchrow.side_effect = RuntimeError("relation does not exist")
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
    assert await resolve_source_setting(pool, "bnpb") is None


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
        "ews_delivery_queue": 0,
        "source_evidence": 0,
        "source_records": 0,
        "disaster_observability_events": 0,
    }
