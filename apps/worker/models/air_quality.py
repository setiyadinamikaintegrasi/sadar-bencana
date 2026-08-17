"""Validated input for one BMKG PM2.5 observation."""

from __future__ import annotations

from datetime import datetime
from math import isfinite
from typing import Any, Literal
from urllib.parse import ParseResult, parse_qsl, urlparse

from pydantic import BaseModel, Field, field_validator, model_validator


_SENSITIVE_QUERY_KEYS = frozenset({"auth", "key", "secret", "signature", "token"})
_SENSITIVE_QUERY_KEY_SUFFIXES = (
    "apikey",
    "accesstoken",
    "refreshtoken",
    "clientsecret",
    "signature",
    "authorization",
    "credential",
    "credentials",
    "password",
    "passwd",
)


def _source_url_contains_credentials(parsed: ParseResult) -> bool:
    if parsed.username is not None or parsed.password is not None or parsed.fragment:
        return True
    query = parsed.query.replace(";", "&")
    for raw_key, _ in parse_qsl(query, keep_blank_values=True):
        key = "".join(character for character in raw_key.lower() if character.isalnum())
        if key in _SENSITIVE_QUERY_KEYS or key.endswith(_SENSITIVE_QUERY_KEY_SUFFIXES):
            return True
    return False


def _is_json_compatible(value: Any) -> bool:
    if value is None or isinstance(value, (bool, int, str)):
        return True
    if isinstance(value, float):
        return isfinite(value)
    if isinstance(value, list):
        return all(_is_json_compatible(item) for item in value)
    if isinstance(value, dict):
        return all(
            isinstance(key, str) and _is_json_compatible(item)
            for key, item in value.items()
        )
    return False


class AirQualityObservationInput(BaseModel):
    source: Literal["bmkg"] = "bmkg"
    station_id: str = Field(min_length=1, max_length=255)
    station_name: str = Field(min_length=1)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    pollutant: Literal["pm25"] = "pm25"
    value: float = Field(ge=0)
    unit: str
    category: Literal[
        "Baik", "Sedang", "Tidak Sehat", "Sangat Tidak Sehat", "Berbahaya"
    ]
    observed_at: datetime
    source_url: str | None = None
    raw_payload: dict[str, Any]

    @field_validator("unit")
    @classmethod
    def normalize_unit(cls, value: str) -> str:
        if value.strip().lower() not in {"ug/m3", "µg/m³", "μg/m³"}:
            raise ValueError("PM2.5 unit must be micrograms per cubic meter")
        return "ug/m3"

    @field_validator("observed_at")
    @classmethod
    def observed_at_must_have_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("observed_at must include a timezone")
        return value

    @field_validator("source_url")
    @classmethod
    def source_url_must_be_official_bmkg(cls, value: str | None) -> str | None:
        if value is None:
            return None
        parsed = urlparse(value)
        try:
            host = (parsed.hostname or "").lower().rstrip(".")
            port = parsed.port
        except ValueError as exc:
            raise ValueError(
                "source_url must use an official BMKG HTTPS host"
            ) from exc
        if (
            parsed.scheme != "https"
            or port not in (None, 443)
            or not (host == "bmkg.go.id" or host.endswith(".bmkg.go.id"))
        ):
            raise ValueError("source_url must use an official BMKG HTTPS host")
        if _source_url_contains_credentials(parsed):
            raise ValueError(
                "source_url must use an official BMKG HTTPS host without credentials"
            )
        return value

    @field_validator("raw_payload", mode="before")
    @classmethod
    def raw_payload_must_be_json_compatible(cls, value: Any) -> Any:
        if not _is_json_compatible(value):
            raise ValueError("raw_payload must be JSON-compatible")
        return value

    @model_validator(mode="after")
    def coordinates_must_be_set_together(self) -> AirQualityObservationInput:
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must both be set or both be null")
        return self


__all__ = ["AirQualityObservationInput"]
