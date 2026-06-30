"""Validated inputs for the historical disaster warehouse."""

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator


class HistoricalDatasetInput(BaseModel):
    source_name: str = Field(min_length=1, max_length=64)
    dataset_version: str = Field(min_length=1, max_length=128)
    data_vintage: date | None = None
    source_url: str | None = None
    attribution: str = Field(min_length=1)
    license: str | None = None
    raw_manifest: dict[str, Any]


class HistoricalEventInput(BaseModel):
    source_record_id: str = Field(min_length=1, max_length=255)
    peril_type: str = Field(min_length=1, max_length=64)
    occurred_at: datetime
    ended_at: datetime | None = None
    administrative_code: str = Field(min_length=1, max_length=32)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    title: str | None = None
    raw_payload: dict[str, Any]

    @field_validator("occurred_at", "ended_at")
    @classmethod
    def timezone_required(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("historical timestamps require timezone")
        return value


__all__ = ["HistoricalDatasetInput", "HistoricalEventInput"]
