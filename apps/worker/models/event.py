"""Canonical event models for the worker service."""

from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field


class EarthquakeEvent(BaseModel):
    """Canonical earthquake event payload used across connectors."""

    event_id: str = Field(description="Unique event identifier in canonical namespaced form.")
    source: str = Field(default="usgs", description="Upstream source system for the event.")
    event_type: str = Field(default="earthquake", description="Canonical event type label.")
    magnitude: float = Field(default=0.0, description="Reported earthquake magnitude.")
    latitude: float = Field(description="Epicenter latitude in decimal degrees.")
    longitude: float = Field(description="Epicenter longitude in decimal degrees.")
    place: str = Field(default="", description="Human-readable event location summary.")
    time: str = Field(description="Event occurrence time as an ISO 8601 datetime string.")
    url: str = Field(default="", description="Source URL for the upstream event record.")
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="Record creation time as an ISO 8601 datetime string.",
    )
