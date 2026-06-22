"""Tests for news_alerts — geo-bucket dedup and alert creation."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from news_alerts import _geo_bucket, process_news_alerts


def test_geo_bucket_format():
    assert _geo_bucket("flood", -0.899, 119.878) == "flood:-0.9:119.9"


def test_geo_bucket_rounds_correctly():
    assert _geo_bucket("volcano", -7.541, 110.446) == "volcano:-7.5:110.4"


@pytest.mark.asyncio
async def test_skips_item_without_lat():
    pool = AsyncMock()
    item = MagicMock(lat=None, perils=["flood"])
    await process_news_alerts(pool, item, "some-uuid")
    pool.acquire.assert_not_called()


@pytest.mark.asyncio
async def test_skips_item_without_perils():
    pool = AsyncMock()
    item = MagicMock(lat=0.0, lon=0.0, perils=[])
    await process_news_alerts(pool, item, "some-uuid")
    pool.acquire.assert_not_called()
