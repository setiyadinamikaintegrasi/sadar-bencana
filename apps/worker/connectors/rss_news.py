"""RSS news feed connector — parses RSS/Atom feeds into NewsItem records."""

from __future__ import annotations

import hashlib
import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape

import httpx
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

RSS_USER_AGENT = "Mozilla/5.0 (compatible; tugure-risk-monitor/1.0)"
MAX_ITEMS_PER_FEED = 50

PERIL_KEYWORDS: dict[str, list[str]] = {
    "earthquake": ["gempa", "seisme", "earthquake", "richter"],
    "flood": ["banjir", "banjir bandang", "banjir rob", "flood", "genangan", "luapan"],
    "volcano": ["gunung api", "erupsi", "letusan", "volcanic", "eruption", "magma", "lava"],
    "wildfire": ["kebakaran hutan", "karhutla", "kebakaran lahan", "hotspot", "wildfire", "forest fire"],
    "fire": ["kebakaran", "damkar", "pemadam kebakaran"],
}

RSS_SOURCES: list[dict[str, str]] = [
    {"source": "antara", "url": "https://www.antaranews.com/rss/terkini.xml"},
    {"source": "detik", "url": "https://feeds.feedburner.com/detikcom"},
    {"source": "cnn", "url": "https://www.cnnindonesia.com/nasional/rss"},
    {"source": "tempo", "url": "https://rss.tempo.co/nasional"},
    {"source": "republika", "url": "https://www.republika.co.id/rss"},
    {"source": "sindo", "url": "https://www.sindonews.com/rss"},
    {"source": "okezone", "url": "https://www.okezone.com/rss"},
]


class NewsItem(BaseModel):
    item_id: str = Field(description="Deterministic 16-char hex ID from sha256(source+url)")
    source: str
    title: str
    summary: str = ""
    url: str = ""
    published_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    perils: list[str] = Field(default_factory=list)
    # Geolocation — set during the news poll cycle before upsert
    lat: float | None = Field(default=None)
    lon: float | None = Field(default=None)
    place_name: str | None = Field(default=None)


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _find_child_text(node: ET.Element, *names: str) -> str:
    wanted = set(names)
    for child in list(node):
        if _local_name(child.tag) in wanted:
            return "".join(child.itertext()).strip()
    return ""


def _find_link(node: ET.Element) -> str:
    for child in list(node):
        if _local_name(child.tag) != "link":
            continue
        href = (child.attrib.get("href") or "").strip()
        if href:
            return href
        text = "".join(child.itertext()).strip()
        if text:
            return text
    return _find_child_text(node, "guid")


def _strip_html(text: str) -> str:
    if not text:
        return ""
    cleaned = re.sub(r"<[^>]+>", " ", unescape(text))
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def _make_item_id(source: str, url: str) -> str:
    return hashlib.sha256(f"{source}:{url}".encode()).hexdigest()[:16]


def _infer_perils(title: str, summary: str) -> list[str]:
    """Infer peril types from title + summary using word-boundary matching.

    Uses \\b word boundaries so metaphorical forms like 'dibanjiri',
    'membanjiri', 'terbanjiri' do NOT match the keyword 'banjir'.
    """
    text = f"{title} {summary}".lower()
    result: list[str] = []
    for peril, keywords in PERIL_KEYWORDS.items():
        for kw in keywords:
            if re.search(rf"\b{re.escape(kw)}\b", text):
                result.append(peril)
                break
    return result


def _parse_datetime(pub_raw: str) -> datetime:
    if not pub_raw:
        return datetime.now(timezone.utc)

    try:
        parsed = parsedate_to_datetime(pub_raw)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    except Exception:
        pass

    try:
        parsed = datetime.fromisoformat(pub_raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    except Exception:
        return datetime.now(timezone.utc)


def _entry_nodes(root: ET.Element) -> list[ET.Element]:
    channel = next((child for child in list(root) if _local_name(child.tag) == "channel"), None)
    search_root = channel if channel is not None else root
    return [child for child in list(search_root) if _local_name(child.tag) in {"item", "entry"}]


def _parse_rss(source: str, xml_text: str) -> list[NewsItem]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        logger.warning("RSS parse error for %s: %s", source, exc)
        return []

    items: list[NewsItem] = []
    for node in _entry_nodes(root)[:MAX_ITEMS_PER_FEED]:
        title = _strip_html(_find_child_text(node, "title"))
        url = _find_link(node)
        if not title or not url:
            continue

        summary_raw = (
            _find_child_text(node, "description")
            or _find_child_text(node, "summary")
            or _find_child_text(node, "encoded")
        )
        summary = _strip_html(summary_raw)[:500]
        pub_raw = _find_child_text(node, "pubDate") or _find_child_text(node, "published") or _find_child_text(node, "updated")
        pub_dt = _parse_datetime(pub_raw)

        items.append(
            NewsItem(
                item_id=_make_item_id(source, url),
                source=source,
                title=title,
                summary=summary,
                url=url,
                published_at=pub_dt.isoformat(),
                perils=_infer_perils(title, summary),
            )
        )

    return items


class RSSNewsConnector:
    """Poll multiple RSS feeds and return normalized NewsItem records."""

    def __init__(
        self,
        http_client: httpx.AsyncClient | None = None,
        timeout: float = 20.0,
    ) -> None:
        self._timeout = timeout
        self._client = http_client
        self._owns_client = http_client is None

    async def fetch_all(self) -> tuple[list[NewsItem], dict[str, int | str]]:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=self._timeout,
                follow_redirects=True,
                headers={"User-Agent": RSS_USER_AGENT},
            )

        all_items: list[NewsItem] = []
        health: dict[str, int | str] = {}
        assert self._client is not None
        for feed in RSS_SOURCES:
            try:
                response = await self._client.get(
                    feed["url"], headers={"User-Agent": RSS_USER_AGENT}
                )
                response.raise_for_status()
                items = _parse_rss(feed["source"], response.text)
                logger.info("RSS %s: %d items", feed["source"], len(items))
                all_items.extend(items)
                health[feed["source"]] = len(items)
            except Exception as exc:
                logger.warning("RSS feed %s failed: %s", feed["source"], exc)
                health[feed["source"]] = str(exc)

        return all_items, health

    async def close(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None


__all__ = [
    "MAX_ITEMS_PER_FEED",
    "NewsItem",
    "PERIL_KEYWORDS",
    "RSSNewsConnector",
    "RSS_SOURCES",
    "RSS_USER_AGENT",
    "_infer_perils",
    "_make_item_id",
    "_parse_rss",
]
