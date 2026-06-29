"""Periodic lifecycle maintenance for authoritative alerts."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable

logger = logging.getLogger(__name__)

DEFAULT_INTERVAL_SECONDS = 60
ExpireFn = Callable[[], Awaitable[int]]


class OfficialAlertExpiryScheduler:
    def __init__(
        self,
        expire_fn: ExpireFn,
        interval_seconds: int = DEFAULT_INTERVAL_SECONDS,
    ) -> None:
        self._expire_fn = expire_fn
        self._interval = max(1, int(interval_seconds))
        self._task: asyncio.Task[None] | None = None
        self._stopped = asyncio.Event()

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stopped.clear()
        self._task = asyncio.create_task(
            self._loop(),
            name="official-alert-expiry",
        )

    async def stop(self) -> None:
        self._stopped.set()
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        finally:
            self._task = None

    async def _loop(self) -> None:
        while not self._stopped.is_set():
            await self._tick()
            try:
                await asyncio.wait_for(
                    self._stopped.wait(),
                    timeout=self._interval,
                )
            except asyncio.TimeoutError:
                continue

    async def _tick(self) -> None:
        try:
            count = await self._expire_fn()
        except Exception as exc:
            logger.exception("Official alert expiry failed: %s", exc)
            return
        if count:
            logger.info("Expired %d official alerts", count)


__all__ = ["OfficialAlertExpiryScheduler"]
