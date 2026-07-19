"""Gated connector and parser for official BMKG air-quality JSON feeds."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

import httpx
from pydantic import ValidationError

from connectors.bounded_response import read_bounded_response
from models.air_quality import AirQualityObservationInput
from models.official_alert import OfficialAlertInput
from ssrf_guard import resolve_public_ips

ALLOWED_HOSTS = ("bmkg.go.id",)
USER_AGENT = "SadarBencana/0.5 bmkg-air-quality"
TIMEOUT_SECONDS = 30

AIR_QUALITY_SEVERITY = {
    "Tidak Sehat": "Moderate",
    "Sangat Tidak Sehat": "High",
    "Berbahaya": "Critical",
}

DEFAULT_MAPPING = {
    "__warnings": "warnings",
    "__observations": "observations",
}

WARNING_FIELDS = (
    "source_alert_id",
    "message_type",
    "status",
    "sent_at",
    "effective_at",
    "expires_at",
    "category",
    "area_name",
    "area_geojson",
    "latitude",
    "longitude",
    "headline",
    "description",
    "source_url",
)

OBSERVATION_FIELDS = (
    "station_id",
    "station_name",
    "latitude",
    "longitude",
    "value",
    "unit",
    "category",
    "observed_at",
    "source_url",
)


def _mapped_value(value: Any, path: str) -> Any:
    current = value
    for segment in path.split("."):
        if not isinstance(current, dict) or segment not in current:
            return None
        current = current[segment]
    return current


def _mapped_record(
    record: dict[str, Any],
    prefix: str,
    mapping: dict[str, str],
    fields: tuple[str, ...],
) -> dict[str, Any]:
    result = dict(record)
    for field in fields:
        path = mapping.get(prefix + "." + field)
        if path:
            result[field] = _mapped_value(record, path)
    return result


def _record_error(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        errors = exc.errors(include_url=False, include_context=False, include_input=False)
        if errors:
            location = ".".join(str(item) for item in errors[0]["loc"])
            return f"{location}: {errors[0]['msg']}" if location else errors[0]["msg"]
    return str(exc)


def parse_air_quality_payload(
    payload: Any,
    mapping: dict[str, str] | None,
) -> tuple[
    list[OfficialAlertInput],
    list[AirQualityObservationInput],
    list[str],
]:
    """Separate official warnings from display-only PM2.5 observations."""
    if not isinstance(payload, dict):
        raise ValueError("air-quality payload must be an object")

    mapping = {**DEFAULT_MAPPING, **(mapping or {})}
    raw_warnings = _mapped_value(payload, mapping["__warnings"])
    raw_observations = _mapped_value(payload, mapping["__observations"])
    if not isinstance(raw_warnings, list) or not isinstance(raw_observations, list):
        raise ValueError("warnings and observations must be arrays")

    warnings: list[OfficialAlertInput] = []
    observations: list[AirQualityObservationInput] = []
    errors: list[str] = []

    for index, raw_record in enumerate(raw_warnings):
        identity = f"index {index}"
        if isinstance(raw_record, dict):
            identity = str(raw_record.get("source_alert_id") or identity)
        try:
            if not isinstance(raw_record, dict):
                raise ValueError("record must be an object")
            record = _mapped_record(raw_record, "warning", mapping, WARNING_FIELDS)
            identity = str(record.get("source_alert_id") or identity)
            category = record.get("category")
            if category not in AIR_QUALITY_SEVERITY:
                raise ValueError("category is not extreme")
            warnings.append(OfficialAlertInput(
                source="bmkg_air_quality",
                source_alert_id=record["source_alert_id"],
                message_type=record.get("message_type", "alert"),
                status=record.get("status", "active"),
                sent_at=datetime.fromisoformat(record["sent_at"]),
                effective_at=datetime.fromisoformat(record["effective_at"]),
                expires_at=datetime.fromisoformat(record["expires_at"]),
                headline=record.get("headline"),
                description=record.get("description"),
                area_geojson=record.get("area_geojson"),
                peril_type="air_quality",
                severity=AIR_QUALITY_SEVERITY[category],
                category=category,
                area_name=record.get("area_name"),
                latitude=record.get("latitude"),
                longitude=record.get("longitude"),
                source_url=record["source_url"],
                raw_payload=record,
            ))
        except (KeyError, TypeError, ValueError, ValidationError) as exc:
            errors.append(f"warning {identity}: {_record_error(exc)}")

    for index, raw_record in enumerate(raw_observations):
        identity = f"index {index}"
        if isinstance(raw_record, dict):
            identity = str(raw_record.get("station_id") or identity)
        try:
            if not isinstance(raw_record, dict):
                raise ValueError("record must be an object")
            record = _mapped_record(
                raw_record,
                "observation",
                mapping,
                OBSERVATION_FIELDS,
            )
            identity = str(record.get("station_id") or identity)
            observations.append(AirQualityObservationInput(
                source="bmkg",
                station_id=record["station_id"],
                station_name=record["station_name"],
                latitude=record.get("latitude"),
                longitude=record.get("longitude"),
                pollutant="pm25",
                value=record["value"],
                unit=record["unit"],
                category=record["category"],
                observed_at=datetime.fromisoformat(record["observed_at"]),
                source_url=record["source_url"],
                raw_payload=record,
            ))
        except (KeyError, TypeError, ValueError, ValidationError) as exc:
            errors.append(f"observation {identity}: {_record_error(exc)}")

    return warnings, observations, errors


def validate_bmkg_air_quality_url(url: str) -> None:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower().rstrip(".")
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError("air-quality endpoint must use an official BMKG HTTPS host") from exc
    if (
        parsed.scheme != "https"
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
        or not any(host == allowed or host.endswith(f".{allowed}") for allowed in ALLOWED_HOSTS)
    ):
        raise ValueError("air-quality endpoint must use an official BMKG HTTPS host")


class BMKGAirQualityConnector:
    def __init__(
        self,
        url: str,
        client: httpx.AsyncClient | None = None,
        api_token: str | None = None,
    ) -> None:
        validate_bmkg_air_quality_url(url)
        self.url = url
        self.client = client
        self.owns_client = client is None
        self.api_token = api_token

    async def fetch_payload(self) -> dict[str, Any]:
        parsed = urlparse(self.url)
        hostname = parsed.hostname
        if not hostname:
            raise ValueError("air-quality endpoint requires a hostname")

        resolved_ip = resolve_public_ips(hostname)[0]
        ip_host = f"[{resolved_ip}]" if ":" in resolved_ip else resolved_ip
        port = f":{parsed.port}" if parsed.port is not None else ""
        pinned_url = parsed._replace(netloc=f"{ip_host}{port}").geturl()
        host_header = hostname if parsed.port is None else f"{hostname}:{parsed.port}"

        if self.client is None:
            self.client = httpx.AsyncClient(
                timeout=TIMEOUT_SECONDS,
                follow_redirects=False,
                headers={"User-Agent": USER_AGENT},
            )
        headers = {"Host": host_header}
        if self.api_token:
            headers["Authorization"] = f"Bearer {self.api_token}"
        request = self.client.build_request(
            "GET",
            pinned_url,
            headers=headers,
            extensions={"sni_hostname": hostname},
        )
        response = await self.client.send(
            request,
            follow_redirects=False,
            stream=True,
        )
        payload = json.loads(await read_bounded_response(
            response,
            label="air-quality payload",
        ))
        if not isinstance(payload, dict):
            raise ValueError("air-quality payload must be a JSON object")
        return payload

    async def close(self) -> None:
        if self.owns_client and self.client is not None:
            await self.client.aclose()


__all__ = [
    "AIR_QUALITY_SEVERITY",
    "BMKGAirQualityConnector",
    "parse_air_quality_payload",
    "validate_bmkg_air_quality_url",
]
