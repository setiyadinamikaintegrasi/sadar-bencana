"""BMKG Common Alerting Protocol (CAP) nowcast connector."""

from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

import httpx

from models.official_alert import OfficialAlertInput

logger = logging.getLogger(__name__)

BMKG_CAP_RSS_URL = "https://www.bmkg.go.id/alerts/nowcast/id"
BMKG_ATTRIBUTION = "BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)"
BMKG_CAP_USER_AGENT = "sadar-bencana/0.2 (+https://github.com/setiyadinamikaintegrasi/sadar-bencana)"
MAX_ACTIVE_ALERTS = 50


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child_text(node: ET.Element, name: str) -> str:
    for child in list(node):
        if _local_name(child.tag) == name:
            return "".join(child.itertext()).strip()
    return ""


def _children(node: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in list(node) if _local_name(child.tag) == name]


def _parse_datetime(value: str, field: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"invalid CAP {field}: {value!r}") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"CAP {field} must include a timezone")
    return parsed


def _allowed_cap_url(url: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and (
        host == "bmkg.go.id" or host.endswith(".bmkg.go.id")
    )


def parse_bmkg_cap_rss(xml_text: str) -> list[str]:
    """Return unique, allowlisted CAP detail URLs from the BMKG RSS feed."""
    root = ET.fromstring(xml_text)
    urls: list[str] = []
    seen: set[str] = set()
    for node in root.iter():
        if _local_name(node.tag) != "item":
            continue
        link = _child_text(node, "link")
        if link and link not in seen and _allowed_cap_url(link):
            urls.append(link)
            seen.add(link)
        if len(urls) >= MAX_ACTIVE_ALERTS:
            break
    return urls


def _parse_polygon(raw: str) -> list[list[float]] | None:
    ring: list[list[float]] = []
    for pair in raw.split():
        values = pair.split(",")
        if len(values) != 2:
            return None
        try:
            latitude, longitude = float(values[0]), float(values[1])
        except ValueError:
            return None
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            return None
        ring.append([longitude, latitude])
    if len(ring) < 3:
        return None
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def _area_geojson(info: ET.Element) -> dict[str, Any] | None:
    rings: list[list[list[float]]] = []
    for area in _children(info, "area"):
        for polygon in _children(area, "polygon"):
            ring = _parse_polygon("".join(polygon.itertext()).strip())
            if ring:
                rings.append([ring])
    if not rings:
        return None
    if len(rings) == 1:
        return {"type": "Polygon", "coordinates": rings[0]}
    return {"type": "MultiPolygon", "coordinates": rings}


def _preferred_info(root: ET.Element) -> ET.Element:
    infos = _children(root, "info")
    if not infos:
        raise ValueError("CAP alert does not contain an info block")
    for info in infos:
        language = _child_text(info, "language").lower()
        if language.startswith("id"):
            return info
    return infos[0]


def _lifecycle_identifier(
    root: ET.Element,
    identifier: str,
    message_type: str,
) -> str:
    """Use the original referenced identifier for CAP update/cancel revisions."""
    if message_type == "alert":
        return identifier
    references = _child_text(root, "references").split()
    # CAP references are space-separated entries, each encoded as
    # sender,identifier,sent. The first entry identifies the original message.
    if references:
        first_reference = references[0].split(",", 2)
        if len(first_reference) == 3 and first_reference[1]:
            return first_reference[1]
    return identifier


def parse_bmkg_cap(xml_text: str) -> OfficialAlertInput:
    """Normalize one BMKG CAP document into the official alert lifecycle model."""
    root = ET.fromstring(xml_text)
    if _local_name(root.tag) != "alert":
        raise ValueError("CAP document root must be alert")

    identifier = _child_text(root, "identifier")
    sent_raw = _child_text(root, "sent")
    message_type_raw = (_child_text(root, "msgType") or "Alert").lower()
    if not identifier or not sent_raw:
        raise ValueError("CAP identifier and sent are required")

    message_type_map = {
        "alert": "alert",
        "update": "update",
        "cancel": "cancel",
    }
    if message_type_raw not in message_type_map:
        raise ValueError(f"unsupported CAP msgType: {message_type_raw}")
    message_type = message_type_map[message_type_raw]

    info = _preferred_info(root)
    effective_raw = _child_text(info, "effective")
    expires_raw = _child_text(info, "expires")

    return OfficialAlertInput(
        source="bmkg_cap",
        source_alert_id=_lifecycle_identifier(root, identifier, message_type),
        message_type=message_type,
        status="cancelled" if message_type == "cancel" else "active",
        sent_at=_parse_datetime(sent_raw, "sent"),
        effective_at=_parse_datetime(effective_raw, "effective") if effective_raw else None,
        expires_at=_parse_datetime(expires_raw, "expires") if expires_raw else None,
        headline=_child_text(info, "headline") or _child_text(info, "event") or None,
        description=_child_text(info, "description") or None,
        area_geojson=_area_geojson(info),
        raw_payload={
            "format": "CAP-XML",
            "message_identifier": identifier,
            "xml": xml_text,
        },
    )


class BMKGCAPConnector:
    def __init__(
        self,
        http_client: httpx.AsyncClient | None = None,
        timeout: float = 20.0,
    ) -> None:
        self._client = http_client
        self._timeout = timeout
        self._owns_client = http_client is None

    async def fetch_active(self) -> tuple[list[OfficialAlertInput], list[str]]:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=self._timeout,
                follow_redirects=True,
                headers={"User-Agent": BMKG_CAP_USER_AGENT},
            )
        assert self._client is not None

        response = await self._client.get(BMKG_CAP_RSS_URL)
        response.raise_for_status()
        urls = parse_bmkg_cap_rss(response.text)

        alerts: list[OfficialAlertInput] = []
        errors: list[str] = []
        for url in urls:
            try:
                detail = await self._client.get(url)
                detail.raise_for_status()
                alert = parse_bmkg_cap(detail.text)
                alert.raw_payload["source_url"] = url
                alerts.append(alert)
            except Exception as exc:
                logger.warning("BMKG CAP detail failed for %s: %s", url, exc)
                errors.append(f"{url}: {exc}")
        return alerts, errors

    async def close(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None


__all__ = [
    "BMKG_ATTRIBUTION",
    "BMKG_CAP_RSS_URL",
    "BMKGCAPConnector",
    "parse_bmkg_cap",
    "parse_bmkg_cap_rss",
]
