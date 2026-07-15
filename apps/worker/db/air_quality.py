"""Persistence for BMKG PM2.5 observations, separate from official alerts."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import asyncpg

from models.air_quality import AirQualityObservationInput

_UPSERT_SQL = """
INSERT INTO air_quality_observations (
  source, station_id, station_name, latitude, longitude, pollutant, value,
  unit, category, observed_at, source_url, raw_payload
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
ON CONFLICT (source, station_id, pollutant, observed_at) DO NOTHING
RETURNING id, source, station_id, station_name, latitude, longitude, pollutant,
          value, unit, category, observed_at, source_url, ingested_at
"""

_DELETE_OLD_SQL = """
DELETE FROM air_quality_observations
WHERE observed_at < $1 - interval '30 days'
"""


def _json_value(value: dict[str, Any]) -> str:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


async def upsert_air_quality_observation(
    pool: asyncpg.Pool,
    observation: AirQualityObservationInput,
) -> tuple[dict[str, Any], bool]:
    """Insert an observation, returning its row and whether it was created."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            _UPSERT_SQL,
            observation.source,
            observation.station_id,
            observation.station_name,
            observation.latitude,
            observation.longitude,
            observation.pollutant,
            observation.value,
            observation.unit,
            observation.category,
            observation.observed_at,
            observation.source_url,
            _json_value(observation.raw_payload),
        )
    return (dict(row), True) if row is not None else ({}, False)


async def delete_old_air_quality_observations(
    pool: asyncpg.Pool,
    *,
    now: datetime | None = None,
) -> str:
    """Delete observations older than the database's 30-day retention period."""
    if now is not None and (now.tzinfo is None or now.utcoffset() is None):
        raise ValueError("now must include a timezone")
    current_time = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    async with pool.acquire() as conn:
        return await conn.execute(_DELETE_OLD_SQL, current_time)


__all__ = [
    "delete_old_air_quality_observations",
    "upsert_air_quality_observation",
]
