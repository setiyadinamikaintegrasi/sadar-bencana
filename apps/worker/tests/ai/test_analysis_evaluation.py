from ai.evaluation import evaluate_analysis
from ai.regional_analyst import analyze_regional_snapshot

SNAPSHOT = {
    "administrative_code": "31.71",
    "period": {"from": "2020-01-01", "to": "2024-12-31"},
    "event_count": 12,
    "impact": {"deaths": 3, "displaced": 120},
    "source_coverage": [{"source": "BNPB"}, {"source": "BMKG"}],
}


def test_release_gate_has_full_numerical_and_citation_consistency():
    output = analyze_regional_snapshot(SNAPSHOT, "Ringkas risiko historis")
    evaluation = evaluate_analysis(SNAPSHOT, output)
    assert evaluation["numerical_consistency"] is True
    assert evaluation["citation_coverage"] is True
    assert evaluation["grounded"] is True


def test_missing_citation_fails_release_gate():
    output = analyze_regional_snapshot(SNAPSHOT, "Ringkas")
    output["citations"] = [{"source": "BNPB"}]
    assert evaluate_analysis(SNAPSHOT, output)["citation_coverage"] is False


def test_conflicting_or_empty_source_data_stays_explicit():
    empty = {**SNAPSHOT, "event_count": 0, "impact": {}, "source_coverage": []}
    output = analyze_regional_snapshot(empty, "Ringkas")
    assert evaluate_analysis(empty, output)["grounded"] is True
    assert "0 kejadian" in output["answer"]
