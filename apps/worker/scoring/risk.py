"""Deterministic, explainable, exposure-aware risk scoring by peril."""

from __future__ import annotations

import logging
import math
from typing import Any

import asyncpg
from pydantic import BaseModel, Field

from models.event import EarthquakeEvent

logger = logging.getLogger(__name__)
RISK_FORMULA_VERSION = "risk-v2"


class RiskScoringContext(BaseModel):
    """Optional enrichment inputs; missing values use explicit safe fallbacks."""

    depth_km: float | None = Field(default=None, ge=0)
    mmi: float | None = Field(default=None, ge=0, le=12)
    pga_g: float | None = Field(default=None, ge=0)
    population_exposed: int | None = Field(default=None, ge=0)
    vulnerability_index: float | None = Field(default=None, ge=0, le=1)
    evidence_confidence: float | None = Field(default=None, ge=0, le=1)
    freshness: float | None = Field(default=None, ge=0, le=1)
    data_vintage: str | None = None


# --- Severity classification ----------------------------------------------

def classify_severity(magnitude: float) -> str:
    """Map an earthquake magnitude to a coarse severity label.

    The thresholds are evaluated high-to-low so each band is a half-open
    range anchored on its lower bound.
    """

    if magnitude >= 6.0:
        return "Critical"
    if magnitude >= 5.0:
        return "High"
    if magnitude >= 4.0:
        return "Moderate"
    if magnitude >= 3.0:
        return "Low"
    return "Minor"


def classify_severity_by_type(magnitude: float, event_type: str = "earthquake") -> str:
    """Map a magnitude proxy to severity, dispatching by event type.

    Non-earthquake perils use their own threshold bands since their magnitude
    is a proxy (flood 1-4, volcano 1-4, wildfire 0-10), not a seismic scale.
    """

    if event_type == "earthquake":
        return classify_severity(magnitude)

    if event_type == "flood":
        if magnitude >= 4.0:
            return "Critical"
        if magnitude >= 3.0:
            return "High"
        if magnitude >= 2.0:
            return "Moderate"
        return "Low"

    if event_type == "volcano":
        if magnitude >= 4.0:
            return "Critical"
        if magnitude >= 3.0:
            return "High"
        if magnitude >= 2.0:
            return "Moderate"
        return "Low"

    if event_type == "wildfire":
        if magnitude >= 7.0:
            return "Critical"
        if magnitude >= 4.0:
            return "High"
        if magnitude >= 2.0:
            return "Moderate"
        if magnitude >= 1.0:
            return "Low"
        return "Minor"

    # Unknown event_type — fall back to earthquake thresholds.
    return classify_severity(magnitude)


# --- Risk score ------------------------------------------------------------

def _estimate_impact(severity: str) -> str:
    """Qualitative impact label used for downstream triage display."""

    return {
        "Critical": "catastrophic",
        "High": "major",
        "Moderate": "moderate",
        "Low": "minor",
        "Minor": "negligible",
    }.get(severity, "negligible")


def _hazard_intensity(event: EarthquakeEvent, context: RiskScoringContext) -> float:
    magnitude = max(0.0, float(event.magnitude))
    if event.event_type == "earthquake":
        magnitude_component = min(1.0, max(0.0, (magnitude - 3.0) / 5.0))
        depth = context.depth_km
        depth_factor = 1.0 if depth is None else max(0.35, 1.0 - depth / 700.0)
        seismic = magnitude_component * depth_factor
        if context.mmi is not None:
            seismic = max(seismic, context.mmi / 12.0)
        if context.pga_g is not None:
            seismic = max(seismic, min(1.0, context.pga_g / 1.5))
        return seismic
    normalizers = {"flood": 4.0, "volcano": 4.0, "wildfire": 10.0}
    return min(1.0, magnitude / normalizers.get(event.event_type, 10.0))


def calculate_risk_score(
    event: EarthquakeEvent,
    context: RiskScoringContext | None = None,
) -> tuple[float, dict[str, Any]]:
    """Compute the v2 normalized risk score and explanatory factors.

    Args:
        event: The canonical disaster event to score.

    Returns:
        A ``(score, factors)`` tuple where ``score`` is a float in
        ``[0.0, 100.0]`` and ``factors`` is a JSON-serializable dict
        documenting every normalized component, weight, input, and fallback.
    """

    context = context or RiskScoringContext()
    magnitude = float(event.magnitude)
    severity = classify_severity_by_type(magnitude, event.event_type)
    hazard = _hazard_intensity(event, context)
    exposure = (
        min(1.0, math.log1p(context.population_exposed) / math.log1p(1_000_000))
        if context.population_exposed is not None
        else 0.0
    )
    vulnerability = context.vulnerability_index or 0.0
    confidence = context.evidence_confidence if context.evidence_confidence is not None else 0.5
    freshness = context.freshness if context.freshness is not None else 0.5
    components = {
        "hazard_intensity": round(hazard, 4),
        "exposure": round(exposure, 4),
        "vulnerability": round(vulnerability, 4),
        "confidence": round(confidence, 4),
        "freshness": round(freshness, 4),
    }
    weights = {
        "hazard_intensity": 0.55,
        "exposure": 0.20,
        "vulnerability": 0.15,
        "confidence": 0.05,
        "freshness": 0.05,
    }
    score = round(
        100.0 * sum(components[name] * weight for name, weight in weights.items()),
        2,
    )

    factors: dict[str, Any] = {
        "formula_version": RISK_FORMULA_VERSION,
        "peril_type": event.event_type,
        "magnitude": magnitude,
        "severity": severity,
        "estimated_impact": _estimate_impact(severity),
        "base_score": round(hazard * 100.0, 2),
        "components": components,
        "weights": weights,
        "input_snapshot": context.model_dump(mode="json"),
        "fallbacks": {
            "exposure_unavailable": context.population_exposed is None,
            "vulnerability_unavailable": context.vulnerability_index is None,
            "confidence_defaulted": context.evidence_confidence is None,
            "freshness_defaulted": context.freshness is None,
        },
    }

    return score, factors


# --- Batch scoring + persistence ------------------------------------------

async def score_events(
    pool: asyncpg.Pool,
    events: list[EarthquakeEvent],
    contexts: dict[str, RiskScoringContext] | None = None,
) -> int:
    """Compute and persist risk scores for a batch of events.

    Each event's score is written (upserted) into the ``risk_scores``
    table keyed by its canonical ``event_id``. Idempotent across
    re-ingestions: re-scoring the same event simply refreshes its row.

    Returns the number of events scored (and written).
    """

    if not events:
        return 0

    # Imported lazily to avoid a circular import (risk_scores imports
    # nothing from this module, but keeping the dep local makes the
    # contract explicit and the module easier to test in isolation).
    from db.risk_scores import upsert_risk_score

    scored = 0
    contexts = contexts or {}
    for event in events:
        score, factors = calculate_risk_score(event, contexts.get(event.event_id))
        await upsert_risk_score(pool, event.event_id, score, factors)
        scored += 1

    logger.info("Scored %d/%d events", scored, len(events))
    return scored
