import unittest
from typing import Any, cast
from datetime import timezone
from unittest.mock import AsyncMock

from db.health import upsert_connector_health


class _AcquireContext:
    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _PoolStub:
    def __init__(self, conn):
        self._conn = conn

    def acquire(self):
        return _AcquireContext(self._conn)


class ConnectorHealthDbTests(unittest.IsolatedAsyncioTestCase):
    async def test_upsert_ok_calls_execute_with_name_and_count(self) -> None:
        conn = AsyncMock()
        pool = _PoolStub(conn)

        await upsert_connector_health(cast(Any, pool), "bmkg", 12)

        conn.execute.assert_awaited_once()
        args = conn.execute.await_args.args
        # args[0] = SQL, args[1] = name, args[2] = last_polled_at,
        # args[3] = items_fetched, args[4] = error_message
        self.assertEqual(args[1], "bmkg")
        self.assertEqual(args[3], 12)
        self.assertIsNone(args[4])

    async def test_upsert_error_passes_error_string(self) -> None:
        conn = AsyncMock()
        pool = _PoolStub(conn)

        await upsert_connector_health(cast(Any, pool), "usgs", 0, "timeout")

        args = conn.execute.await_args.args
        self.assertEqual(args[1], "usgs")
        self.assertEqual(args[3], 0)
        self.assertEqual(args[4], "timeout")

    async def test_upsert_last_polled_at_is_utc_datetime(self) -> None:
        conn = AsyncMock()
        pool = _PoolStub(conn)

        await upsert_connector_health(cast(Any, pool), "nasa_firms", 42)

        args = conn.execute.await_args.args
        polled_at = args[2]
        self.assertIsNotNone(polled_at)
        self.assertIsNotNone(polled_at.tzinfo)
        self.assertEqual(polled_at.tzinfo, timezone.utc)
