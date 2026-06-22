"""GDACS Flood (FL) connector.

Fetches the global GDACS flood feed, filters to the Indonesian bounding box,
and normalizes features to the canonical :class:`~models.event.EarthquakeEvent`.

> **Verified 2026-06-22.** BNPB API and BMKG DigitalForecast are dead/403.
> GDACS is the sole flood source. Do NOT use ``country=IDN`` (returns HTTP 204).
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from connectors.base import BaseConnector
from connectors.multi_source import is_in_indonesia
from models.event import EarthquakeEvent
from normalizers.gdacs import normalize_gdacs_feature

logger = logging.getLogger(__name__)

GDACS_FLOOD_URL = (
    "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=FL&limit=50"
)

# User-Agent required — some GDACS proxies reject default httpx UA.
_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; tugure-risk-monitor/1.0)"}


class GDACSFloodConnector(BaseConnector):
    """Fetch and normalize GDACS global flood alerts, bbox-filtered for Indonesia."""

    FEED_URL = GDACS_FLOOD_URL

    def __init__(
        self,
        http_client: httpx.AsyncClient | None = None,
        timeout: float = 30.0,
    ) -> None:
        self._client = http_client
        self._timeout = timeout
        self._owns_client = http_client is None

    async def fetch_recent(self) -> list[EarthquakeEvent]:
        """Fetch global GDACS flood events and filter to Indonesia bbox."""

        features = await self._fetch_features(self.FEED_URL)

        events: list[EarthquakeEvent] = []
        for feature in features:
            event = normalize_gdacs_feature(feature, "flood")
            if is_in_indonesia(event.latitude, event.longitude):
                events.append(event)

        logger.info("GDACS Flood: %d events in Indonesia (of %d global)", len(events), len(features))
        return events

    async def close(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _fetch_features(self, url: str) -> list[dict[str, Any]]:
        client = self._client
        if client is None:
            client = httpx.AsyncClient(timeout=self._timeout, headers=_HEADERS)
            self._client = client

        response = await client.get(url, headers=_HEADERS)
        response.raise_for_status()

        # GDACS returns 204 when no current events — treat as empty, not error.
        if response.status_code == 204 or not response.content:
            return []

        payload = response.json()
        return payload.get("features") or []
