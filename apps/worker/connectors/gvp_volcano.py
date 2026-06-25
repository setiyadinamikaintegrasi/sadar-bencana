"""Smithsonian GVP Weekly Volcanic Activity Report connector.

Fetches the Global Volcanism Program weekly RSS feed, parses each ``<item>``
into the canonical :class:`~models.event.EarthquakeEvent`, and filters to the
Indonesian bounding box. Complements the sparse GDACS VO feed: GVP refreshes
every Thursday and reliably lists Indonesia's many active volcanoes.

> **Verified 2026-06-25.** PVMBG MAGMA API requires a token (HTTP 401), so GVP
> (which republishes PVMBG alert levels) is the practical fresh volcano source.
"""

from __future__ import annotations

import logging
import xml.etree.ElementTree as ET

import httpx

from connectors.base import BaseConnector
from connectors.multi_source import is_in_indonesia
from models.event import EarthquakeEvent
from normalizers.gvp import normalize_gvp_item

logger = logging.getLogger(__name__)

GVP_WEEKLY_URL = "https://volcano.si.edu/news/WeeklyVolcanoRSS.xml"

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; tugure-risk-monitor/1.0)"}


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


class GVPVolcanoConnector(BaseConnector):
    """Fetch and normalize GVP weekly volcano reports, bbox-filtered for Indonesia."""

    FEED_URL = GVP_WEEKLY_URL

    def __init__(
        self,
        http_client: httpx.AsyncClient | None = None,
        timeout: float = 30.0,
    ) -> None:
        self._client = http_client
        self._timeout = timeout
        self._owns_client = http_client is None

    async def fetch_recent(self) -> list[EarthquakeEvent]:
        """Fetch GVP weekly volcano reports and filter to Indonesia bbox."""

        items = await self._fetch_items(self.FEED_URL)

        events: list[EarthquakeEvent] = []
        for item in items:
            event = normalize_gvp_item(item)
            if is_in_indonesia(event.latitude, event.longitude):
                events.append(event)

        logger.info("GVP Volcano: %d events in Indonesia (of %d reported)", len(events), len(items))
        return events

    async def close(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _fetch_items(self, url: str) -> list[dict[str, str]]:
        client = self._client
        if client is None:
            client = httpx.AsyncClient(timeout=self._timeout, headers=_HEADERS)
            self._client = client

        response = await client.get(url, headers=_HEADERS)
        response.raise_for_status()

        if not response.content:
            return []

        return _parse_rss_items(response.text)


def _parse_rss_items(xml_text: str) -> list[dict[str, str]]:
    """Parse a GVP RSS document into a list of item dicts.

    Each dict carries ``title``, ``description``, ``guid``, ``link``,
    ``pubDate`` and ``point`` keys (missing fields default to "").
    """

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        logger.warning("GVP feed returned unparseable XML")
        return []

    items: list[dict[str, str]] = []
    for elem in root.iter():
        if _local_name(elem.tag) != "item":
            continue
        fields = {"title": "", "description": "", "guid": "", "link": "", "pubDate": "", "point": ""}
        for child in list(elem):
            name = _local_name(child.tag)
            if name == "point":
                fields["point"] = (child.text or "").strip()
            elif name in fields:
                fields[name] = (child.text or "").strip()
        items.append(fields)

    return items
