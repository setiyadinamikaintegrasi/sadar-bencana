"""Periodic briefing generation scheduler.

Runs an automatic reinsurance-briefing generation cycle (fetch top events
-> Gemma4-E4B summary -> persist) on a fixed 6-hour interval using the
local LLM. Designed to be started from FastAPI's startup hook and
gracefully cancelled from the shutdown hook, mirroring the lifecycle of
:class:`schedulers.ingest.IngestScheduler`.

Usage::

    scheduler = BriefingScheduler(briefing_fn=_generate_briefing_once)

    @app.on_event("startup")
    async def startup():
        scheduler.start()

    @app.on_event("shutdown")
    async def shutdown():
        await scheduler.stop()

The ``briefing_fn`` callable is expected to perform the full cycle
(fetch -> LLM generate -> save) and return a dict describing the
outcome. Any exception it raises is logged and swallowed so a single
failed tick never kills the loop.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable, Optional

logger = logging.getLogger(__name__)

# Default cadence: auto-briefing every 6 hours (21600s).
DEFAULT_INTERVAL_SECONDS = 21600

# Grace period given to an in-flight tick when stopping.
_STOP_TIMEOUT_SECONDS = 30.0

# Type alias for the injectable briefing coroutine.
BriefingFn = Callable[[], Awaitable[dict]]


class BriefingScheduler:
    """Runs a briefing-generation coroutine on a fixed interval until stopped.

    The scheduler runs one tick immediately on :meth:`start` so a fresh
    boot generates a briefing promptly rather than waiting a full 6 hours.
    Each subsequent tick fires ``interval_seconds`` after the previous one
    completed, using :func:`asyncio.sleep` so the wait is interruptible
    by cancellation.
    """

    def __init__(
        self,
        briefing_fn: BriefingFn,
        interval_seconds: int = DEFAULT_INTERVAL_SECONDS,
        *,
        name: str = "briefing-scheduler",
    ) -> None:
        self._briefing_fn = briefing_fn
        self._interval = max(1, int(interval_seconds))
        self._name = name
        self._task: Optional[asyncio.Task[None]] = None
        self._stopped = asyncio.Event()

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        """Start the background loop. No-op if already running."""

        if self._task is not None and not self._task.done():
            logger.debug("Briefing scheduler already running; start() is a no-op.")
            return

        self._stopped.clear()
        self._task = asyncio.create_task(self._loop(), name=self._name)
        logger.info(
            "Briefing scheduler started (interval=%ds, task=%s)",
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
                "Briefing scheduler did not stop within %.1fs; cancelling.",
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

        logger.info("Briefing scheduler stopped cleanly.")

    # -- internals ---------------------------------------------------------

    async def _loop(self) -> None:
        """Main loop: tick immediately, then every ``_interval`` seconds."""

        # First tick fires right away so a fresh boot briefs promptly.
        await self._tick()

        while not self._stopped.is_set():
            try:
                await asyncio.sleep(self._interval)
            except asyncio.CancelledError:
                logger.info("Briefing scheduler sleep interrupted; exiting loop.")
                return
            if self._stopped.is_set():
                return
            await self._tick()

    async def _tick(self) -> None:
        """Run one briefing-generation cycle, logging outcome or failure."""

        try:
            result = await self._briefing_fn()
        except Exception as exc:
            # Never let a single failed tick kill the scheduler.
            logger.exception("Scheduled briefing cycle failed: %s", exc)
            return

        if result.get("skipped"):
            logger.info(
                "Scheduled briefing skipped (no events); event_count=%s",
                result.get("event_count"),
            )
            return

        logger.info(
            "Scheduled briefing complete: event_count=%s model=%s id=%s",
            result.get("event_count"),
            result.get("model"),
            result.get("id"),
        )
