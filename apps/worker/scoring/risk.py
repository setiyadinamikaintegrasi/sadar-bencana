"""Baseline risk scoring for earthquake events.

This module implements the v0 severity classification and a deterministic
0-100 risk score derived from event magnitude (and depth, when available).
It is intentionally side-effect free so it can be unit-tested in isolation
and reused by both the on-demand ingest endpoint and the background
scheduler.

Severity bands (USGS-aligned, simplified for risk triage):

    magnitude >= 6.0  -> "Critical"
    magnitude >= 5.0  -> "High"
    magnitude >= 4.0  -> "Moderate"
    magnitude >= 3.0  -> "Low"
    magnitude <  3.0  -> "Minor"

Score formula (baseline):

    base = magnitude * 10
    score = clamp(base + depth_adjustment, 0, 100)

Depth adjustment is only applied when the event carries a ``depth``
attribute (the current :class:`~models.event.EarthquakeEvent` does not,
but the scorer is forward-compatible): shallow events (<70 km) gain a
small bump because they are typically more destructive at the surface,
while deep events (>300 km) are damped.
"""

from __future__ import annotations

import logging
from typing import Any

import asyncpg

from models.event import EarthquakeEvent

logger = logging.getLogger(__name__)


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

# Multiplier that scales magnitude (0-10ish for notable quakes) onto the
# 0-100 score range. A magnitude 7.0 event lands at a base of 70.
_MAGNITUDE_WEIGHT = 10.0

# Depth adjustment buckets (in kilometers). Shallow quakes transfer more
# energy to the surface; deep quakes dissipate it before reaching it.
_SHALLOW_DEPTH_KM = 70.0
_DEEP_DEPTH_KM = 300.0
_SHALLOW_BONUS = 5.0
_DEEP_PENALTY = -5.0


def _depth_adjustment(depth: float | None) -> float:
    """Return the score delta for a hypocentral depth, if known."""

    if depth is None:
        return 0.0
    if depth <= 0:
        # Negative/zero depth is unusual; treat as unknown rather than
        # granting a max bonus.
        return 0.0
    if depth < _SHALLOW_DEPTH_KM:
        return _SHALLOW_BONUS
    if depth > _DEEP_DEPTH_KM:
        return _DEEP_PENALTY
    return 0.0


def _estimate_impact(severity: str) -> str:
    """Qualitative impact label used for downstream triage display."""

    return {
        "Critical": "catastrophic",
        "High": "major",
        "Moderate": "moderate",
        "Low": "minor",
        "Minor": "negligible",
    }.get(severity, "negligible")


def calculate_risk_score(event: EarthquakeEvent) -> tuple[float, dict[str, Any]]:
    """Compute a baseline risk score and its explanatory factors.

    Args:
        event: The canonical earthquake event to score.

    Returns:
        A ``(score, factors)`` tuple where ``score`` is a float in
        ``[0.0, 100.0]`` and ``factors`` is a JSON-serializable dict
        documenting the inputs that produced the score (magnitude,
        severity, estimated_impact, and depth/depth_adjustment when
        depth is available).
    """

    magnitude = float(event.magnitude)
    severity = classify_severity_by_type(magnitude, event.event_type)

    base = magnitude * _MAGNITUDE_WEIGHT

    # ``EarthquakeEvent`` does not currently model depth, but the scorer
    # stays correct if/when it is added. We read defensively via getattr.
    depth: float | None = getattr(event, "depth", None)
    depth_adj = _depth_adjustment(depth)

    raw = base + depth_adj
    score = max(0.0, min(100.0, raw))

    factors: dict[str, Any] = {
        "magnitude": magnitude,
        "severity": severity,
        "estimated_impact": _estimate_impact(severity),
        "base_score": base,
    }
    if depth is not None:
        factors["depth_km"] = depth
        factors["depth_adjustment"] = depth_adj

    return score, factors


# --- Batch scoring + persistence ------------------------------------------

async def score_events(
    pool: asyncpg.Pool, events: list[EarthquakeEvent]
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
    for event in events:
        score, factors = calculate_risk_score(event)
        await upsert_risk_score(pool, event.event_id, score, factors)
        scored += 1

    logger.info("Scored %d/%d events", scored, len(events))
    return scored
