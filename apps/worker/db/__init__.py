"""Database persistence layer for the worker service.

Exposes an asyncpg-based connection pool (:mod:`db.pool`) and event
upsert helpers (:mod:`db.events`).
"""

from __future__ import annotations
