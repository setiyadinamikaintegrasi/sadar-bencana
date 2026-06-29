from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest

from db.correlation import (
    merge_events,
    record_correlation_decision,
    split_event_merge,
)
from models.correlation import CorrelationDecision

LEFT_ID = UUID("123e4567-e89b-42d3-a456-426614174000")
RIGHT_ID = UUID("123e4567-e89b-42d3-a456-426614174001")
CORRELATION_ID = UUID("123e4567-e89b-42d3-a456-426614174002")
OPERATION_ID = UUID("123e4567-e89b-42d3-a456-426614174003")


def _pool_with_conn(conn: AsyncMock) -> MagicMock:
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
    transaction = MagicMock()
    transaction.__aenter__ = AsyncMock(return_value=None)
    transaction.__aexit__ = AsyncMock(return_value=None)
    conn.transaction = MagicMock(return_value=transaction)
    return pool


@pytest.mark.asyncio
async def test_review_decision_creates_review_item():
    conn = AsyncMock()
    conn.fetchrow.return_value = {"id": CORRELATION_ID}
    pool = _pool_with_conn(conn)
    decision = CorrelationDecision(
        left_event_id=LEFT_ID,
        right_event_id=RIGHT_ID,
        peril_type="earthquake",
        distance_km=40,
        time_delta_seconds=300,
        identifier_match=False,
        confidence=0.65,
        decision="review",
        reasons=["same_peril"],
        rule_version="correlation-v1",
    )

    row, created = await record_correlation_decision(pool, decision)

    assert created is True
    assert row["id"] == CORRELATION_ID
    conn.execute.assert_awaited_once()


@pytest.mark.asyncio
async def test_merge_creates_operation_and_active_membership():
    conn = AsyncMock()
    conn.fetchrow.side_effect = [
        None,
        {"id": OPERATION_ID, "operation_type": "merge"},
    ]
    pool = _pool_with_conn(conn)

    operation = await merge_events(
        pool,
        canonical_event_id=LEFT_ID,
        member_event_id=RIGHT_ID,
        actor="analyst@example.test",
        reason="same earthquake confirmed",
        correlation_id=CORRELATION_ID,
    )

    assert operation["operation_type"] == "merge"
    assert conn.fetch.await_count == 1
    conn.execute.assert_awaited_once()


@pytest.mark.asyncio
async def test_merge_rejects_member_with_active_membership():
    conn = AsyncMock()
    conn.fetchrow.return_value = {
        "canonical_event_id": LEFT_ID,
        "merge_operation_id": OPERATION_ID,
    }
    pool = _pool_with_conn(conn)

    with pytest.raises(ValueError, match="active merge"):
        await merge_events(
            pool,
            canonical_event_id=LEFT_ID,
            member_event_id=RIGHT_ID,
            actor="analyst",
            reason="duplicate",
        )


@pytest.mark.asyncio
async def test_split_reverses_active_merge_without_deleting_audit():
    conn = AsyncMock()
    conn.fetchrow.side_effect = [
        {
            "canonical_event_id": LEFT_ID,
            "merge_operation_id": OPERATION_ID,
        },
        {"id": UUID(int=5), "operation_type": "split"},
    ]
    pool = _pool_with_conn(conn)

    operation = await split_event_merge(
        pool,
        member_event_id=RIGHT_ID,
        actor="analyst",
        reason="different epicenter",
    )

    assert operation["operation_type"] == "split"
    conn.execute.assert_awaited_once()
