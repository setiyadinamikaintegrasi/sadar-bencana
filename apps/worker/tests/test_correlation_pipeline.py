from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest

import correlation_pipeline
from models.event import EarthquakeEvent

NOW = datetime(2026, 6, 30, 8, 0, tzinfo=timezone.utc)


def _pool_with_conn(conn: AsyncMock) -> MagicMock:
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
    return pool


@pytest.mark.asyncio
async def test_shadow_pipeline_records_match_without_auto_merge(monkeypatch):
    conn = AsyncMock()
    conn.fetchrow.return_value = {
        "id": UUID("123e4567-e89b-42d3-a456-426614174000"),
        "event_id": "bmkg-001",
        "source": "bmkg",
        "event_type": "earthquake",
        "latitude": -6.2,
        "longitude": 106.8,
        "event_time": NOW,
    }
    conn.fetch.return_value = [
        {
            "id": UUID("123e4567-e89b-42d3-a456-426614174001"),
            "event_id": "usgs-001",
            "source": "usgs",
            "event_type": "earthquake",
            "latitude": -6.21,
            "longitude": 106.8,
            "event_time": NOW + timedelta(minutes=1),
        }
    ]
    record = AsyncMock(return_value=({"id": "correlation-id"}, True))
    monkeypatch.setattr(correlation_pipeline, "record_correlation_decision", record)
    pool = _pool_with_conn(conn)
    event = EarthquakeEvent(
        event_id="bmkg-001",
        source="bmkg",
        event_type="earthquake",
        magnitude=5.1,
        latitude=-6.2,
        longitude=106.8,
        place="Jakarta",
        time=NOW.isoformat(),
    )

    result = await correlation_pipeline.correlate_ingested_events(pool, [event])

    assert result == {"evaluated": 1, "recorded": 1, "reviews": 0}
    decision = record.await_args.args[1]
    assert decision.decision == "merge"
