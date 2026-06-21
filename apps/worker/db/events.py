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

logger = logging.getLogger(__name__)

# Columns are listed explicitly so future schema additions don't silently
# break the upsert. ``severity`` has no counterpart on EarthquakeEvent yet,
# so it is passed as NULL.
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
    operation is idempotent across re-ingestions. Returns the number of
    rows actually written (inserts + updates). Empty input returns 0
    without touching the database.
    """

    if not events:
        return 0

    upserted = 0
    async with pool.acquire() as conn:
        for event in events:
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
                None,  # severity: not modeled on EarthquakeEvent yet
                datetime.fromisoformat(event.created_at.replace("Z", "+00:00")),
            )
            if row is not None:
                upserted += 1

    logger.info(
        "Upserted %d/%d events into the events table", upserted, len(events)
    )
    return upserted
