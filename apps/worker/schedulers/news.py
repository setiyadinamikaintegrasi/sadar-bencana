"""Periodic RSS news polling scheduler."""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable, Optional

logger = logging.getLogger(__name__)

DEFAULT_INTERVAL_SECONDS = 15 * 60
_STOP_TIMEOUT_SECONDS = 30.0
NewsPollFn = Callable[[], Awaitable[int]]


class NewsScheduler:
    """Run the RSS news polling coroutine immediately, then on a fixed interval."""

    def __init__(
        self,
        poll_fn: NewsPollFn,
        interval_seconds: int = DEFAULT_INTERVAL_SECONDS,
        *,
        name: str = "news-scheduler",
    ) -> None:
        self._poll_fn = poll_fn
        self._interval = max(1, int(interval_seconds))
        self._name = name
        self._task: Optional[asyncio.Task[None]] = None
        self._stopped = asyncio.Event()

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            logger.debug("News scheduler already running; start() is a no-op.")
            return

        self._stopped.clear()
        self._task = asyncio.create_task(self._loop(), name=self._name)
        logger.info("News scheduler started (interval=%ds, task=%s)", self._interval, self._name)

    async def stop(self) -> None:
        self._stopped.set()
        task = self._task
        if task is None or task.done():
            self._task = None
            return

        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=_STOP_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            logger.warning("News scheduler did not stop within %.1fs; cancelling.", _STOP_TIMEOUT_SECONDS)
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        except asyncio.CancelledError:
            task.cancel()
            raise
        finally:
            self._task = None

        logger.info("News scheduler stopped cleanly.")

    async def _loop(self) -> None:
        await self._tick()

        while not self._stopped.is_set():
            try:
                await asyncio.sleep(self._interval)
            except asyncio.CancelledError:
                logger.info("News scheduler sleep interrupted; exiting loop.")
                return
            if self._stopped.is_set():
                return
            await self._tick()

    async def _tick(self) -> None:
        try:
            count = await self._poll_fn()
        except Exception as exc:
            logger.exception("Scheduled news poll failed: %s", exc)
            return

        logger.info("Scheduled news poll complete: upserted=%s", count)
