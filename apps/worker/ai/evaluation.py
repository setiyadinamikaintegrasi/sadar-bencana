"""Release-gate evaluation for grounded regional analysis."""

from __future__ import annotations

from typing import Any


def evaluate_analysis(snapshot: dict[str, Any], output: dict[str, Any]) -> dict[str, Any]:
    expected_sources = {
        str(item["source"])
        for item in snapshot.get("source_coverage", [])
        if item.get("source")
    }
    cited_sources = {
        str(item["source"])
        for item in output.get("citations", [])
        if item.get("source")
    }
    impact = snapshot.get("impact") or snapshot.get("impacts") or {}
    expected_numbers = {
        int(snapshot.get("event_count", 0)),
        int(impact.get("deaths") or 0),
        int(impact.get("displaced") or 0),
    }
    answer = str(output.get("answer") or "")
    numerical_consistency = all(str(number) in answer for number in expected_numbers)
    citation_coverage = expected_sources.issubset(cited_sources)
    return {
        "numerical_consistency": numerical_consistency,
        "citation_coverage": citation_coverage,
        "grounded": numerical_consistency and citation_coverage,
        "expected_sources": sorted(expected_sources),
        "cited_sources": sorted(cited_sources),
    }


__all__ = ["evaluate_analysis"]
