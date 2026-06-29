"""Structured disaster telemetry and deterministic end-to-end trace IDs."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID, NAMESPACE_URL, uuid5

import asyncpg

_INSERT_SQL = """
INSERT INTO disaster_observability_events (
    correlation_id, stage, source_name, peril_type, severity, success,
    duration_ms, error_code, metadata
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
"""


def disaster_correlation_id(source_name: str, source_record_id: str) -> UUID:
    identity = f"sadarbencana:{source_name.strip().lower()}:{source_record_id.strip()}"
    return uuid5(NAMESPACE_URL, identity)


async def record_observation(
    pool: asyncpg.Pool,
    *,
    correlation_id: UUID,
    stage: str,
    source_name: str | None = None,
    peril_type: str | None = None,
    severity: str | None = None,
    success: bool = True,
    duration_ms: int | None = None,
    error_code: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            _INSERT_SQL,
            correlation_id,
            stage,
            source_name,
            peril_type,
            severity,
            success,
            duration_ms,
            error_code,
            json.dumps(metadata or {}, separators=(",", ":"), sort_keys=True),
        )


__all__ = ["disaster_correlation_id", "record_observation"]
