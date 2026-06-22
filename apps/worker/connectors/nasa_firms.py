"""NASA FIRMS VIIRS wildfire connector.

Fetches the Southeast Asia 24h NOAA-20 VIIRS archive CSV, filters hotspots to
Indonesia's bounding box, keeps confidence >= 70, caps the result set at 200,
and normalizes rows to the canonical event schema.
"""

from __future__ import annotations

import csv
import io
import logging

import httpx

from connectors.base import BaseConnector
from connectors.multi_source import is_in_indonesia
from models.event import EarthquakeEvent
from normalizers.firms import confidence_score, normalize_firms_row

logger = logging.getLogger(__name__)

FIRMS_URL = (
    "https://firms.modaps.eosdis.nasa.gov/data/active_fire/"
    "noaa-20-viirs-c2/csv/J1_VIIRS_C2_SouthEast_Asia_24h.csv"
)
FIRMS_USER_AGENT = "Mozilla/5.0 (compatible; tugure-risk-monitor/1.0)"
FIRMS_MAX_EVENTS = 200
FIRMS_MIN_CONFIDENCE = 70


class NASAFIRMSConnector(BaseConnector):
    """Fetch and normalize wildfire hotspots from NASA FIRMS archive CSV."""

    def __init__(
        self,
        http_client: httpx.AsyncClient | None = None,
        timeout: float = 30.0,
    ) -> None:
        self._client = http_client or httpx.AsyncClient(
            timeout=timeout,
            headers={"User-Agent": FIRMS_USER_AGENT},
        )
        self._owns_client = http_client is None

    async def fetch_recent(self) -> list[EarthquakeEvent]:
        response = await self._client.get(FIRMS_URL, headers={"User-Agent": FIRMS_USER_AGENT})
        response.raise_for_status()

        reader = csv.DictReader(io.StringIO(response.text))
        rows: list[dict[str, str]] = list(reader)

        filtered: list[dict[str, str]] = []
        for row in rows:
            try:
                latitude = float(row.get("latitude") or 0.0)
                longitude = float(row.get("longitude") or 0.0)
            except (TypeError, ValueError):
                continue

            if not is_in_indonesia(latitude, longitude):
                continue
            if confidence_score(row.get("confidence")) < FIRMS_MIN_CONFIDENCE:
                continue
            filtered.append(row)

        # Strongest hotspots first.
        filtered.sort(key=lambda row: float(row.get("frp") or 0.0), reverse=True)
        filtered = filtered[:FIRMS_MAX_EVENTS]

        events = [normalize_firms_row(row) for row in filtered]
        logger.info("NASA FIRMS: fetched %d hotspots (after filtering)", len(events))
        return events

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()


__all__ = [
    "NASAFIRMSConnector",
    "FIRMS_URL",
    "FIRMS_USER_AGENT",
    "FIRMS_MAX_EVENTS",
    "FIRMS_MIN_CONFIDENCE",
]
