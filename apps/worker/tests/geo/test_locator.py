"""Tests for geo.locator — location extraction orchestrator."""

import pytest

from geo.locator import extract_location


@pytest.mark.asyncio
async def test_gazetteer_hit_no_pool_needed():
    result = await extract_location("Gempa guncang Palu", "", pool=None)
    assert result is not None
    place, lat, lon = result
    assert abs(lat - (-0.899)) < 0.1


@pytest.mark.asyncio
async def test_no_location_returns_none():
    result = await extract_location("Cuaca cerah hari ini", "", pool=None)
    assert result is None
