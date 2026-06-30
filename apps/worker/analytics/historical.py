"""Backend-only historical trend, seasonality, impact-rate, and anomaly math."""

from __future__ import annotations

import statistics
from collections import Counter
from typing import Any


def build_historical_snapshot(
    rows: list[dict[str, Any]],
    *,
    administrative_code: str,
    period_from: str,
    period_to: str,
    population_denominator: int | None = None,
) -> dict[str, Any]:
    yearly = Counter(int(row["year"]) for row in rows)
    monthly = Counter(int(row["month"]) for row in rows)
    perils = Counter(str(row["peril_type"]) for row in rows)
    deaths = sum(int(row.get("deaths") or 0) for row in rows)
    displaced = sum(int(row.get("displaced") or 0) for row in rows)
    values = list(yearly.values())
    mean = statistics.fmean(values) if values else 0.0
    deviation = statistics.pstdev(values) if len(values) >= 2 else 0.0
    anomalies = [
        {"year": year, "event_count": count, "method": "mean_plus_2_population_stddev"}
        for year, count in sorted(yearly.items())
        if len(values) >= 3 and deviation > 0 and count > mean + 2 * deviation
    ]
    impact_rates = None
    if population_denominator and population_denominator > 0:
        impact_rates = {
            "deaths_per_100k": round(deaths / population_denominator * 100_000, 4),
            "displaced_per_100k": round(displaced / population_denominator * 100_000, 4),
            "denominator": population_denominator,
        }
    return {
        "administrative_code": administrative_code,
        "period": {"from": period_from, "to": period_to},
        "event_count": len(rows),
        "yearly_trend": [{"year": year, "event_count": count} for year, count in sorted(yearly.items())],
        "seasonality": [{"month": month, "event_count": count} for month, count in sorted(monthly.items())],
        "peril_composition": dict(sorted(perils.items())),
        "impacts": {"deaths": deaths, "displaced": displaced},
        "impact_rates": impact_rates,
        "anomalies": anomalies,
        "method": "historical-analytics-v1",
        "missing_data": {
            "population_denominator": population_denominator is None,
            "empty_dataset": not rows,
        },
        "confidence": "low" if not rows else "medium" if len(rows) < 30 else "high",
    }


__all__ = ["build_historical_snapshot"]
