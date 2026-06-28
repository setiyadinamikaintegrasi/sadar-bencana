"""Periodic ingestion scheduler.

Runs the full ingest cycle (fetch -> upsert -> score) on a fixed
interval. Designed to be started from FastAPI's startup hook and
gracefully cancelled from the shutdown hook.

Usage::

    scheduler = IngestScheduler(ingest_fn=_ingest_once)

    @app.on_event("startup")
    async def startup():
        scheduler.start()

    @app.on_event("shutdown")
    async def shutdown():
        await scheduler.stop()

The ``ingest_fn`` callable is expected to perform the full cycle and
return a dict with at least ``fetched`` and ``upserted`` keys. Any
exception it raises is logged and swallowed so a single failed tick
never kills the loop.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable, Optional

logger = logging.getLogger(__name__)

# Default cadence: ingest every 5 minutes (300s).
DEFAULT_INTERVAL_SECONDS = 300

# Grace period given to an in-flight tick when stopping.
_STOP_TIMEOUT_SECONDS = 30.0

# Type alias for the injectable ingest coroutine.
IngestFn = Callable[[], Awaitable[dict]]


class IngestScheduler:
    """Runs an ingest coroutine on a fixed interval until stopped.

    The scheduler runs one tick immediately on :meth:`start` so a fresh
    boot does not wait a full interval before the first ingestion. Each
    subsequent tick fires ``interval_seconds`` after the previous one
    completed, using :func:`asyncio.sleep` so the wait is interruptible
    by cancellation.
    """

    def __init__(
        self,
        ingest_fn: IngestFn,
        interval_seconds: int = DEFAULT_INTERVAL_SECONDS,
        *,
        name: str = "ingest-scheduler",
    ) -> None:
        self._ingest_fn = ingest_fn
        self._interval = max(1, int(interval_seconds))
        self._name = name
        self._task: Optional[asyncio.Task[None]] = None
        self._stopped = asyncio.Event()

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        """Start the background loop. No-op if already running."""

        if self._task is not None and not self._task.done():
            logger.debug("Ingest scheduler already running; start() is a no-op.")
            return

        self._stopped.clear()
        self._task = asyncio.create_task(self._loop(), name=self._name)
        logger.info(
            "Ingest scheduler started (interval=%ds, task=%s)",
            self._interval,
            self._name,
        )

    async def stop(self) -> None:
        """Signal the loop to stop and wait for it to wind down.

        Sets the shutdown flag and cancels the task if it is mid-sleep.
        Any in-flight tick is given up to ``_STOP_TIMEOUT_SECONDS`` to
        finish cleanly before being cancelled.
        """

        self._stopped.set()
        task = self._task
        if task is None or task.done():
            self._task = None
            return

        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=_STOP_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            logger.warning(
                "Ingest scheduler did not stop within %.1fs; cancelling.",
                _STOP_TIMEOUT_SECONDS,
            )
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        except asyncio.CancelledError:
            # Propagated cancellation from outside; ensure task is done.
            task.cancel()
            raise
        finally:
            self._task = None

        logger.info("Ingest scheduler stopped cleanly.")

    # -- internals ---------------------------------------------------------

    async def _loop(self) -> None:
        """Main loop: tick immediately, then every ``_interval`` seconds."""

        # First tick fires right away so a fresh boot ingests promptly.
        await self._tick()

        while not self._stopped.is_set():
            try:
                await asyncio.sleep(self._interval)
            except asyncio.CancelledError:
                logger.info("Ingest scheduler sleep interrupted; exiting loop.")
                return
            if self._stopped.is_set():
                return
            await self._tick()

    async def _tick(self) -> None:
        """Run one ingest cycle, logging the outcome or any failure."""

        try:
            result = await self._ingest_fn()
        except Exception as exc:
            # Never let a single failed tick kill the scheduler.
            logger.exception("Scheduled ingest cycle failed: %s", exc)
            return

        logger.info(
            "Scheduled ingest complete: fetched=%s upserted=%s scored=%s",
            result.get("fetched"),
            result.get("upserted"),
            result.get("scored"),
        )
