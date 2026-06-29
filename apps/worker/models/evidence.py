"""Canonical models for source provenance, evidence, impacts, and risk context."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class SourceRecordInput(BaseModel):
    source_name: str = Field(min_length=1, max_length=64)
    source_record_id: str = Field(min_length=1, max_length=255)
    source_type: Literal["official", "sensor", "institutional", "media", "citizen"]
    origin_source_name: str | None = Field(default=None, max_length=64)
    source_url: str | None = None
    attribution: str | None = None
    observed_at: datetime | None = None
    published_at: datetime | None = None
    raw_payload: dict[str, Any]

    @field_validator("source_name", "source_record_id", "origin_source_name")
    @classmethod
    def normalize_identifiers(cls, value: str | None, info) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("source identifiers must not be blank")
        if info.field_name in {"source_name", "origin_source_name"}:
            return normalized.lower()
        return normalized

    @field_validator("observed_at", "published_at")
    @classmethod
    def timestamps_require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("source timestamps must include a timezone")
        return value


class EventEvidenceInput(BaseModel):
    event_id: UUID | None = None
    source_record_id: UUID
    peril_type: str | None = None
    relation_type: Literal["supports", "contradicts", "updates"] = "supports"
    confidence: float = Field(default=0.5, ge=0, le=1)
    freshness_expires_at: datetime | None = None

    @field_validator("freshness_expires_at")
    @classmethod
    def freshness_requires_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("freshness timestamp must include a timezone")
        return value


class ImpactReportInput(BaseModel):
    impact_key: str = Field(min_length=1, max_length=255)
    event_id: UUID | None = None
    source_record_id: UUID
    location_name: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    observed_at: datetime
    deaths: int | None = Field(default=None, ge=0)
    missing: int | None = Field(default=None, ge=0)
    injured: int | None = Field(default=None, ge=0)
    displaced: int | None = Field(default=None, ge=0)
    houses_damaged: int | None = Field(default=None, ge=0)
    damage_amount: Decimal | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, max_length=8)
    verification_status: Literal["unverified", "corroborated", "official"] = "unverified"

    @field_validator("observed_at")
    @classmethod
    def observed_at_requires_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("impact observed_at must include a timezone")
        return value


class RiskContextInput(BaseModel):
    context_key: str = Field(min_length=1, max_length=255)
    context_type: Literal["hazard", "exposure", "vulnerability", "capacity"]
    peril_type: str | None = None
    event_id: UUID | None = None
    source_record_id: UUID
    administrative_code: str | None = Field(default=None, max_length=32)
    data_vintage: date | None = None
    values: dict[str, Any]
    area_geojson: dict[str, Any] | None = None


__all__ = [
    "EventEvidenceInput",
    "ImpactReportInput",
    "RiskContextInput",
    "SourceRecordInput",
]
