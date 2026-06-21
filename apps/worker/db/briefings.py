"""Persistence layer for AI briefings (briefings table)."""

from __future__ import annotations

import logging
from typing import Any

import asyncpg

logger = logging.getLogger(__name__)

_INSERT_BRIEFING_SQL = """
INSERT INTO briefings (briefing_type, summary, event_ids, event_count, model, prompt_hash)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, created_at
"""


async def save_briefing(
    pool: asyncpg.Pool,
    *,
    briefing_type: str = "daily",
    summary: str,
    event_ids: list[str] | None = None,
    event_count: int = 0,
    model: str | None = None,
    prompt_hash: str | None = None,
) -> dict[str, Any]:
    """Insert a briefing record and return {id, created_at}.

    Args:
        pool: asyncpg connection pool.
        briefing_type: 'daily', 'event', or 'weekly'.
        summary: LLM-generated or fallback summary text.
        event_ids: List of event UUIDs referenced.
        event_count: Number of events covered.
        model: LLM model name (e.g. 'gemma4-e4b').
        prompt_hash: Optional hash of the prompt for dedup.

    Returns:
        Dict with 'id' (UUID) and 'created_at' (datetime).
    """

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            _INSERT_BRIEFING_SQL,
            briefing_type,
            summary,
            event_ids or [],
            event_count,
            model,
            prompt_hash,
        )
    return {"id": str(row["id"]), "created_at": row["created_at"]}
