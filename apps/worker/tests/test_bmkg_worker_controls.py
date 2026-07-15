from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import ANY, AsyncMock, MagicMock

import pytest

import main as worker_main


def _setting(**overrides):
    values = {
        "enabled": True,
        "api_url": "https://www.bmkg.go.id/alerts/nowcast/id",
        "api_token": None,
        "run_mode": "active",
        "config_version": 4,
        "adapter_version": "v1",
        "poll_interval_seconds": 600,
        "last_polled_at": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


@pytest.mark.asyncio
async def test_bmkg_cap_cycle_enforces_configured_poll_cadence(monkeypatch):
    now = datetime(2026, 7, 15, 5, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(
        worker_main,
        "resolve_source_setting",
        AsyncMock(return_value=_setting(last_polled_at=now - timedelta(seconds=599))),
    )
    connector = MagicMock()
    monkeypatch.setattr(worker_main, "BMKGCAPConnector", connector)

    assert await worker_main._bmkg_cap_cycle(object(), now=now) == 0
    connector.assert_not_called()


@pytest.mark.asyncio
async def test_bmkg_cap_settings_error_fails_closed_without_legacy_poll(monkeypatch):
    monkeypatch.setenv("CONNECTOR_BMKG_CAP_ENABLED", "true")
    monkeypatch.setattr(
        worker_main,
        "resolve_source_setting",
        AsyncMock(side_effect=RuntimeError("decrypt failed")),
    )
    connector = MagicMock()
    health = AsyncMock()
    monkeypatch.setattr(worker_main, "BMKGCAPConnector", connector)
    monkeypatch.setattr(worker_main, "upsert_connector_health", health)

    assert await worker_main._bmkg_cap_cycle(object()) == 0
    connector.assert_not_called()
    health.assert_not_awaited()


@pytest.mark.asyncio
async def test_bmkg_cap_shadow_reports_measured_persistence_delta(monkeypatch):
    setting = _setting(run_mode="dry_run")
    connector = MagicMock()
    connector.fetch_active = AsyncMock(return_value=([], []))
    connector.close = AsyncMock()
    before = {
        "official_alerts": 10,
        "air_quality_observations": 0,
        "ews_notification_log": 7,
        "source_records": 4,
        "disaster_observability_events": 8,
    }
    after = {**before, "official_alerts": 11}
    capture = AsyncMock(side_effect=[before, after])
    audit = AsyncMock()
    monkeypatch.setattr(
        worker_main,
        "resolve_source_setting",
        AsyncMock(return_value=setting),
    )
    monkeypatch.setattr(
        worker_main,
        "BMKGCAPConnector",
        MagicMock(return_value=connector),
    )
    monkeypatch.setattr(
        worker_main,
        "capture_worker_shadow_persistence_counts",
        capture,
    )
    monkeypatch.setattr(worker_main, "record_worker_shadow_evidence", audit)
    monkeypatch.setattr(worker_main, "upsert_connector_health", AsyncMock())
    monkeypatch.setattr(
        worker_main,
        "_official_alert_topology_errors",
        AsyncMock(return_value=[]),
    )

    assert await worker_main._bmkg_cap_cycle(object()) == 0

    assert capture.await_count == 2
    audit.assert_awaited_once_with(
        ANY,
        setting,
        success=True,
        item_count=0,
        errors=[],
        persistence_counts={
            "official_alerts": 1,
            "air_quality_observations": 0,
            "ews_notification_log": 0,
            "source_records": 0,
            "disaster_observability_events": 0,
        },
    )
