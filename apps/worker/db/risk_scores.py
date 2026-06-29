"""Persistence helpers for the ``risk_scores`` and ``events.severity`` columns.

Provides primitives for writing computed risk scores and stamping
severity labels onto existing event rows. The main ingest path sets
severity inline during :func:`db.events.upsert_events`; the helpers here
cover the risk_scores table and any post-hoc severity updates.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

import asyncpg

logger = logging.getLogger(__name__)

# Upsert keyed on (entity_type, entity_id) so re-scoring the same event
# refreshes its row rather than duplicating it. There is no unique
# constraint on (entity_type, entity_id) in the baseline schema, so we
# rely on the partial index-friendly approach of cleaning prior rows for
# the same entity before inserting the fresh score. This keeps the table
# reflecting the latest score per entity without requiring a migration.
_DELETE_PRIOR_SQL = """
DELETE FROM risk_scores WHERE entity_type = $1 AND entity_id = $2
"""

_INSERT_RISK_SCORE_SQL = """
INSERT INTO risk_scores (
    entity_type, entity_id, score, factors, formula_version, calculated_at
)
VALUES ($1, $2, $3, $4::jsonb, $5, now())
"""

_UPDATE_EVENT_SEVERITY_SQL = """
UPDATE events SET severity = $2 WHERE id = $1
"""


async def upsert_risk_score(
    pool: asyncpg.Pool,
    event_id: str,
    score: float,
    factors: dict[str, Any],
) -> None:
    """Write the latest risk score for an event entity.

    Implements an idempotent upsert by deleting any prior row for the
    same ``(entity_type='event', entity_id)`` before inserting the fresh
    score. Both statements run in a single transaction so a partial
    failure cannot leave the table in an inconsistent state.

    Args:
        pool: The asyncpg connection pool.
        event_id: The canonical event identifier (e.g. ``usgs:abc123``)
            used as ``entity_id`` in the ``risk_scores`` table.
        score: Computed risk score in ``[0.0, 100.0]``.
        factors: JSON-serializable dict of explanatory factors.
    """

    factors_json = json.dumps(factors, default=str)
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(_DELETE_PRIOR_SQL, "event", event_id)
            await conn.execute(
                _INSERT_RISK_SCORE_SQL,
                "event",
                event_id,
                float(score),
                factors_json,
                str(factors.get("formula_version") or "legacy-v0"),
            )


async def update_event_severity(
    pool: asyncpg.Pool,
    event_internal_id: uuid.UUID,
    severity: str,
) -> None:
    """Set the ``severity`` column on an existing ``events`` row.

    This is retained as a primitive for ad-hoc re-scoring (e.g. when the
    severity thresholds change). The normal ingest path sets severity
    inline via :func:`db.events.upsert_events`, so this helper is not on
    the hot path.

    Args:
        pool: The asyncpg connection pool.
        event_internal_id: The ``events.id`` UUID primary key.
        severity: The severity label to write.
    """

    async with pool.acquire() as conn:
        await conn.execute(_UPDATE_EVENT_SEVERITY_SQL, event_internal_id, severity)
