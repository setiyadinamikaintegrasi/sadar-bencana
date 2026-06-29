"""Persistence contract tests for source provenance and evidence."""

from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from pydantic import ValidationError

from db.evidence import (
    create_impact_report,
    create_risk_context,
    create_source_record,
    link_event_evidence,
)
from models.evidence import (
    EventEvidenceInput,
    ImpactReportInput,
    RiskContextInput,
    SourceRecordInput,
)

NOW = datetime(2026, 6, 30, 8, 0, tzinfo=timezone.utc)
SOURCE_ID = UUID("123e4567-e89b-42d3-a456-426614174000")
EVENT_ID = UUID("123e4567-e89b-42d3-a456-426614174001")


def _pool_with_conn(conn: AsyncMock) -> MagicMock:
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
    return pool


def _source() -> SourceRecordInput:
    return SourceRecordInput(
        source_name="BNPB",
        source_record_id="report-001",
        source_type="official",
        source_url="https://example.test/report-001",
        attribution="BNPB",
        observed_at=NOW,
        published_at=NOW,
        raw_payload={"id": "report-001", "status": "confirmed"},
    )


def test_source_model_normalizes_name_and_rejects_naive_time():
    assert _source().source_name == "bnpb"
    with pytest.raises(ValidationError):
        SourceRecordInput(
            source_name="bnpb",
            source_record_id="x",
            source_type="official",
            observed_at=datetime(2026, 6, 30, 8, 0),
            raw_payload={},
        )


@pytest.mark.asyncio
async def test_create_source_record_is_idempotent():
    conn = AsyncMock()
    existing = {"id": SOURCE_ID, "source_name": "bnpb"}
    conn.fetchrow.side_effect = [None, existing]
    pool = _pool_with_conn(conn)

    row, created = await create_source_record(pool, _source())

    assert created is False
    assert row["id"] == SOURCE_ID
    assert conn.fetchrow.await_count == 2
    insert_args = conn.fetchrow.await_args_list[0].args
    assert insert_args[1] == "bnpb"
    assert len(insert_args[10]) == 64


@pytest.mark.asyncio
async def test_link_event_evidence_persists_confidence_and_freshness():
    conn = AsyncMock()
    conn.fetchrow.return_value = {"id": "evidence-id"}
    pool = _pool_with_conn(conn)
    evidence = EventEvidenceInput(
        event_id=EVENT_ID,
        source_record_id=SOURCE_ID,
        peril_type="flood",
        confidence=0.9,
        freshness_expires_at=NOW,
    )

    _, created = await link_event_evidence(pool, evidence)

    assert created is True
    args = conn.fetchrow.await_args.args
    assert args[1] == EVENT_ID
    assert args[5] == 0.9
    assert args[6] == NOW


@pytest.mark.asyncio
async def test_impact_report_keeps_revision_values():
    conn = AsyncMock()
    conn.fetchrow.return_value = {"id": "impact-id"}
    pool = _pool_with_conn(conn)
    report = ImpactReportInput(
        impact_key="jakarta-20260630",
        event_id=EVENT_ID,
        source_record_id=SOURCE_ID,
        location_name="Jakarta",
        observed_at=NOW,
        deaths=1,
        displaced=120,
        damage_amount=Decimal("1000000.00"),
        currency="IDR",
        verification_status="official",
    )

    _, created = await create_impact_report(pool, report)

    assert created is True
    args = conn.fetchrow.await_args.args
    assert args[1] == "jakarta-20260630"
    assert args[8] == 1
    assert args[11] == 120
    assert args[15] == "official"


@pytest.mark.asyncio
async def test_risk_context_persists_vintage_and_values():
    conn = AsyncMock()
    conn.fetchrow.return_value = {"id": "context-id"}
    pool = _pool_with_conn(conn)
    context = RiskContextInput(
        context_key="31.71",
        context_type="exposure",
        peril_type="flood",
        source_record_id=SOURCE_ID,
        administrative_code="31.71",
        data_vintage=date(2025, 12, 31),
        values={"population_exposed": 1000},
    )

    _, created = await create_risk_context(pool, context)

    assert created is True
    args = conn.fetchrow.await_args.args
    assert args[1] == "31.71"
    assert args[7] == date(2025, 12, 31)
    assert "population_exposed" in args[8]
