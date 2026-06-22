"""Hazard multi-source connector for non-earthquake perils.

Owns three sub-connectors:
- GDACS flood
- GDACS volcano
- NASA FIRMS wildfire

The connector tolerates partial upstream failure. If one source fails, the other
successful sources are still returned. It raises only when all sources fail.
"""

from __future__ import annotations

import logging
from typing import Protocol

from connectors.base import BaseConnector
from connectors.gdacs_flood import GDACSFloodConnector
from connectors.gdacs_volcano import GDACSVolcanoConnector
from connectors.nasa_firms import NASAFIRMSConnector
from models.event import EarthquakeEvent

logger = logging.getLogger(__name__)


class _ClosableConnector(Protocol):
    async def fetch_recent(self) -> list[EarthquakeEvent]: ...
    async def close(self) -> None: ...


class HazardConnector(BaseConnector):
    """Fetch flood, volcano, and wildfire events in one call."""

    def __init__(
        self,
        flood: _ClosableConnector | None = None,
        volcano: _ClosableConnector | None = None,
        wildfire: _ClosableConnector | None = None,
    ) -> None:
        self._flood = flood or GDACSFloodConnector()
        self._volcano = volcano or GDACSVolcanoConnector()
        self._wildfire = wildfire or NASAFIRMSConnector()

    async def fetch_recent(self) -> list[EarthquakeEvent]:
        results: list[EarthquakeEvent] = []
        errors: list[str] = []

        for name, connector in (
            ("GDACS flood", self._flood),
            ("GDACS volcano", self._volcano),
            ("NASA FIRMS", self._wildfire),
        ):
            try:
                events = await connector.fetch_recent()
                logger.info("%s: fetched %d events", name, len(events))
                results.extend(events)
            except Exception as exc:  # noqa: BLE001 - upstream failures are tolerated individually
                errors.append(f"{name}: {exc}")
                logger.warning("%s fetch failed: %s", name, exc)

        if not results and errors:
            raise RuntimeError(f"All hazard sources failed. {'; '.join(errors)}")

        return results

    async def close(self) -> None:
        for connector in (self._flood, self._volcano, self._wildfire):
            try:
                await connector.close()
            except Exception:  # noqa: BLE001
                logger.debug("Hazard sub-connector close failed", exc_info=True)


__all__ = ["HazardConnector"]
