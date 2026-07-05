from unittest.mock import ANY, AsyncMock

import httpx
import pytest

import main as worker
from schedulers.opensky import OpenSkyPollGate, parse_retry_after


def test_opensky_poll_gate_keeps_regular_cadence_after_success() -> None:
    now = [100.0]
    gate = OpenSkyPollGate(
        interval_seconds=300,
        backoff_initial_seconds=900,
        backoff_max_seconds=3600,
        clock=lambda: now[0],
    )

    assert gate.ready()
    gate.succeeded()
    assert not gate.ready()
    assert gate.seconds_until_ready == 300

    now[0] += 300
    assert gate.ready()


def test_opensky_poll_gate_exponentially_backs_off_and_caps() -> None:
    now = [100.0]
    gate = OpenSkyPollGate(
        interval_seconds=300,
        backoff_initial_seconds=900,
        backoff_max_seconds=3600,
        clock=lambda: now[0],
    )

    assert gate.rate_limited() == 900
    now[0] += 900
    assert gate.rate_limited() == 1800
    now[0] += 1800
    assert gate.rate_limited(7200) == 3600


def test_opensky_success_resets_rate_limit_backoff() -> None:
    now = [100.0]
    gate = OpenSkyPollGate(
        interval_seconds=300,
        backoff_initial_seconds=900,
        backoff_max_seconds=3600,
        clock=lambda: now[0],
    )

    assert gate.rate_limited() == 900
    now[0] += 900
    gate.succeeded()
    now[0] += 300
    assert gate.rate_limited() == 900


def test_parse_retry_after_accepts_only_positive_delta_seconds() -> None:
    assert parse_retry_after("120") == 120
    assert parse_retry_after("0") is None
    assert parse_retry_after("-1") is None
    assert parse_retry_after("Wed, 21 Oct 2015 07:28:00 GMT") is None
    assert parse_retry_after(None) is None


@pytest.mark.asyncio
async def test_asset_cycle_backs_off_after_opensky_429(monkeypatch) -> None:
    now = [100.0]
    gate = OpenSkyPollGate(
        interval_seconds=300,
        backoff_initial_seconds=900,
        backoff_max_seconds=3600,
        clock=lambda: now[0],
    )
    response = httpx.Response(
        429,
        headers={"Retry-After": "1200"},
        request=httpx.Request("GET", "https://opensky-network.org/api/states/all"),
    )
    connector = AsyncMock()
    connector.fetch_states.side_effect = httpx.HTTPStatusError(
        "rate limited",
        request=response.request,
        response=response,
    )
    health = AsyncMock()

    monkeypatch.setattr(worker, "get_pool", lambda: object())
    monkeypatch.setattr(worker, "_opensky_connector", connector)
    monkeypatch.setattr(worker, "_opensky_poll_gate", gate)
    monkeypatch.setattr(worker, "_ais_connector", None)
    monkeypatch.setattr(worker, "_vf_connector", None)
    monkeypatch.setattr(worker, "upsert_connector_health", health)

    assert await worker._asset_poll_cycle() == {"vessels": 0, "aircraft": 0}
    assert gate.seconds_until_ready == 1200
    health.assert_awaited_once_with(
        ANY,
        "opensky",
        0,
        "rate limited; retrying in 1200s",
    )

    await worker._asset_poll_cycle()
    connector.fetch_states.assert_awaited_once()
