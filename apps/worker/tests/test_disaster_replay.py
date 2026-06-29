import json
from datetime import datetime, timezone
from pathlib import Path

from alerts.lifecycle_delivery import lifecycle_action
from alerts.policy import AlertPolicyInput, evaluate_alert_policy
from db.official_alerts import payload_checksum
from models.event import EarthquakeEvent
from replay import ReplayObservation, evaluate_replay
from scoring.risk import RiskScoringContext, calculate_risk_score

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "disaster_replay_cases.json"


def test_replay_metrics_document_false_positive_and_missed_alert_by_peril():
    payload = json.loads(FIXTURE_PATH.read_text())
    metrics = evaluate_replay([ReplayObservation(**row) for row in payload])

    assert metrics["precision"] == 1.0
    assert metrics["recall"] == 0.6667
    assert metrics["notification_latency_p95_ms"] == 32000
    assert metrics["errors_by_peril"]["wildfire"]["false_negative"] == 1


def test_single_media_critical_signal_is_held_for_review():
    decision = evaluate_alert_policy(
        AlertPolicyInput(severity="Critical", source_names=["media_only"])
    )
    assert decision.confidence_class == "unverified_signal"
    assert decision.requires_review is True


def test_identical_payload_replay_has_identical_checksum():
    payload = {"identifier": "BMKG-001", "revision": 2, "status": "active"}
    assert payload_checksum(payload) == payload_checksum(dict(reversed(payload.items())))


def test_all_official_cancellations_map_to_delivery_action():
    assert lifecycle_action("cancel", "cancelled") == "cancellation"


def test_expired_alert_never_maps_to_active_delivery():
    assert lifecycle_action("alert", "expired") == "expiry"


def test_risk_factor_golden_fixture_is_reproducible():
    event = EarthquakeEvent(
        event_id="historical:eq-001",
        source="fixture",
        event_type="earthquake",
        magnitude=6.5,
        latitude=-6.2,
        longitude=106.8,
        place="Golden fixture",
        time=datetime(2024, 1, 1, tzinfo=timezone.utc).isoformat(),
    )
    context = RiskScoringContext(
        depth_km=20,
        population_exposed=250000,
        vulnerability_index=0.7,
        evidence_confidence=0.9,
        freshness=1.0,
    )
    first = calculate_risk_score(event, context)
    second = calculate_risk_score(event, context)
    assert first == second
    assert first[1]["formula_version"] == "risk-v2"
