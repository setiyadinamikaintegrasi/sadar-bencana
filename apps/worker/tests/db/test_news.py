import unittest
from typing import Any, cast
from types import SimpleNamespace
from uuid import UUID
from unittest.mock import AsyncMock

from db.news import fetch_news, upsert_news_items


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


class NewsDbTests(unittest.IsolatedAsyncioTestCase):
    async def test_upsert_news_items_returns_id_map_and_persists_geo_fields(self) -> None:
        conn = AsyncMock()
        conn.fetchrow = AsyncMock(
            side_effect=[
                {"id": UUID("11111111-1111-1111-1111-111111111111"), "item_id": "item-1"},
                {"id": UUID("22222222-2222-2222-2222-222222222222"), "item_id": "item-2"},
            ]
        )
        pool = _PoolStub(conn)
        items = [
            SimpleNamespace(
                item_id="item-1",
                source="antara",
                title="Banjir bandang menerjang Bandung",
                summary="Ringkasan singkat",
                url="https://example.com/1",
                published_at="2026-06-22T10:00:00Z",
                perils=["flood"],
                lat=-6.921,
                lon=107.607,
                place_name="Bandung",
            ),
            SimpleNamespace(
                item_id="item-2",
                source="cnn",
                title="Gempa dirasakan di Maluku",
                summary="Ringkasan dua",
                url="https://example.com/2",
                published_at="2026-06-22T11:30:00+00:00",
                perils=["earthquake"],
                lat=None,
                lon=None,
                place_name=None,
            ),
        ]

        result = await upsert_news_items(cast(Any, pool), items)

        self.assertEqual(
            result,
            {
                "item-1": "11111111-1111-1111-1111-111111111111",
                "item-2": "22222222-2222-2222-2222-222222222222",
            },
        )
        self.assertEqual(conn.fetchrow.await_count, 2)

        first_call = conn.fetchrow.await_args_list[0].args
        self.assertEqual(first_call[1], "item-1")
        self.assertEqual(first_call[2], "antara")
        self.assertEqual(first_call[8], -6.921)
        self.assertEqual(first_call[9], 107.607)
        self.assertEqual(first_call[10], "Bandung")
        self.assertEqual(first_call[6].isoformat(), "2026-06-22T10:00:00+00:00")

        second_call = conn.fetchrow.await_args_list[1].args
        self.assertIsNone(second_call[8])
        self.assertIsNone(second_call[9])
        self.assertIsNone(second_call[10])

    async def test_upsert_news_items_returns_empty_mapping_for_empty_input(self) -> None:
        conn = AsyncMock()
        pool = _PoolStub(conn)

        result = await upsert_news_items(cast(Any, pool), [])

        self.assertEqual(result, {})
        conn.fetchrow.assert_not_called()

    async def test_fetch_news_returns_plain_dict_rows(self) -> None:
        conn = AsyncMock()
        conn.fetch = AsyncMock(
            return_value=[
                {
                    "id": "uuid-1",
                    "item_id": "item-1",
                    "source": "antara",
                    "title": "Judul",
                    "summary": "Summary",
                    "url": "https://example.com/1",
                    "published_at": "2026-06-22T10:00:00+00:00",
                    "perils": ["flood"],
                    "lat": -6.2,
                    "lon": 106.8,
                    "place_name": "Jakarta",
                    "created_at": "2026-06-22T10:01:00+00:00",
                }
            ]
        )
        pool = _PoolStub(conn)

        rows = await fetch_news(cast(Any, pool), limit=25)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["place_name"], "Jakarta")
        conn.fetch.assert_awaited_once()
        self.assertEqual(conn.fetch.await_args.args[1], 25)
