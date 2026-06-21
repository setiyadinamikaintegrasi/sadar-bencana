"""Multi-source earthquake ingestion with geographic routing.

Routing policy:
  * Events inside the Indonesian bounding box → sourced from BMKG (primary).
  * Events outside the box → sourced from USGS (global fallback).
  * When both sources report the same event, the source whose region owns
    the epicenter wins; the duplicate is discarded.

The Indonesian bounding box is a conservative envelope covering Sumatra
through Papua plus a buffer for near-shore events.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from connectors.base import BaseConnector
from connectors.bmkg import BMKGConnector
from connectors.usgs import USGSConnector
from models.event import EarthquakeEvent

logger = logging.getLogger(__name__)

# Indonesia bounding box (inclusive).
# West:  92.0E  (Indian Ocean, west of Sumatra)
# East:  142.0E (Aru Islands / Papua border region)
# South: -12.0S (Christmas Island / southern Java trench)
# North:  8.0N  (northern tip of Sulawesi / Natuna)
INDONESIA_BBOX = {
    "min_lon": 92.0,
    "max_lon": 142.0,
    "min_lat": -12.0,
    "max_lat": 8.0,
}


def is_in_indonesia(latitude: float, longitude: float) -> bool:
    """Return True if a coordinate falls inside the Indonesian bounding box."""

    return (
        INDONESIA_BBOX["min_lat"] <= latitude <= INDONESIA_BBOX["max_lat"]
        and INDONESIA_BBOX["min_lon"] <= longitude <= INDONESIA_BBOX["max_lon"]
    )


class MultiSourceConnector(BaseConnector):
    """Routes event fetching between BMKG (Indonesia) and USGS (global).

    Usage::

        connector = MultiSourceConnector()
        events = await connector.fetch_recent()
        await connector.close()

    The connector instantiates and owns one BMKG and one USGS sub-connector.
    Both are fetched in sequence (BMKG first, then USGS). Events are merged
    with cross-source de-duplication:

      * BMKG events are always kept (they are authoritative for Indonesia).
      * USGS events that fall inside the Indonesian bbox are dropped, because
        BMKG already covers them (avoids duplicate alerts).
      * USGS events outside the bbox are kept (BMKG does not cover them).

    If BMKG fails entirely, we fall back to USGS for all regions (including
    Indonesia) so the ingest cycle never silently goes empty.
    """

    def __init__(
        self,
        http_client: httpx.AsyncClient | None = None,
        timeout: float = 30.0,
    ) -> None:
        self._bmkg = BMKGConnector(http_client=http_client, timeout=timeout)
        self._usgs = USGSConnector(http_client=http_client, timeout=timeout)
        self._owns_client = http_client is None

    async def fetch_recent(self) -> list[EarthquakeEvent]:
        """Fetch from both sources and merge with geo-aware de-duplication."""

        bmkg_events: list[EarthquakeEvent] = []
        bmkg_error: str | None = None

        try:
            bmkg_events = await self._bmkg.fetch_recent()
            logger.info("BMKG: fetched %d events", len(bmkg_events))
        except Exception as exc:  # noqa: BLE001 — tolerate upstream failure
            bmkg_error = str(exc)
            logger.warning("BMKG fetch failed: %s", exc)

        usgs_events: list[EarthquakeEvent] = []
        usgs_error: str | None = None
        try:
            usgs_events = await self._usgs.fetch_recent()
            logger.info("USGS: fetched %d events", len(usgs_events))
        except Exception as exc:  # noqa: BLE001
            usgs_error = str(exc)
            logger.warning("USGS fetch failed: %s", exc)

        if not bmkg_events and not usgs_events:
            raise RuntimeError(
                f"All sources failed. BMKG: {bmkg_error}; USGS: {usgs_error}"
            )

        return self._merge(bmkg_events, usgs_events, bmkg_ok=bmkg_error is None)

    def _merge(
        self,
        bmkg: list[EarthquakeEvent],
        usgs: list[EarthquakeEvent],
        *,
        bmkg_ok: bool,
    ) -> list[EarthquakeEvent]:
        """Merge BMKG + USGS events with geo-aware de-duplication.

        When BMKG is healthy, USGS events inside the Indonesian bbox are
        dropped (BMKG owns them). When BMKG failed, we keep everything USGS
        returned so Indonesia is still covered.
        """

        merged: dict[str, EarthquakeEvent] = {}

        # 1. BMKG events always win for their territory.
        for event in bmkg:
            merged[event.event_id] = event

        # 2. USGS events: keep only if outside Indonesia (or if BMKG is down).
        dropped_usgs = 0
        for event in usgs:
            in_id = is_in_indonesia(event.latitude, event.longitude)
            if in_id and bmkg_ok:
                dropped_usgs += 1
                continue
            merged.setdefault(event.event_id, event)

        if dropped_usgs:
            logger.info(
                "Dropped %d USGS events inside Indonesia (BMKG authoritative)",
                dropped_usgs,
            )

        return list(merged.values())

    async def close(self) -> None:
        """Close both sub-connector HTTP clients."""

        for connector in (self._bmkg, self._usgs):
            try:
                await connector.close()
            except Exception:  # noqa: BLE001
                logger.debug("Sub-connector close failed", exc_info=True)
        if self._owns_client:
            # Sub-connectors already closed the shared client if they owned it.
            pass


__all__ = ["MultiSourceConnector", "is_in_indonesia", "INDONESIA_BBOX"]
