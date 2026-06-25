"""PetaBencana.id flood connector.

Fetches recent geolocated flood reports from the PetaBencana ``/reports`` API,
filters to flood reports inside the Indonesian bounding box, and normalizes them
to the canonical :class:`~models.event.EarthquakeEvent`. Complements the sparse
GDACS FL feed with real-time, government-confirmed Indonesia flood data.

> **Verified 2026-06-25.** ``geoformat=geojson`` returns a FeatureCollection.
> The feed is seasonal: empty in the dry season, populated Nov–Mar.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from connectors.base import BaseConnector
from connectors.multi_source import is_in_indonesia
from models.event import EarthquakeEvent
from normalizers.petabencana import normalize_petabencana_feature

logger = logging.getLogger(__name__)

# Last 7 days of confirmed flood reports (max window the reports API allows).
PETABENCANA_FLOOD_URL = (
    "https://data.petabencana.id/reports?disaster=flood&timeperiod=604800&geoformat=geojson"
)

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; tugure-risk-monitor/1.0)"}


class PetaBencanaFloodConnector(BaseConnector):
    """Fetch and normalize PetaBencana flood reports, bbox-filtered for Indonesia."""

    FEED_URL = PETABENCANA_FLOOD_URL

    def __init__(
        self,
        http_client: httpx.AsyncClient | None = None,
        timeout: float = 30.0,
    ) -> None:
        self._client = http_client
        self._timeout = timeout
        self._owns_client = http_client is None

    async def fetch_recent(self) -> list[EarthquakeEvent]:
        """Fetch recent PetaBencana flood reports inside the Indonesia bbox."""

        features = await self._fetch_features(self.FEED_URL)

        events: list[EarthquakeEvent] = []
        for feature in features:
            properties = feature.get("properties") or {}
            if properties.get("disaster_type") != "flood":
                continue
            event = normalize_petabencana_feature(feature)
            if is_in_indonesia(event.latitude, event.longitude):
                events.append(event)

        logger.info("PetaBencana Flood: %d flood reports in Indonesia (of %d)", len(events), len(features))
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

        if response.status_code == 204 or not response.content:
            return []

        payload = response.json()
        result = payload.get("result") or {}
        return result.get("features") or []
