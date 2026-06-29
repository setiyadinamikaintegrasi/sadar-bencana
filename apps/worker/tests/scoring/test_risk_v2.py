from models.event import EarthquakeEvent
from scoring.risk import RISK_FORMULA_VERSION, RiskScoringContext, calculate_risk_score


def _event(peril: str, magnitude: float) -> EarthquakeEvent:
    return EarthquakeEvent(
        event_id=f"fixture:{peril}",
        source="fixture",
        event_type=peril,
        magnitude=magnitude,
        latitude=-6.2,
        longitude=106.8,
        place="Historical fixture",
        time="2026-06-30T08:00:00+00:00",
    )


def test_earthquake_score_records_all_explainable_components():
    score, factors = calculate_risk_score(
        _event("earthquake", 6.5),
        RiskScoringContext(
            depth_km=20,
            mmi=7,
            population_exposed=250_000,
            vulnerability_index=0.7,
            evidence_confidence=0.9,
            freshness=1.0,
            data_vintage="2025",
        ),
    )

    assert 0 <= score <= 100
    assert factors["formula_version"] == RISK_FORMULA_VERSION
    assert set(factors["components"]) == {
        "hazard_intensity",
        "exposure",
        "vulnerability",
        "confidence",
        "freshness",
    }
    assert factors["input_snapshot"]["depth_km"] == 20.0


def test_missing_exposure_uses_zero_not_invented_population():
    score, factors = calculate_risk_score(_event("flood", 3.0))

    assert factors["components"]["exposure"] == 0.0
    assert factors["fallbacks"]["exposure_unavailable"] is True
    assert score < factors["base_score"]


def test_peril_intensity_is_normalized_to_common_zero_one_boundary():
    for peril, maximum in [
        ("earthquake", 8.0),
        ("flood", 4.0),
        ("volcano", 4.0),
        ("wildfire", 10.0),
    ]:
        _, factors = calculate_risk_score(_event(peril, maximum))
        assert factors["components"]["hazard_intensity"] == 1.0


def test_depth_reduces_earthquake_hazard_when_other_inputs_equal():
    shallow, _ = calculate_risk_score(
        _event("earthquake", 6.0),
        RiskScoringContext(depth_km=10),
    )
    deep, _ = calculate_risk_score(
        _event("earthquake", 6.0),
        RiskScoringContext(depth_km=600),
    )

    assert shallow > deep
