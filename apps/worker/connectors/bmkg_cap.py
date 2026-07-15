"""BMKG Common Alerting Protocol (CAP) nowcast connector."""

from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Any
from urllib.parse import ParseResult, urljoin, urlparse

import httpx

from models.official_alert import OfficialAlertInput
from ssrf_guard import resolve_public_ips

logger = logging.getLogger(__name__)

BMKG_CAP_RSS_URL = "https://www.bmkg.go.id/alerts/nowcast/id"
BMKG_ATTRIBUTION = "BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)"
BMKG_CAP_USER_AGENT = "sadar-bencana/0.2 (+https://github.com/setiyadinamikaintegrasi/sadar-bencana)"
MAX_ACTIVE_ALERTS = 50
MAX_REDIRECTS = 5
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
CAP_SEVERITY = {
    "minor": "Moderate",
    "moderate": "Moderate",
    "severe": "High",
    "extreme": "Critical",
}


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


def _parsed_cap_url(url: str) -> ParseResult:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower().rstrip(".")
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError(f"BMKG HTTPS URL required, got {url!r}") from exc
    if (
        parsed.scheme != "https"
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
        or not (host == "bmkg.go.id" or host.endswith(".bmkg.go.id"))
    ):
        raise ValueError(f"BMKG HTTPS URL required, got {url!r}")
    return parsed


def _allowed_cap_url(url: str) -> bool:
    try:
        _parsed_cap_url(url)
    except ValueError:
        return False
    return True


def _pinned_url(parsed: ParseResult, resolved_ip: str) -> tuple[str, str, str]:
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("BMKG HTTPS URL requires a hostname")
    hostname = hostname.rstrip(".")
    ip_host = f"[{resolved_ip}]" if ":" in resolved_ip else resolved_ip
    port = f":{parsed.port}" if parsed.port is not None else ""
    pinned = parsed._replace(netloc=f"{ip_host}{port}").geturl()
    host_header = hostname if parsed.port is None else f"{hostname}:{parsed.port}"
    return pinned, host_header, hostname


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


def _area_name(info: ET.Element) -> str | None:
    names = [
        _child_text(area, "areaDesc")
        for area in _children(info, "area")
        if _child_text(area, "areaDesc")
    ]
    return "; ".join(dict.fromkeys(names)) or None


def _preferred_info(root: ET.Element) -> ET.Element | None:
    infos = _children(root, "info")
    if not infos:
        return None
    for info in infos:
        language = _child_text(info, "language").lower()
        if language.startswith("id"):
            return info
    return infos[0]


def _parse_references(root: ET.Element) -> list[dict[str, str]]:
    """Preserve CAP references so persistence can resolve chained lifecycles."""
    references: list[dict[str, str]] = []
    for raw_reference in _child_text(root, "references").split():
        parts = raw_reference.split(",", 2)
        if len(parts) != 3 or any(not part.strip() for part in parts):
            raise ValueError("CAP message must contain a valid CAP reference")
        sender, identifier, sent = (part.strip() for part in parts)
        _parse_datetime(sent, "reference sent")
        references.append(
            {
                "sender": sender,
                "identifier": identifier,
                "sent": sent,
            }
        )
    return references


def parse_bmkg_cap(
    xml_text: str,
    source_url: str | None = None,
) -> OfficialAlertInput:
    """Normalize one BMKG CAP document into the official alert lifecycle model."""
    root = ET.fromstring(xml_text)
    if _local_name(root.tag) != "alert":
        raise ValueError("CAP document root must be alert")

    identifier = _child_text(root, "identifier")
    sent_raw = _child_text(root, "sent")
    message_type_raw = (_child_text(root, "msgType") or "Alert").lower()
    if not identifier or not sent_raw:
        raise ValueError("CAP identifier and sent are required")

    cap_status = _child_text(root, "status")
    if cap_status.casefold() != "actual":
        raise ValueError(f"CAP status must be Actual, got {cap_status or 'missing'}")
    cap_scope = _child_text(root, "scope")
    if cap_scope.casefold() != "public":
        raise ValueError(f"CAP scope must be Public, got {cap_scope or 'missing'}")

    message_type_map = {
        "alert": "alert",
        "update": "update",
        "cancel": "cancel",
    }
    if message_type_raw not in message_type_map:
        raise ValueError(f"unsupported CAP msgType: {message_type_raw}")
    message_type = message_type_map[message_type_raw]

    references = _parse_references(root)
    if message_type in {"update", "cancel"} and not references:
        raise ValueError(f"CAP {message_type} must contain a valid CAP reference")

    info = _preferred_info(root)
    if info is None and message_type != "cancel":
        raise ValueError("CAP alert does not contain an info block")
    effective_raw = _child_text(info, "effective") if info is not None else ""
    expires_raw = _child_text(info, "expires") if info is not None else ""
    payload = {
        "format": "CAP-XML",
        "message_identifier": identifier,
        "references": references,
        "referenced_message_identifiers": [
            reference["identifier"] for reference in references
        ],
        "cap_status": cap_status,
        "cap_scope": cap_scope,
        "source_url": source_url,
        "xml": xml_text,
    }

    return OfficialAlertInput(
        source="bmkg_cap",
        # This is always the current CAP message identity. Persistence follows
        # raw_payload.references to resolve the canonical alert lifecycle.
        source_alert_id=identifier,
        message_type=message_type,
        status="cancelled" if message_type == "cancel" else "active",
        sent_at=_parse_datetime(sent_raw, "sent"),
        effective_at=_parse_datetime(effective_raw, "effective") if effective_raw else None,
        expires_at=_parse_datetime(expires_raw, "expires") if expires_raw else None,
        headline=(
            _child_text(info, "headline") or _child_text(info, "event") or None
            if info is not None
            else None
        ),
        description=_child_text(info, "description") or None if info is not None else None,
        area_geojson=_area_geojson(info) if info is not None else None,
        peril_type="weather",
        severity=(
            CAP_SEVERITY.get((_child_text(info, "severity") or "").lower())
            if info is not None
            else None
        ),
        area_name=_area_name(info) if info is not None else None,
        source_url=source_url,
        raw_payload=payload,
    )


class BMKGCAPConnector:
    def __init__(
        self,
        http_client: httpx.AsyncClient | None = None,
        timeout: float = 20.0,
        rss_url: str = BMKG_CAP_RSS_URL,
        api_token: str | None = None,
    ) -> None:
        self._client = http_client
        self._timeout = timeout
        self._owns_client = http_client is None
        self._rss_url = rss_url
        self._api_token = api_token

    async def _get_with_validated_redirects(
        self,
        url: str,
    ) -> tuple[httpx.Response, str]:
        assert self._client is not None
        current_url = url
        for redirect_count in range(MAX_REDIRECTS + 1):
            parsed = _parsed_cap_url(current_url)
            hostname = parsed.hostname
            if not hostname:
                raise ValueError("BMKG HTTPS URL requires a hostname")
            resolved_ip = resolve_public_ips(hostname.rstrip("."))[0]
            pinned_url, host_header, sni_hostname = _pinned_url(parsed, resolved_ip)
            headers = {
                "Host": host_header,
                "User-Agent": BMKG_CAP_USER_AGENT,
            }
            if self._api_token:
                headers["Authorization"] = f"Bearer {self._api_token}"
            request = self._client.build_request(
                "GET",
                pinned_url,
                headers=headers,
                extensions={"sni_hostname": sni_hostname},
            )
            response = await self._client.send(request, follow_redirects=False)
            if response.status_code not in REDIRECT_STATUSES:
                return response, current_url

            location = response.headers.get("Location")
            if not location:
                raise ValueError("BMKG redirect response is missing Location")
            if redirect_count >= MAX_REDIRECTS:
                raise ValueError("BMKG redirect limit exceeded")
            next_url = urljoin(current_url, location)
            # Validate before DNS resolution or any request to the next target.
            _parsed_cap_url(next_url)
            current_url = next_url

        raise ValueError("BMKG redirect limit exceeded")

    async def fetch_active(self) -> tuple[list[OfficialAlertInput], list[str]]:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=self._timeout,
                follow_redirects=False,
            )
        assert self._client is not None

        response, _ = await self._get_with_validated_redirects(self._rss_url)
        response.raise_for_status()
        urls = parse_bmkg_cap_rss(response.text)

        alerts: list[OfficialAlertInput] = []
        errors: list[str] = []
        for url in urls:
            try:
                detail, detail_url = await self._get_with_validated_redirects(url)
                detail.raise_for_status()
                alert = parse_bmkg_cap(detail.text, source_url=detail_url)
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
