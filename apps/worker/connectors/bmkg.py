"""BMKG earthquake feed connector.

Fetches Indonesian earthquake data from the public BMKG TEWS JSON feeds.
BMKG is the authoritative source for events inside Indonesian territory;
USGS remains the fallback for events outside Indonesia.

Endpoints (all return JSON):
  * autogempa.json      — latest single event
  * gempaterkini.json   — 15 most recent M5.0+ events
  * gempadirasakan.json — 15 most recent felt events

The connector merges all three feeds and de-duplicates by event_id (which
is derived deterministically from DateTime+Coordinates in the normalizer).
"""

from __future__ import annotations

from typing import Any

import httpx

from connectors.base import BaseConnector
from models.event import EarthquakeEvent
from normalizers.bmkg import normalize_bmkg_feed


class BMKGConnector(BaseConnector):
    """Fetches and normalizes recent earthquake events from BMKG TEWS feeds."""

    BASE_URL = "https://data.bmkg.go.id/DataMKG/TEWS"
    AUTO_GEMPA_URL = f"{BASE_URL}/autogempa.json"
    GEMPA_TERKINI_URL = f"{BASE_URL}/gempaterkini.json"
    GEMPA_DIRASAKAN_URL = f"{BASE_URL}/gempadirasakan.json"

    def __init__(
        self,
        http_client: httpx.AsyncClient | None = None,
        timeout: float = 30.0,
    ) -> None:
        self._client = http_client
        self._timeout = timeout
        self._owns_client = http_client is None

    async def fetch_recent(self) -> list[EarthquakeEvent]:
        """Fetch all three BMKG feeds, merge, and de-duplicate events.

        Feed failures are tolerated individually — if ``autogempa`` is down
        but ``gempaterkini`` works, we still return what we have. Only when
        all three fail do we raise.
        """

        seen: dict[str, EarthquakeEvent] = {}
        errors: list[str] = []

        for label, url in (
            ("autogempa", self.AUTO_GEMPA_URL),
            ("gempaterkini", self.GEMPA_TERKINI_URL),
            ("gempadirasakan", self.GEMPA_DIRASAKAN_URL),
        ):
            try:
                payload = await self._fetch_json(url)
            except httpx.HTTPError as exc:
                errors.append(f"{label}: {exc}")
                continue

            for event in normalize_bmkg_feed(payload):
                # De-dup by event_id (deterministic from DateTime+coords).
                # Later feeds do not overwrite earlier ones — autogempa
                # (the freshest single event) is processed first.
                seen.setdefault(event.event_id, event)

        if not seen and errors:
            raise RuntimeError(
                "All BMKG feeds failed: " + "; ".join(errors)
            )

        return list(seen.values())

    async def close(self) -> None:
        """Close any internally managed HTTP client."""

        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _fetch_json(self, url: str) -> dict[str, Any]:
        """Fetch a BMKG JSON feed and return the parsed payload."""

        client = self._client
        if client is None:
            client = httpx.AsyncClient(timeout=self._timeout)
            self._client = client

        response = await client.get(url)
        response.raise_for_status()
        return response.json()
