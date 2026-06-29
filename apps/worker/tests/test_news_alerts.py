"""Tests for conservative news-alert classification and corroboration."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from news_alerts import (
    _geo_bucket,
    _is_incident_report,
    _is_recent_news_item,
    process_news_alerts,
)


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


def _news_item(**overrides):
    values = {
        "lat": -6.2,
        "lon": 106.8,
        "perils": ["flood"],
        "source": "antara",
        "title": "Banjir melanda Jakarta",
        "summary": "Warga mulai melakukan evakuasi.",
        "published_at": "2026-06-29T10:00:00+00:00",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _pool_with_conn(conn: AsyncMock) -> MagicMock:
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
    return pool


def test_freshness_accepts_recent_and_rejects_stale_or_future_item():
    now = datetime(2026, 6, 29, 12, 0, tzinfo=timezone.utc)
    assert _is_recent_news_item(_news_item(), now)
    assert not _is_recent_news_item(
        _news_item(published_at=(now - timedelta(hours=7)).isoformat()), now
    )
    assert not _is_recent_news_item(
        _news_item(published_at=(now + timedelta(minutes=16)).isoformat()), now
    )


def test_non_incident_terms_are_rejected():
    assert not _is_incident_report(
        _news_item(title="Simulasi gempa digelar BPBD", summary="Latihan evakuasi")
    )
    assert _is_incident_report(_news_item())


@pytest.mark.asyncio
async def test_single_news_source_creates_only_unverified_moderate_alert():
    conn = AsyncMock()
    conn.fetchrow.return_value = None
    pool = _pool_with_conn(conn)
    now = datetime(2026, 6, 29, 12, 0, tzinfo=timezone.utc)

    await process_news_alerts(pool, _news_item(), "some-uuid", now=now)

    args = conn.execute.await_args.args
    assert args[2] == "Moderate"
    assert "unverified" in args[0]
    assert args[5] == "antara"


@pytest.mark.asyncio
async def test_independent_source_promotes_signal_to_corroborated_high():
    conn = AsyncMock()
    conn.fetchrow.return_value = {
        "id": "alert-uuid",
        "source_names": ["antara"],
    }
    pool = _pool_with_conn(conn)
    now = datetime(2026, 6, 29, 12, 0, tzinfo=timezone.utc)

    await process_news_alerts(
        pool,
        _news_item(source="cnn"),
        "news-uuid",
        now=now,
    )

    args = conn.execute.await_args.args
    assert args[1] == "alert-uuid"
    assert args[2] == "cnn"
    assert args[3] == "High"
    assert "verification_status = 'corroborated'" in args[0]


@pytest.mark.asyncio
async def test_same_source_does_not_increase_corroboration():
    conn = AsyncMock()
    conn.fetchrow.return_value = {
        "id": "alert-uuid",
        "source_names": ["antara"],
    }
    pool = _pool_with_conn(conn)
    now = datetime(2026, 6, 29, 12, 0, tzinfo=timezone.utc)

    await process_news_alerts(pool, _news_item(), "news-uuid", now=now)

    conn.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_stale_and_simulation_items_do_not_touch_database():
    now = datetime(2026, 6, 29, 12, 0, tzinfo=timezone.utc)
    pool = MagicMock()

    await process_news_alerts(
        pool,
        _news_item(published_at=(now - timedelta(days=1)).isoformat()),
        "stale-uuid",
        now=now,
    )
    await process_news_alerts(
        pool,
        _news_item(title="Simulasi banjir dan latihan evakuasi"),
        "simulation-uuid",
        now=now,
    )

    pool.acquire.assert_not_called()
