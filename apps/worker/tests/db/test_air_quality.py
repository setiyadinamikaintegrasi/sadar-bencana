"""Persistence tests for BMKG PM2.5 observations."""

import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from db.air_quality import (
    delete_old_air_quality_observations,
    upsert_air_quality_observation,
)
from models.air_quality import AirQualityObservationInput

NOW = datetime(2026, 7, 15, 12, 0, tzinfo=timezone.utc)


def observation(**overrides) -> AirQualityObservationInput:
    values = {
        "source": "bmkg",
        "station_id": "kmy3",
        "station_name": "Kemayoran",
        "latitude": -6.155,
        "longitude": 106.842,
        "pollutant": "pm25",
        "value": 66.2,
        "unit": "µg/m³",
        "category": "Tidak Sehat",
        "observed_at": NOW,
        "source_url": "https://www.bmkg.go.id/kualitas-udara/pm25/pm25_kmy3",
        "raw_payload": {"reading": 66.2, "station": "kmy3"},
    }
    values.update(overrides)
    return AirQualityObservationInput(**values)


def fake_pool(*, fetchrow):
    conn = AsyncMock()
    conn.fetchrow.return_value = fetchrow
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
    return pool, conn


@pytest.mark.asyncio
async def test_upsert_returns_created_row():
    pool, conn = fake_pool(fetchrow={"id": "obs-1", "station_id": "kmy3"})

    row, created = await upsert_air_quality_observation(pool, observation())

    assert created is True
    assert row["station_id"] == "kmy3"
    args = conn.fetchrow.await_args.args
    assert args[1:] == (
        "bmkg",
        "kmy3",
        "Kemayoran",
        -6.155,
        106.842,
        "pm25",
        66.2,
        "ug/m3",
        "Tidak Sehat",
        NOW,
        "https://www.bmkg.go.id/kualitas-udara/pm25/pm25_kmy3",
        '{"reading":66.2,"station":"kmy3"}',
    )


@pytest.mark.asyncio
async def test_upsert_serializes_raw_payload_as_sorted_compact_json():
    pool, conn = fake_pool(fetchrow={"id": "obs-1"})

    await upsert_air_quality_observation(
        pool,
        observation(raw_payload={"z": ["é"], "a": {"value": 1}}),
    )

    payload = conn.fetchrow.await_args.args[-1]
    assert payload == json.dumps(
        {"z": ["é"], "a": {"value": 1}},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


@pytest.mark.asyncio
async def test_upsert_defensively_rejects_non_finite_json_payloads():
    pool, conn = fake_pool(fetchrow={"id": "obs-1"})
    unsafe_values = observation().model_dump()
    unsafe_values["raw_payload"] = {"reading": float("nan")}
    unsafe_observation = AirQualityObservationInput.model_construct(**unsafe_values)

    with pytest.raises(ValueError, match="Out of range float values"):
        await upsert_air_quality_observation(pool, unsafe_observation)

    conn.fetchrow.assert_not_awaited()


@pytest.mark.asyncio
async def test_duplicate_returns_not_created():
    pool, _ = fake_pool(fetchrow=None)

    row, created = await upsert_air_quality_observation(pool, observation())

    assert row == {}
    assert created is False


@pytest.mark.asyncio
async def test_retention_deletes_observations_before_30_day_cutoff():
    pool, conn = fake_pool(fetchrow=None)
    jakarta_time = NOW.astimezone(timezone(timedelta(hours=7)))
    conn.execute.return_value = "DELETE 2"

    result = await delete_old_air_quality_observations(pool, now=jakarta_time)

    assert result == "DELETE 2"
    args = conn.execute.await_args.args
    assert args[1] == NOW
    assert "observed_at < $1 - interval '30 days'" in args[0]


@pytest.mark.asyncio
async def test_retention_rejects_naive_now():
    pool, conn = fake_pool(fetchrow=None)

    with pytest.raises(ValueError, match="now must include a timezone"):
        await delete_old_air_quality_observations(pool, now=NOW.replace(tzinfo=None))

    conn.execute.assert_not_awaited()
