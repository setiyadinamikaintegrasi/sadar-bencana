"""Canonical input model for an authoritative alert revision."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


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


__all__ = ["OfficialAlertInput"]
