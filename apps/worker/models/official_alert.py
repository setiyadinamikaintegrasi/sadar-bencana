"""Canonical input model for an authoritative alert revision."""

from __future__ import annotations

from datetime import datetime
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


class OfficialAlertInput(BaseModel):
    source: str = Field(min_length=1, max_length=64)
    source_alert_id: str = Field(min_length=1, max_length=255)
    message_type: Literal["alert", "update", "cancel"] = "alert"
    status: Literal["active", "expired", "cancelled"] = "active"
    sent_at: datetime
    effective_at: datetime | None = None
    expires_at: datetime | None = None
    headline: str | None = None
    description: str | None = None
    area_geojson: dict[str, Any] | None = None
    peril_type: Literal["weather", "air_quality"] | None = None
    severity: Literal["Moderate", "High", "Critical"] | None = None
    category: str | None = None
    area_name: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    source_url: str | None = None
    raw_payload: dict[str, Any]

    @field_validator("source", "source_alert_id")
    @classmethod
    def identifiers_must_not_be_blank(cls, value: str, info) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("official alert identifiers must not be blank")
        return normalized.lower() if info.field_name == "source" else normalized

    @field_validator("sent_at", "effective_at", "expires_at")
    @classmethod
    def timestamps_must_include_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("official alert timestamps must include a timezone")
        return value

    @field_validator("source_url")
    @classmethod
    def source_url_must_be_official_https(cls, value: str | None, info) -> str | None:
        if value is None:
            return None
        parsed = urlparse(value)
        if parsed.scheme != "https" or not parsed.hostname:
            raise ValueError("source_url must use HTTPS")
        if _source_url_contains_credentials(parsed):
            if info.data.get("source") in {"bmkg_cap", "bmkg_air_quality"}:
                raise ValueError(
                    "BMKG source_url must use bmkg.go.id without credentials"
                )
            raise ValueError("source_url must not contain credentials")
        return value

    @model_validator(mode="after")
    def bmkg_source_url_must_use_bmkg_host(self) -> OfficialAlertInput:
        if self.source not in {"bmkg_cap", "bmkg_air_quality"} or self.source_url is None:
            return self
        parsed = urlparse(self.source_url)
        try:
            hostname = (parsed.hostname or "").lower().rstrip(".")
            port = parsed.port
        except ValueError as exc:
            raise ValueError(
                "BMKG source_url must use hostname bmkg.go.id or a subdomain"
            ) from exc
        if (
            parsed.username is not None
            or parsed.password is not None
            or port not in (None, 443)
            or (
                hostname != "bmkg.go.id"
                and not hostname.endswith(".bmkg.go.id")
            )
        ):
            raise ValueError(
                "BMKG source_url must use hostname bmkg.go.id or a subdomain "
                "without credentials on HTTPS port 443"
            )
        return self

    @model_validator(mode="after")
    def coordinates_must_be_set_together(self) -> OfficialAlertInput:
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must both be set or both be null")
        return self

    @field_validator("area_geojson")
    @classmethod
    def area_geojson_must_be_valid_polygon(
        cls, value: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        if value is None:
            return None
        geometry_type = value.get("type")
        coordinates = value.get("coordinates")
        polygons = [coordinates] if geometry_type == "Polygon" else coordinates
        if geometry_type not in {"Polygon", "MultiPolygon"} or not isinstance(polygons, list):
            raise ValueError("area_geojson must be a Polygon or MultiPolygon")
        for polygon in polygons:
            if not isinstance(polygon, list) or not polygon:
                raise ValueError("area_geojson polygon must contain rings")
            for ring in polygon:
                if not isinstance(ring, list) or len(ring) < 4 or ring[0] != ring[-1]:
                    raise ValueError("area_geojson rings must be closed")
                for point in ring:
                    if not isinstance(point, list) or len(point) < 2:
                        raise ValueError(
                            "area_geojson positions must contain longitude and latitude"
                        )
                    longitude, latitude = point[:2]
                    if not isinstance(longitude, (int, float)) or not isinstance(latitude, (int, float)):
                        raise ValueError("area_geojson positions must be numeric")
                    if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
                        raise ValueError("area_geojson position is outside valid bounds")
        return value


__all__ = ["OfficialAlertInput"]
