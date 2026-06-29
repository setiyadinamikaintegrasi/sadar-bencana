"""Persistence helpers for immutable source provenance and derived evidence."""

from __future__ import annotations

import json
from typing import Any

import asyncpg

from db.official_alerts import payload_checksum
from models.evidence import (
    EventEvidenceInput,
    ImpactReportInput,
    RiskContextInput,
    SourceRecordInput,
)


def _json_value(value: dict[str, Any] | None) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


_INSERT_SOURCE_SQL = """
INSERT INTO source_records (
    source_name, source_record_id, source_type, origin_source_name, source_url, attribution,
    observed_at, published_at, raw_payload, payload_checksum
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
ON CONFLICT (source_name, source_record_id, payload_checksum) DO NOTHING
RETURNING *
"""

_SELECT_SOURCE_SQL = """
SELECT *
FROM source_records
WHERE source_name = $1 AND source_record_id = $2 AND payload_checksum = $3
LIMIT 1
"""

_INSERT_EVIDENCE_SQL = """
INSERT INTO event_evidence (
    event_id, source_record_id, peril_type, relation_type, confidence,
    freshness_expires_at
)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (event_id, source_record_id, relation_type) DO NOTHING
RETURNING *
"""

_SELECT_EVIDENCE_SQL = """
SELECT *
FROM event_evidence
WHERE event_id IS NOT DISTINCT FROM $1
  AND source_record_id = $2
  AND relation_type = $3
LIMIT 1
"""

_INSERT_IMPACT_SQL = """
INSERT INTO impact_reports (
    impact_key, event_id, source_record_id, location_name, latitude, longitude,
    observed_at, deaths, missing, injured, displaced, houses_damaged,
    damage_amount, currency, verification_status
)
VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
)
ON CONFLICT (source_record_id, impact_key) DO NOTHING
RETURNING *
"""

_SELECT_IMPACT_SQL = """
SELECT *
FROM impact_reports
WHERE source_record_id = $1 AND impact_key = $2
LIMIT 1
"""

_INSERT_RISK_CONTEXT_SQL = """
INSERT INTO risk_context (
    context_key, context_type, peril_type, event_id, source_record_id,
    administrative_code, data_vintage, values, area_geojson
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
ON CONFLICT (context_key, context_type, source_record_id) DO NOTHING
RETURNING *
"""

_SELECT_RISK_CONTEXT_SQL = """
SELECT *
FROM risk_context
WHERE context_key = $1 AND context_type = $2 AND source_record_id = $3
LIMIT 1
"""


async def create_source_record(
    pool: asyncpg.Pool,
    record: SourceRecordInput,
) -> tuple[dict[str, Any], bool]:
    checksum = payload_checksum(record.raw_payload)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            _INSERT_SOURCE_SQL,
            record.source_name,
            record.source_record_id,
            record.source_type,
            record.origin_source_name,
            record.source_url,
            record.attribution,
            record.observed_at,
            record.published_at,
            _json_value(record.raw_payload),
            checksum,
        )
        if row is not None:
            return dict(row), True
        existing = await conn.fetchrow(
            _SELECT_SOURCE_SQL,
            record.source_name,
            record.source_record_id,
            checksum,
        )
    return (dict(existing), False) if existing is not None else ({}, False)


async def link_event_evidence(
    pool: asyncpg.Pool,
    evidence: EventEvidenceInput,
) -> tuple[dict[str, Any], bool]:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            _INSERT_EVIDENCE_SQL,
            evidence.event_id,
            evidence.source_record_id,
            evidence.peril_type,
            evidence.relation_type,
            evidence.confidence,
            evidence.freshness_expires_at,
        )
        if row is not None:
            return dict(row), True
        existing = await conn.fetchrow(
            _SELECT_EVIDENCE_SQL,
            evidence.event_id,
            evidence.source_record_id,
            evidence.relation_type,
        )
    return (dict(existing), False) if existing is not None else ({}, False)


async def create_impact_report(
    pool: asyncpg.Pool,
    report: ImpactReportInput,
) -> tuple[dict[str, Any], bool]:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            _INSERT_IMPACT_SQL,
            report.impact_key,
            report.event_id,
            report.source_record_id,
            report.location_name,
            report.latitude,
            report.longitude,
            report.observed_at,
            report.deaths,
            report.missing,
            report.injured,
            report.displaced,
            report.houses_damaged,
            report.damage_amount,
            report.currency,
            report.verification_status,
        )
        if row is not None:
            return dict(row), True
        existing = await conn.fetchrow(
            _SELECT_IMPACT_SQL,
            report.source_record_id,
            report.impact_key,
        )
    return (dict(existing), False) if existing is not None else ({}, False)


async def create_risk_context(
    pool: asyncpg.Pool,
    context: RiskContextInput,
) -> tuple[dict[str, Any], bool]:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            _INSERT_RISK_CONTEXT_SQL,
            context.context_key,
            context.context_type,
            context.peril_type,
            context.event_id,
            context.source_record_id,
            context.administrative_code,
            context.data_vintage,
            _json_value(context.values),
            _json_value(context.area_geojson),
        )
        if row is not None:
            return dict(row), True
        existing = await conn.fetchrow(
            _SELECT_RISK_CONTEXT_SQL,
            context.context_key,
            context.context_type,
            context.source_record_id,
        )
    return (dict(existing), False) if existing is not None else ({}, False)


__all__ = [
    "create_impact_report",
    "create_risk_context",
    "create_source_record",
    "link_event_evidence",
]
