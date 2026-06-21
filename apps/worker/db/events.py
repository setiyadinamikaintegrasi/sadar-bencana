"""Persistence helpers for the ``events`` table.

Maps the canonical :class:`~models.event.EarthquakeEvent` payload onto the
``events`` schema (see ``db/schema/001_init.sql``). Note the schema column
for event time is ``event_time`` while the model uses ``time`` — this module
performs that mapping explicitly.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Sequence

import asyncpg

from models.event import EarthquakeEvent
from scoring.risk import classify_severity

logger = logging.getLogger(__name__)

# Columns are listed explicitly so future schema additions don't silently
# break the upsert. ``severity`` is derived from ``magnitude`` at write
# time via :func:`scoring.risk.classify_severity`, so callers never need
# to pass it explicitly.
_UPSERT_SQL = """
INSERT INTO events (
    event_id,
    source,
    event_type,
    magnitude,
    latitude,
    longitude,
    place,
    event_time,
    url,
    severity,
    created_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
)
ON CONFLICT (source, event_id) DO UPDATE
SET
    event_type = EXCLUDED.event_type,
    magnitude  = EXCLUDED.magnitude,
    latitude   = EXCLUDED.latitude,
    longitude  = EXCLUDED.longitude,
    place      = EXCLUDED.place,
    event_time = EXCLUDED.event_time,
    url        = EXCLUDED.url,
    severity   = EXCLUDED.severity
RETURNING id
"""


async def upsert_events(
    pool: asyncpg.Pool, events: Sequence[EarthquakeEvent]
) -> int:
    """Upsert a batch of earthquake events into the ``events`` table.

    Uses ``INSERT ... ON CONFLICT (source, event_id) DO UPDATE`` so the
    operation is idempotent across re-ingestions. Each event's
    ``severity`` is derived from its magnitude and written inline, so the
    column is always populated for freshly ingested rows. Returns the
    number of rows actually written (inserts + updates). Empty input
    returns 0 without touching the database.
    """

    if not events:
        return 0

    upserted = 0
    async with pool.acquire() as conn:
        for event in events:
            severity = classify_severity(event.magnitude)
            row = await conn.fetchrow(
                _UPSERT_SQL,
                event.event_id,
                event.source,
                event.event_type,
                event.magnitude,
                event.latitude,
                event.longitude,
                event.place,
                # EarthquakeEvent.time (ISO string) -> events.event_time (timestamp)
                datetime.fromisoformat(event.time.replace("Z", "+00:00")),
                event.url,
                severity,  # derived from magnitude at write time
                datetime.fromisoformat(event.created_at.replace("Z", "+00:00")),
            )
            if row is not None:
                upserted += 1

    logger.info(
        "Upserted %d/%d events into the events table", upserted, len(events)
    )
    return upserted


_FETCH_TOP_EVENTS_SQL = """
SELECT id, event_id, source, event_type, magnitude,
       latitude, longitude, place, event_time, url
FROM events
ORDER BY magnitude DESC NULLS LAST
LIMIT $1
"""


async def fetch_top_events(
    pool: asyncpg.Pool, limit: int = 10
) -> tuple[list[EarthquakeEvent], list[str]]:
    """Fetch the most significant recent events by magnitude DESC.

    Returns a tuple ``(events, event_uuids)`` where ``event_uuids`` are the
    stringified ``id`` columns aligned 1:1 with ``events``. Returns empty
    lists when the table has no rows. Shared by the on-demand briefing
    endpoint and the background briefing scheduler so both pull identical
    event sets.
    """

    async with pool.acquire() as conn:
        rows = await conn.fetch(_FETCH_TOP_EVENTS_SQL, limit)

    events: list[EarthquakeEvent] = []
    event_uuids: list[str] = []
    for r in rows:
        events.append(
            EarthquakeEvent(
                event_id=r["event_id"],
                source=r["source"],
                event_type=r["event_type"] or "earthquake",
                magnitude=float(r["magnitude"] or 0.0),
                latitude=float(r["latitude"] or 0.0),
                longitude=float(r["longitude"] or 0.0),
                place=r["place"] or "",
                time=str(r["event_time"] or ""),
                url=r["url"] or "",
            )
        )
        event_uuids.append(str(r["id"]))

    return events, event_uuids
