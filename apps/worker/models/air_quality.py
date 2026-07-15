"""Validated input for one BMKG PM2.5 observation."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator, model_validator


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
        host = (parsed.hostname or "").lower().rstrip(".")
        if parsed.scheme != "https" or not (
            host == "bmkg.go.id" or host.endswith(".bmkg.go.id")
        ):
            raise ValueError("source_url must use an official BMKG HTTPS host")
        return value

    @model_validator(mode="after")
    def coordinates_must_be_set_together(self) -> AirQualityObservationInput:
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must both be set or both be null")
        return self


__all__ = ["AirQualityObservationInput"]
