"""Shadow-mode correlation pipeline for newly ingested events."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Sequence

import asyncpg

from correlation import DEFAULT_WINDOW, PERIL_WINDOWS, correlate_events
from db.correlation import record_correlation_decision
from models.correlation import CorrelationEvent
from models.event import EarthquakeEvent

logger = logging.getLogger(__name__)

_CURRENT_EVENT_SQL = """
SELECT id, event_id, source, event_type, latitude, longitude, event_time
FROM events
WHERE source = $1 AND event_id = $2
LIMIT 1
"""

_CANDIDATE_EVENTS_SQL = """
SELECT id, event_id, source, event_type, latitude, longitude, event_time
FROM events
WHERE id <> $1
  AND event_type = $2
  AND latitude IS NOT NULL
  AND longitude IS NOT NULL
  AND event_time IS NOT NULL
  AND event_time BETWEEN $3 AND $4
ORDER BY event_time DESC
LIMIT 100
"""


def _to_correlation_event(row) -> CorrelationEvent:
    return CorrelationEvent(
        id=row["id"],
        source=row["source"],
        source_event_id=row["event_id"],
        peril_type=row["event_type"],
        latitude=float(row["latitude"]),
        longitude=float(row["longitude"]),
        event_time=row["event_time"],
    )


async def correlate_ingested_events(
    pool: asyncpg.Pool,
    events: Sequence[EarthquakeEvent],
) -> dict[str, int]:
    """Evaluate new events in shadow mode without applying automatic merges."""
    evaluated = 0
    recorded = 0
    reviews = 0
    seen_pairs: set[tuple[str, str]] = set()

    for event in events:
        async with pool.acquire() as conn:
            current_row = await conn.fetchrow(
                _CURRENT_EVENT_SQL,
                event.source,
                event.event_id,
            )
            if current_row is None:
                continue
            current = _to_correlation_event(current_row)
            window = PERIL_WINDOWS.get(current.peril_type, DEFAULT_WINDOW)
            candidates = await conn.fetch(
                _CANDIDATE_EVENTS_SQL,
                current.id,
                current.peril_type,
                current.event_time - timedelta(seconds=window.time_seconds),
                current.event_time + timedelta(seconds=window.time_seconds),
            )

        for candidate_row in candidates:
            candidate = _to_correlation_event(candidate_row)
            pair = tuple(sorted((str(current.id), str(candidate.id))))
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            decision = correlate_events(current, candidate)
            evaluated += 1
            if decision.decision == "distinct":
                continue
            _, created = await record_correlation_decision(pool, decision)
            recorded += int(created)
            reviews += int(created and decision.decision == "review")

    logger.info(
        "Correlation shadow mode evaluated=%d recorded=%d reviews=%d",
        evaluated,
        recorded,
        reviews,
    )
    return {"evaluated": evaluated, "recorded": recorded, "reviews": reviews}


__all__ = ["correlate_ingested_events"]
