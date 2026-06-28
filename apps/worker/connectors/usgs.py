"""USGS earthquake feed connector."""

from __future__ import annotations

from typing import Any

import httpx

from connectors.base import BaseConnector
from models.event import EarthquakeEvent
from normalizers.events import normalize_usgs_feature


class USGSConnector(BaseConnector):
    """Fetches recent earthquake events from USGS GeoJSON feeds."""

    SIGNIFICANT_FEED_URL = (
        "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson"
    )
    FALLBACK_FEED_URL = (
        "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson"
    )

    def __init__(
        self,
        http_client: httpx.AsyncClient | None = None,
        timeout: float = 30.0,
    ) -> None:
        self._client = http_client
        self._timeout = timeout
        self._owns_client = http_client is None

    async def fetch_recent(self) -> list[EarthquakeEvent]:
        """Fetch and normalize recent earthquake events from USGS feeds."""

        primary_error: Exception | None = None
        fallback_error: Exception | None = None

        try:
            features = await self._fetch_features(self.SIGNIFICANT_FEED_URL)
        except httpx.HTTPError as exc:
            primary_error = exc
            features = []

        if not features:
            try:
                features = await self._fetch_features(self.FALLBACK_FEED_URL)
            except httpx.HTTPError as exc:
                fallback_error = exc
                features = []

        if primary_error and fallback_error:
            raise RuntimeError(
                "Failed to fetch earthquake feeds from USGS; both significant and fallback requests errored."
            ) from fallback_error

        if not features:
            raise RuntimeError("USGS feeds returned no earthquake features.")

        return [normalize_usgs_feature(feature) for feature in features]

    async def close(self) -> None:
        """Close any internally managed HTTP client."""

        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _fetch_features(self, url: str) -> list[dict[str, Any]]:
        """Fetch a USGS GeoJSON feed and return its feature list."""

        client = self._client
        if client is None:
            client = httpx.AsyncClient(timeout=self._timeout)
            self._client = client

        response = await client.get(url)
        response.raise_for_status()
        payload = response.json()
        return payload.get("features") or []
