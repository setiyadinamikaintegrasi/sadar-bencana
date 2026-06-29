"""Canonical models for event correlation and source independence."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class CorrelationEvent(BaseModel):
    id: UUID
    source: str = Field(min_length=1, max_length=64)
    source_event_id: str = Field(min_length=1, max_length=255)
    peril_type: str = Field(min_length=1, max_length=64)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    event_time: datetime
    shared_identifier: str | None = None

    @field_validator("event_time")
    @classmethod
    def time_requires_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("correlation event_time must include a timezone")
        return value


class CorrelationDecision(BaseModel):
    left_event_id: UUID
    right_event_id: UUID
    peril_type: str
    distance_km: float | None
    time_delta_seconds: float | None
    identifier_match: bool
    confidence: float = Field(ge=0, le=1)
    decision: Literal["merge", "review", "distinct"]
    reasons: list[str]
    rule_version: str


class EvidenceSignal(BaseModel):
    source_name: str = Field(min_length=1, max_length=64)
    confidence: float = Field(ge=0, le=1)
    origin_source_name: str | None = Field(default=None, max_length=64)


__all__ = ["CorrelationDecision", "CorrelationEvent", "EvidenceSignal"]
