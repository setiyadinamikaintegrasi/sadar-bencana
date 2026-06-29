"""Scheduler behavior for official-alert expiry maintenance."""

from unittest.mock import AsyncMock

import pytest

from schedulers.official_alerts import OfficialAlertExpiryScheduler


@pytest.mark.asyncio
async def test_tick_calls_expiry_function():
    expire = AsyncMock(return_value=3)
    scheduler = OfficialAlertExpiryScheduler(expire, interval_seconds=1)

    await scheduler._tick()

    expire.assert_awaited_once()


@pytest.mark.asyncio
async def test_tick_contains_expiry_failure():
    expire = AsyncMock(side_effect=RuntimeError("database unavailable"))
    scheduler = OfficialAlertExpiryScheduler(expire, interval_seconds=1)

    await scheduler._tick()

    expire.assert_awaited_once()
