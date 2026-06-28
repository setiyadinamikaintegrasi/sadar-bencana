"""Scheduler for periodic asset position polling (OpenSky + AIS)."""

from __future__ import annotations

import asyncio
import logging
from typing import Callable, Awaitable

logger = logging.getLogger(__name__)


class AssetScheduler:
    """Background loop that polls OpenSky every 60s and drains AIS buffer.

    OpenSky is REST-based: we call fetch_states() each tick.
    AIS is WebSocket-based: the connector runs continuously in the background;
    we just drain its buffer each tick.
    """

    def __init__(
        self,
        poll_fn: Callable[[], Awaitable[dict]],
        interval_seconds: int = 60,
    ) -> None:
        self._poll_fn = poll_fn
        self._interval = interval_seconds
        self._task: asyncio.Task | None = None
        self._running = False

    def start(self) -> None:
        if self._task is not None:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("AssetScheduler started (interval=%ds)", self._interval)

    async def _loop(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(self._interval)
                result = await self._poll_fn()
                if result.get("vessels", 0) or result.get("aircraft", 0):
                    logger.info(
                        "Asset poll: %d vessels, %d aircraft",
                        result.get("vessels", 0),
                        result.get("aircraft", 0),
                    )
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("AssetScheduler tick failed: %s", e)

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        logger.info("AssetScheduler stopped.")
