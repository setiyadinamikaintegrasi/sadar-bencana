"""Persistence for correlation decisions and reversible event merge operations."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import asyncpg

from models.correlation import CorrelationDecision

_INSERT_CORRELATION_SQL = """
INSERT INTO event_correlations (
    left_event_id, right_event_id, peril_type, distance_km,
    time_delta_seconds, identifier_match, confidence, decision, reasons,
    rule_version
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
ON CONFLICT (left_event_id, right_event_id, rule_version) DO NOTHING
RETURNING *
"""

_SELECT_CORRELATION_SQL = """
SELECT * FROM event_correlations
WHERE left_event_id = $1 AND right_event_id = $2 AND rule_version = $3
LIMIT 1
"""

_INSERT_REVIEW_SQL = """
INSERT INTO correlation_reviews (correlation_id)
VALUES ($1)
ON CONFLICT (correlation_id) DO NOTHING
"""

_ACTIVE_MEMBERSHIP_SQL = """
SELECT canonical_event_id, merge_operation_id
FROM event_merge_memberships
WHERE member_event_id = $1 AND active = TRUE
FOR UPDATE
"""

_LOCK_EVENTS_SQL = """
SELECT id FROM events
WHERE id = ANY($1::uuid[])
ORDER BY id
FOR UPDATE
"""

_INSERT_OPERATION_SQL = """
INSERT INTO event_merge_operations (
    operation_type, canonical_event_id, member_event_id, correlation_id,
    reverses_operation_id, actor, reason, snapshot
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
RETURNING *
"""

_UPSERT_MEMBERSHIP_SQL = """
INSERT INTO event_merge_memberships (
    member_event_id, canonical_event_id, merge_operation_id, active
)
VALUES ($1, $2, $3, TRUE)
ON CONFLICT (member_event_id) DO UPDATE
SET canonical_event_id = EXCLUDED.canonical_event_id,
    merge_operation_id = EXCLUDED.merge_operation_id,
    active = TRUE,
    updated_at = now()
"""

_DEACTIVATE_MEMBERSHIP_SQL = """
UPDATE event_merge_memberships
SET active = FALSE, updated_at = now()
WHERE member_event_id = $1
  AND merge_operation_id = $2
  AND active = TRUE
"""


def _json_value(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


async def record_correlation_decision(
    pool: asyncpg.Pool,
    decision: CorrelationDecision,
) -> tuple[dict[str, Any], bool]:
    """Idempotently persist a deterministic decision and its review item."""
    left_event_id, right_event_id = sorted(
        (decision.left_event_id, decision.right_event_id),
        key=str,
    )
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                _INSERT_CORRELATION_SQL,
                left_event_id,
                right_event_id,
                decision.peril_type,
                decision.distance_km,
                decision.time_delta_seconds,
                decision.identifier_match,
                decision.confidence,
                decision.decision,
                _json_value(decision.reasons),
                decision.rule_version,
            )
            created = row is not None
            if row is None:
                row = await conn.fetchrow(
                    _SELECT_CORRELATION_SQL,
                    left_event_id,
                    right_event_id,
                    decision.rule_version,
                )
            if row is not None and decision.decision == "review":
                await conn.execute(_INSERT_REVIEW_SQL, row["id"])
    return (dict(row), created) if row is not None else ({}, False)


async def merge_events(
    pool: asyncpg.Pool,
    *,
    canonical_event_id: UUID,
    member_event_id: UUID,
    actor: str,
    reason: str,
    correlation_id: UUID | None = None,
    snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create an audited logical merge without deleting either source event."""
    if canonical_event_id == member_event_id:
        raise ValueError("canonical and member event must differ")
    if not actor.strip() or not reason.strip():
        raise ValueError("merge actor and reason are required")

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.fetch(
                _LOCK_EVENTS_SQL,
                sorted([canonical_event_id, member_event_id], key=str),
            )
            active = await conn.fetchrow(_ACTIVE_MEMBERSHIP_SQL, member_event_id)
            if active is not None:
                raise ValueError("member event already has an active merge")
            operation = await conn.fetchrow(
                _INSERT_OPERATION_SQL,
                "merge",
                canonical_event_id,
                member_event_id,
                correlation_id,
                None,
                actor.strip(),
                reason.strip(),
                _json_value(snapshot or {}),
            )
            if operation is None:
                raise RuntimeError("merge operation was not persisted")
            await conn.execute(
                _UPSERT_MEMBERSHIP_SQL,
                member_event_id,
                canonical_event_id,
                operation["id"],
            )
    return dict(operation)


async def split_event_merge(
    pool: asyncpg.Pool,
    *,
    member_event_id: UUID,
    actor: str,
    reason: str,
) -> dict[str, Any]:
    """Reverse the active logical merge with a new immutable split operation."""
    if not actor.strip() or not reason.strip():
        raise ValueError("split actor and reason are required")

    async with pool.acquire() as conn:
        async with conn.transaction():
            active = await conn.fetchrow(_ACTIVE_MEMBERSHIP_SQL, member_event_id)
            if active is None:
                raise ValueError("member event has no active merge")
            operation = await conn.fetchrow(
                _INSERT_OPERATION_SQL,
                "split",
                active["canonical_event_id"],
                member_event_id,
                None,
                active["merge_operation_id"],
                actor.strip(),
                reason.strip(),
                _json_value({"reversed_merge_operation_id": str(active["merge_operation_id"])}),
            )
            if operation is None:
                raise RuntimeError("split operation was not persisted")
            await conn.execute(
                _DEACTIVATE_MEMBERSHIP_SQL,
                member_event_id,
                active["merge_operation_id"],
            )
    return dict(operation)


__all__ = ["merge_events", "record_correlation_decision", "split_event_merge"]
