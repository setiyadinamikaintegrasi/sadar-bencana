"""Deterministic disaster replay evaluation utilities."""

from __future__ import annotations

from dataclasses import dataclass
from math import ceil


@dataclass(frozen=True)
class ReplayObservation:
    case_id: str
    peril_type: str
    expected_alert: bool
    predicted_alert: bool
    notification_latency_ms: int | None = None


def evaluate_replay(observations: list[ReplayObservation]) -> dict[str, object]:
    true_positive = sum(o.expected_alert and o.predicted_alert for o in observations)
    false_positive = sum(not o.expected_alert and o.predicted_alert for o in observations)
    false_negative = sum(o.expected_alert and not o.predicted_alert for o in observations)
    true_negative = sum(not o.expected_alert and not o.predicted_alert for o in observations)
    precision_denominator = true_positive + false_positive
    recall_denominator = true_positive + false_negative
    latencies = sorted(
        o.notification_latency_ms
        for o in observations
        if o.notification_latency_ms is not None and o.predicted_alert
    )

    def percentile(percent: float) -> int | None:
        if not latencies:
            return None
        index = max(0, ceil(percent * len(latencies)) - 1)
        return latencies[index]

    per_peril: dict[str, dict[str, int]] = {}
    for observation in observations:
        bucket = per_peril.setdefault(
            observation.peril_type,
            {"false_positive": 0, "false_negative": 0},
        )
        bucket["false_positive"] += int(
            not observation.expected_alert and observation.predicted_alert
        )
        bucket["false_negative"] += int(
            observation.expected_alert and not observation.predicted_alert
        )

    return {
        "total": len(observations),
        "true_positive": true_positive,
        "false_positive": false_positive,
        "false_negative": false_negative,
        "true_negative": true_negative,
        "precision": round(true_positive / precision_denominator, 4)
        if precision_denominator
        else 1.0,
        "recall": round(true_positive / recall_denominator, 4)
        if recall_denominator
        else 1.0,
        "notification_latency_p50_ms": percentile(0.5),
        "notification_latency_p95_ms": percentile(0.95),
        "errors_by_peril": per_peril,
    }


__all__ = ["ReplayObservation", "evaluate_replay"]
