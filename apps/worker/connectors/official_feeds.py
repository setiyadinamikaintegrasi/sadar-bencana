"""Approved JSON feed connectors for remaining Indonesian official sources."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from urllib.parse import urlparse

import httpx

from models.official_alert import OfficialAlertInput

ALLOWED_HOSTS = {
    "inatews": ("bmkg.go.id",),
    "pvmbg": ("esdm.go.id",),
    "bnpb": ("bnpb.go.id",),
    "inarisk": ("bnpb.go.id",),
}

ADAPTER_CONTRACTS = {
    "inatews": {"v1": ("event_group_id", "sent_at")},
    "pvmbg": {"v1": ("volcano_id", "level", "published_at")},
    "bnpb": {"v1": ("report_id", "observed_at")},
    "inarisk": {"v1": ("layer_id", "context_type", "data_vintage", "attribution")},
}


def validate_official_feed_url(source: str, url: str) -> None:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    allowed = ALLOWED_HOSTS[source]
    if parsed.scheme != "https" or not any(host == item or host.endswith(f".{item}") for item in allowed):
        raise ValueError(f"{source} feed must use an approved HTTPS official host")


class ApprovedJSONFeedConnector:
    def __init__(self, source: str, url: str, client: httpx.AsyncClient | None = None, api_token: str | None = None):
        validate_official_feed_url(source, url)
        self.source, self.url = source, url
        self.client = client
        self.owns_client = client is None
        self.api_token = api_token

    async def fetch_payload(self) -> Any:
        if self.client is None:
            headers = {"User-Agent": "SadarBencana/0.4 official-source-connector"}
            if self.api_token:
                headers["Authorization"] = f"Bearer {self.api_token}"
            self.client = httpx.AsyncClient(
                timeout=30,
                follow_redirects=False,
                headers=headers,
            )
        response = await self.client.get(self.url)
        response.raise_for_status()
        return response.json()

    async def fetch(self) -> list[dict[str, Any]]:
        return extract_official_records(await self.fetch_payload(), {})

    async def close(self) -> None:
        if self.owns_client and self.client is not None:
            await self.client.aclose()


def _time(value: Any, field: str) -> datetime:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError(f"{field} requires timezone")
    return parsed


def _mapped_value(record: dict[str, Any], path: str) -> Any:
    value: Any = record
    for segment in path.split("."):
        if not isinstance(value, dict) or segment not in value:
            return None
        value = value[segment]
    return value


def apply_field_mapping(
    record: dict[str, Any],
    mapping: dict[str, str] | None,
) -> dict[str, Any]:
    result = dict(record)
    for canonical, path in (mapping or {}).items():
        if canonical != "__records":
            result[canonical] = _mapped_value(record, path)
    return result


def extract_official_records(
    payload: Any,
    mapping: dict[str, str] | None,
) -> list[dict[str, Any]]:
    mapping = mapping or {}
    value = payload
    if mapping.get("__records"):
        if not isinstance(payload, dict):
            raise ValueError("record path requires an object payload")
        value = _mapped_value(payload, mapping["__records"])
    elif isinstance(payload, dict):
        value = payload.get("data", payload.get("items", payload.get("results", payload)))
    if isinstance(value, dict):
        value = [value]
    if not isinstance(value, list):
        raise ValueError("official feed payload must contain a record list")
    return [
        apply_field_mapping(record, mapping)
        for record in value
        if isinstance(record, dict)
    ]


def validate_adapter_record(source: str, version: str, record: dict[str, Any]) -> None:
    try:
        required = ADAPTER_CONTRACTS[source][version]
    except KeyError as exc:
        raise ValueError(f"unsupported adapter {source}/{version}") from exc
    missing = [
        field for field in required
        if record.get(field) is None or str(record.get(field)).strip() == ""
    ]
    if missing:
        raise ValueError(f"{source}/{version} missing fields: {', '.join(missing)}")


def normalize_inatews(record: dict[str, Any]) -> OfficialAlertInput:
    bulletin = str(record["event_group_id"])
    revision = int(record.get("bulletin_number", 1))
    bulletin_type = str(record.get("bulletin_type", "earthquake")).lower()
    final = "final" in bulletin_type or bool(record.get("cancelled"))
    return OfficialAlertInput(
        source="inatews",
        source_alert_id=bulletin,
        message_type="cancel" if final else ("update" if revision > 1 else "alert"),
        status="cancelled" if final else "active",
        sent_at=_time(record["sent_at"], "sent_at"),
        effective_at=_time(record.get("effective_at", record["sent_at"]), "effective_at"),
        expires_at=_time(record["expires_at"], "expires_at") if record.get("expires_at") else None,
        headline=str(record.get("headline") or f"Buletin InaTEWS {bulletin}"),
        description=str(record.get("direction") or record.get("description") or ""),
        area_geojson=record.get("area_geojson"),
        raw_payload={"format": "approved-json", "record": record},
    )


def normalize_pvmbg(record: dict[str, Any]) -> OfficialAlertInput:
    level = int(record["level"])
    if level not in {1, 2, 3, 4}:
        raise ValueError("PVMBG level must be I-IV")
    return OfficialAlertInput(
        source="pvmbg",
        source_alert_id=str(record["volcano_id"]),
        message_type="update" if int(record.get("revision", 1)) > 1 else "alert",
        status="active",
        sent_at=_time(record["published_at"], "published_at"),
        effective_at=_time(record.get("effective_at", record["published_at"]), "effective_at"),
        expires_at=None,
        headline=f"{record.get('volcano_name', 'Gunung api')} — Level {level}",
        description=str(record.get("recommendation") or ""),
        area_geojson=record.get("recommendation_area"),
        raw_payload={"format": "approved-json", "record": record},
    )


def normalize_bnpb_impact(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "impact_key": str(record["report_id"]),
        "location_name": record.get("location_name"),
        "latitude": record.get("latitude"),
        "longitude": record.get("longitude"),
        "observed_at": _time(record["observed_at"], "observed_at"),
        "deaths": record.get("deaths"),
        "missing": record.get("missing"),
        "injured": record.get("injured"),
        "displaced": record.get("displaced"),
        "houses_damaged": record.get("houses_damaged"),
        "verification_status": "official",
    }


def normalize_inarisk_context(record: dict[str, Any]) -> dict[str, Any]:
    if not record.get("data_vintage") or not record.get("attribution"):
        raise ValueError("InaRISK context requires data vintage and attribution")
    return {
        "context_key": str(record["layer_id"]),
        "context_type": str(record["context_type"]),
        "peril_type": record.get("peril_type"),
        "administrative_code": record.get("administrative_code"),
        "data_vintage": record["data_vintage"],
        "values": record.get("values") or {},
        "area_geojson": record.get("area_geojson"),
    }


__all__ = [
    "ADAPTER_CONTRACTS",
    "ApprovedJSONFeedConnector",
    "apply_field_mapping",
    "extract_official_records",
    "normalize_bnpb_impact",
    "normalize_inarisk_context",
    "normalize_inatews",
    "normalize_pvmbg",
    "validate_adapter_record",
    "validate_official_feed_url",
]
