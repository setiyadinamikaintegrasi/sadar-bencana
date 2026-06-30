from unittest.mock import AsyncMock, MagicMock

import pytest

from db.source_settings import resolve_source_setting


def _pool(row):
    conn = AsyncMock()
    conn.fetchrow.return_value = row
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
    return pool


@pytest.mark.asyncio
async def test_auto_prefers_custom_url_over_environment(monkeypatch):
    monkeypatch.setenv("INATEWS_FEED_URL", "https://data.bmkg.go.id/environment")
    setting = await resolve_source_setting(_pool({
        "source_name": "inatews",
        "enabled": True,
        "mode": "auto",
        "default_api_url": None,
        "custom_api_url": "https://rtsp.bmkg.go.id/custom",
        "attribution": "Sumber: BMKG",
        "api_token": "secret",
    }), "inatews")
    assert setting.api_url == "https://rtsp.bmkg.go.id/custom"
    assert setting.api_token == "secret"


@pytest.mark.asyncio
async def test_auto_uses_environment_then_default(monkeypatch):
    monkeypatch.setenv("BNPB_FEED_URL", "https://data.bnpb.go.id/environment")
    setting = await resolve_source_setting(_pool({
        "source_name": "bnpb", "enabled": True, "mode": "auto",
        "default_api_url": "https://data.bnpb.go.id/default",
        "custom_api_url": None, "attribution": "BNPB", "api_token": None,
    }), "bnpb")
    assert setting.api_url.endswith("/environment")


@pytest.mark.asyncio
async def test_missing_settings_table_falls_back_to_legacy_env():
    conn = AsyncMock()
    conn.fetchrow.side_effect = RuntimeError("relation does not exist")
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
    assert await resolve_source_setting(pool, "bnpb") is None
