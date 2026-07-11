"""Scheduler sinkron lokasi evakuasi OSM (mingguan, first-run 120 detik)."""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

logger = logging.getLogger(__name__)


class EvacuationSyncScheduler:
    def __init__(
        self,
        sync_fn: Callable[[], Awaitable[dict]],
        interval_seconds: int = 7 * 24 * 3600,
        initial_delay_seconds: int = 120,
    ) -> None:
        self._sync_fn = sync_fn
        self._interval = interval_seconds
        self._initial_delay = initial_delay_seconds
        self._task: asyncio.Task | None = None
        self._running = False

    def start(self) -> None:
        if self._task is not None:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("EvacuationSyncScheduler started (interval=%ds)", self._interval)

    async def _loop(self) -> None:
        delay = self._initial_delay
        while self._running:
            try:
                await asyncio.sleep(delay)
                delay = self._interval
                result = await self._sync_fn()
                logger.info(
                    "Evacuation OSM sync: fetched=%d upserted=%d",
                    result.get("fetched", 0), result.get("upserted", 0),
                )
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning("EvacuationSyncScheduler tick failed: %s", exc)

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
