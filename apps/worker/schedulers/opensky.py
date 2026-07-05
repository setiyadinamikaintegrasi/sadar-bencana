"""Polling cadence and rate-limit backoff for the optional OpenSky source."""

from __future__ import annotations

import time
from collections.abc import Callable


class OpenSkyPollGate:
    """Keep OpenSky polling independent from the faster asset-drain loop."""

    def __init__(
        self,
        *,
        interval_seconds: int,
        backoff_initial_seconds: int,
        backoff_max_seconds: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._interval = interval_seconds
        self._backoff_initial = backoff_initial_seconds
        self._backoff_max = max(backoff_initial_seconds, backoff_max_seconds)
        self._clock = clock
        self._next_attempt_at = 0.0
        self._next_backoff = backoff_initial_seconds

    @property
    def seconds_until_ready(self) -> int:
        return max(0, int(self._next_attempt_at - self._clock() + 0.999))

    def ready(self) -> bool:
        return self._clock() >= self._next_attempt_at

    def succeeded(self) -> None:
        self._next_attempt_at = self._clock() + self._interval
        self._next_backoff = self._backoff_initial

    def failed(self) -> None:
        self._next_attempt_at = self._clock() + self._interval

    def rate_limited(self, retry_after_seconds: int | None = None) -> int:
        requested = retry_after_seconds or 0
        delay = min(self._backoff_max, max(self._next_backoff, requested))
        self._next_attempt_at = self._clock() + delay
        self._next_backoff = min(self._backoff_max, max(self._next_backoff * 2, delay))
        return delay


def parse_retry_after(value: str | None) -> int | None:
    """Parse the delta-seconds form of Retry-After, ignoring invalid dates."""

    if not value:
        return None
    try:
        seconds = int(value.strip())
    except ValueError:
        return None
    return seconds if seconds > 0 else None
