"""Deterministic event correlation and independent-source confidence rules."""

from __future__ import annotations

import math
from dataclasses import dataclass

from models.correlation import CorrelationDecision, CorrelationEvent, EvidenceSignal

CORRELATION_RULE_VERSION = "correlation-v1"


@dataclass(frozen=True)
class PerilWindow:
    distance_km: float
    time_seconds: float


PERIL_WINDOWS = {
    "earthquake": PerilWindow(100.0, 15 * 60),
    "flood": PerilWindow(30.0, 24 * 60 * 60),
    "volcano": PerilWindow(10.0, 7 * 24 * 60 * 60),
    "wildfire": PerilWindow(10.0, 12 * 60 * 60),
}
DEFAULT_WINDOW = PerilWindow(25.0, 6 * 60 * 60)

SOURCE_GROUPS = {
    "bmkg": "bmkg",
    "bmkg_cap": "bmkg",
    "inatews": "bmkg",
    "usgs": "usgs",
    "bnpb": "bnpb",
    "pvmbg": "pvmbg",
    "gdacs_fl": "gdacs",
    "gdacs_vo": "gdacs",
    "gvp": "smithsonian_gvp",
    "nasa_firms": "nasa_firms",
    "petabencana": "petabencana",
}


def source_independence_group(source_name: str) -> str:
    normalized = source_name.strip().lower()
    return SOURCE_GROUPS.get(normalized, normalized)


def evidence_confidence(signals: list[EvidenceSignal]) -> tuple[float, int]:
    """Combine the strongest evidence per independent upstream source.

    Media or citizen records can declare ``origin_source_name``. Records that
    repeat the same upstream statement then contribute only once.
    """
    strongest_by_group: dict[str, float] = {}
    for signal in signals:
        origin = signal.origin_source_name or signal.source_name
        group = source_independence_group(origin)
        strongest_by_group[group] = max(
            strongest_by_group.get(group, 0.0),
            signal.confidence,
        )
    residual = 1.0
    for confidence in strongest_by_group.values():
        residual *= 1.0 - confidence
    return round(1.0 - residual, 3), len(strongest_by_group)


def _haversine_km(left: CorrelationEvent, right: CorrelationEvent) -> float:
    radius_km = 6371.0088
    lat1, lat2 = math.radians(left.latitude), math.radians(right.latitude)
    delta_lat = lat2 - lat1
    delta_lon = math.radians(right.longitude - left.longitude)
    haversine = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    )
    return radius_km * 2 * math.asin(math.sqrt(haversine))


def correlate_events(
    left: CorrelationEvent,
    right: CorrelationEvent,
) -> CorrelationDecision:
    if left.id == right.id:
        raise ValueError("cannot correlate an event with itself")

    first, second = sorted((left, right), key=lambda event: str(event.id))
    if first.peril_type != second.peril_type:
        return CorrelationDecision(
            left_event_id=first.id,
            right_event_id=second.id,
            peril_type=first.peril_type,
            distance_km=None,
            time_delta_seconds=None,
            identifier_match=False,
            confidence=0.0,
            decision="distinct",
            reasons=["peril_mismatch"],
            rule_version=CORRELATION_RULE_VERSION,
        )

    distance = _haversine_km(first, second)
    time_delta = abs((first.event_time - second.event_time).total_seconds())
    identifier_match = bool(
        first.shared_identifier
        and second.shared_identifier
        and first.shared_identifier.strip().lower()
        == second.shared_identifier.strip().lower()
    )
    same_group = (
        source_independence_group(first.source)
        == source_independence_group(second.source)
    )

    window = PERIL_WINDOWS.get(first.peril_type, DEFAULT_WINDOW)
    spatial_score = max(0.0, 1.0 - distance / window.distance_km)
    temporal_score = max(0.0, 1.0 - time_delta / window.time_seconds)
    confidence = 0.58 * spatial_score + 0.37 * temporal_score
    reasons = ["same_peril"]
    if identifier_match:
        confidence = max(confidence, 0.99)
        reasons.append("shared_source_identifier")
    if same_group:
        confidence = max(0.0, confidence - 0.08)
        reasons.append("same_independence_group")
    else:
        confidence += 0.05
        reasons.append("independent_sources")
    confidence = round(min(confidence, 1.0), 3)

    if confidence >= 0.78:
        decision = "merge"
    elif confidence >= 0.5:
        decision = "review"
    else:
        decision = "distinct"

    return CorrelationDecision(
        left_event_id=first.id,
        right_event_id=second.id,
        peril_type=first.peril_type,
        distance_km=round(distance, 3),
        time_delta_seconds=round(time_delta, 3),
        identifier_match=identifier_match,
        confidence=confidence,
        decision=decision,
        reasons=reasons,
        rule_version=CORRELATION_RULE_VERSION,
    )


__all__ = [
    "CORRELATION_RULE_VERSION",
    "PERIL_WINDOWS",
    "correlate_events",
    "evidence_confidence",
    "source_independence_group",
]
