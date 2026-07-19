from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager
import json
from types import SimpleNamespace
from unittest.mock import ANY, AsyncMock, MagicMock

import pytest

import main as worker_main
from db.source_settings import MissingSourceSettingError


@asynccontextmanager
async def _connection(connection):
    yield connection


@pytest.mark.asyncio
async def test_topology_validation_repairs_self_intersection_before_persistence():
    repaired = {
        "type": "MultiPolygon",
        "coordinates": [[[[106.0, -6.0], [107.0, -7.0], [106.0, -8.0], [106.0, -6.0]]]],
    }
    connection = SimpleNamespace(
        fetchrow=AsyncMock(return_value={
            "repaired": True,
            "geometry_type": "MULTIPOLYGON",
            "valid": True,
            "empty": False,
            "geojson": json.dumps(repaired),
        })
    )
    pool = SimpleNamespace(acquire=lambda: _connection(connection))
    alert = SimpleNamespace(
        source_alert_id="self-intersection",
        area_geojson={
            "type": "Polygon",
            "coordinates": [[
                [106.0, -6.0], [108.0, -8.0], [108.0, -6.0],
                [106.0, -8.0], [106.0, -6.0],
            ]],
        },
        raw_payload={},
    )

    errors = await worker_main._official_alert_topology_errors(pool, [alert])

    assert errors == []
    assert alert.area_geojson == repaired
    assert alert.raw_payload["area_geometry_normalization"] == "postgis_st_makevalid"
    assert "ST_MakeValid" in connection.fetchrow.await_args.args[0]


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


@asynccontextmanager
async def _poll_slot(*_args, allowed=True, source_name="bmkg_cap", **_kwargs):
    yield SimpleNamespace(source_name=source_name, connection=object()) if allowed else None


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
    reserve = MagicMock(
        side_effect=lambda *args, **kwargs: _poll_slot(
            *args, allowed=False, **kwargs
        )
    )
    monkeypatch.setattr(worker_main, "acquire_source_poll_slot", reserve)

    assert await worker_main._bmkg_cap_cycle(object(), now=now) == 0
    connector.assert_not_called()
    reserve.assert_called_once_with(
        ANY,
        "bmkg_cap",
        config_version=4,
        poll_interval_seconds=600,
        now=now,
    )


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
    monkeypatch.setattr(
        worker_main,
        "acquire_source_poll_slot",
        MagicMock(side_effect=_poll_slot),
    )

    assert await worker_main._bmkg_cap_cycle(object()) == 0
    connector.assert_not_called()
    health.assert_not_awaited()


@pytest.mark.asyncio
async def test_bmkg_cap_missing_control_plane_row_fails_closed(monkeypatch):
    monkeypatch.setenv("CONNECTOR_BMKG_CAP_ENABLED", "true")
    monkeypatch.setattr(
        worker_main,
        "resolve_source_setting",
        AsyncMock(side_effect=MissingSourceSettingError("bmkg_cap missing")),
    )
    connector = MagicMock()
    reserve = MagicMock()
    monkeypatch.setattr(worker_main, "BMKGCAPConnector", connector)
    monkeypatch.setattr(worker_main, "acquire_source_poll_slot", reserve)

    assert await worker_main._bmkg_cap_cycle(object()) == 0
    connector.assert_not_called()
    reserve.assert_not_called()


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
    monkeypatch.setattr(worker_main, "complete_source_poll", AsyncMock())
    monkeypatch.setattr(
        worker_main,
        "acquire_source_poll_slot",
        MagicMock(side_effect=_poll_slot),
    )
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
