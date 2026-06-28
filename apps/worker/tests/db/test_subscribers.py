"""Tests for EWS subscriber DB helpers.

Follows the project convention (unittest.IsolatedAsyncioTestCase + AsyncMock
pool stubs, see tests/db/test_health.py) rather than pytest fixtures, since the
worker venv ships without pytest / pytest-asyncio.
"""

import unittest
from typing import Any, cast
from unittest.mock import AsyncMock
from uuid import uuid4

from db.subscribers import (
    fetch_active_subscribers,
    fetch_active_watch_zones,
    fetch_subscriber_prefs,
    is_already_notified,
    log_notification,
)


class _AcquireContext:
    def __init__(self, conn: Any) -> None:
        self._conn = conn

    async def __aenter__(self) -> Any:
        return self._conn

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        return False


class _PoolStub:
    def __init__(self, conn: Any) -> None:
        self._conn = conn

    def acquire(self) -> _AcquireContext:
        return _AcquireContext(self._conn)


class SubscriberHelpersTests(unittest.IsolatedAsyncioTestCase):
    async def test_fetch_active_subscribers_returns_dicts(self) -> None:
        conn = AsyncMock()
        conn.fetch.return_value = [
            {"id": uuid4(), "name": "Joko", "email": "j@x.id",
             "phone_whatsapp": None, "telegram_chat_id": 1, "role": "admin"},
        ]
        pool = _PoolStub(conn)
        result = await fetch_active_subscribers(cast(Any, pool))
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["name"], "Joko")

    async def test_fetch_active_subscribers_empty(self) -> None:
        conn = AsyncMock()
        conn.fetch.return_value = []
        pool = _PoolStub(conn)
        self.assertEqual(await fetch_active_subscribers(cast(Any, pool)), [])

    async def test_fetch_subscriber_prefs_passes_id(self) -> None:
        conn = AsyncMock()
        conn.fetch.return_value = [{"channel": "telegram"}]
        pool = _PoolStub(conn)
        sub_id = uuid4()
        result = await fetch_subscriber_prefs(cast(Any, pool), sub_id)
        self.assertEqual(result[0]["channel"], "telegram")
        conn.fetch.assert_awaited_once()
        self.assertEqual(conn.fetch.await_args.args[1], sub_id)

    async def test_fetch_active_watch_zones(self) -> None:
        conn = AsyncMock()
        conn.fetch.return_value = [{"id": uuid4(), "label": "Jakarta"}]
        pool = _PoolStub(conn)
        result = await fetch_active_watch_zones(cast(Any, pool))
        self.assertEqual(result[0]["label"], "Jakarta")

    async def test_log_notification_returns_id(self) -> None:
        new_id = uuid4()
        conn = AsyncMock()
        conn.fetchrow.return_value = {"id": new_id}
        pool = _PoolStub(conn)
        result = await log_notification(
            cast(Any, pool), uuid4(), uuid4(), "telegram", "sent",
        )
        self.assertEqual(result, new_id)

    async def test_is_already_notified_true(self) -> None:
        conn = AsyncMock()
        conn.fetchrow.return_value = {"?column?": 1}
        pool = _PoolStub(conn)
        self.assertTrue(
            await is_already_notified(
                cast(Any, pool), uuid4(), uuid4(), "telegram"
            )
        )

    async def test_is_already_notified_false(self) -> None:
        conn = AsyncMock()
        conn.fetchrow.return_value = None
        pool = _PoolStub(conn)
        self.assertFalse(
            await is_already_notified(
                cast(Any, pool), uuid4(), uuid4(), "telegram"
            )
        )


if __name__ == "__main__":
    unittest.main()
