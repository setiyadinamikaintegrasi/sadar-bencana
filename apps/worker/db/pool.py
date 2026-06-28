"""Async PostgreSQL connection pool management for the worker.

The pool reads its DSN from the ``DATABASE_URL`` environment variable and
falls back to the local docker-compose default when unset. The pool is
lazily initialized via :func:`init_pool` (typically called from the
FastAPI startup hook) and torn down via :func:`close_pool` (shutdown).

Callers acquire a connection from the pool via:

    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute("SELECT 1")
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import asyncpg

logger = logging.getLogger(__name__)

# Default DSN matches docker-compose service `postgres` for this project.
DEFAULT_DATABASE_URL = (
    "postgres://sadar:changeme@localhost:5433/sadar_bencana"
)

# Module-level singleton. Mutated only via init_pool()/close_pool().
_pool: Optional[asyncpg.Pool] = None


def _resolve_dsn() -> str:
    """Return the configured database DSN, falling back to the dev default."""

    return os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)


async def init_pool(
    dsn: Optional[str] = None,
    *,
    min_size: int = 1,
    max_size: int = 10,
    command_timeout: float = 30.0,
) -> asyncpg.Pool:
    """Initialize the global connection pool.

    Idempotent: if a pool already exists it is returned unchanged. Raises
    on connection failure so callers (e.g. the startup hook) can decide
    how to handle an unreachable database.
    """

    global _pool
    if _pool is not None:
        return _pool

    resolved = dsn or _resolve_dsn()
    logger.info(
        "Initializing asyncpg connection pool (min_size=%s, max_size=%s)",
        min_size,
        max_size,
    )
    _pool = await asyncpg.create_pool(
        dsn=resolved,
        min_size=min_size,
        max_size=max_size,
        command_timeout=command_timeout,
    )
    if _pool is None:  # pragma: no cover — defensive; asyncpg returns Pool or raises
        raise RuntimeError("asyncpg.create_pool() returned None unexpectedly")
    return _pool


async def close_pool() -> None:
    """Close and clear the global pool. Safe to call when no pool exists."""

    global _pool
    if _pool is None:
        return
    logger.info("Closing asyncpg connection pool")
    await _pool.close()
    _pool = None


def get_pool() -> asyncpg.Pool:
    """Return the initialized pool.

    Raises ``RuntimeError`` if :func:`init_pool` has not been called (or
    failed) yet, so endpoint handlers can surface a clean 503 instead of
    an opaque ``AttributeError``.
    """

    if _pool is None:
        raise RuntimeError(
            "Database connection pool is not initialized. "
            "Call init_pool() during application startup."
        )
    return _pool
