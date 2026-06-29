import pytest
from pydantic import ValidationError

from alerts.policy import AlertPolicyInput, evaluate_alert_policy


def test_high_severity_does_not_imply_high_confidence():
    decision = evaluate_alert_policy(
        AlertPolicyInput(severity="Critical", source_names=["social_report"])
    )
    assert decision.confidence_class == "unverified_signal"
    assert decision.verification_status == "unverified"


def test_copied_bmkg_sources_count_once():
    decision = evaluate_alert_policy(
        AlertPolicyInput(
            severity="High",
            source_names=["bmkg", "bmkg_cap", "inatews"],
        )
    )
    assert decision.independent_source_count == 1
    assert decision.confidence_class == "unverified_signal"


def test_two_independent_sources_are_corroborated():
    decision = evaluate_alert_policy(
        AlertPolicyInput(severity="Moderate", source_names=["bmkg", "usgs"])
    )
    assert decision.confidence_class == "corroborated_signal"


def test_official_warning_preserves_source_wording_even_when_stale():
    decision = evaluate_alert_policy(
        AlertPolicyInput(
            severity="High",
            source_names=["bmkg_cap"],
            official_warning=True,
            freshness=0,
        )
    )
    assert decision.confidence_class == "official_warning"
    assert decision.preserve_source_wording is True
    assert decision.lifecycle_action == "review"


def test_escalation_and_deescalation_are_severity_only():
    escalated = evaluate_alert_policy(
        AlertPolicyInput(
            severity="Critical",
            previous_severity="Moderate",
            source_names=["unknown"],
        )
    )
    deescalated = evaluate_alert_policy(
        AlertPolicyInput(
            severity="Low",
            previous_severity="High",
            source_names=["unknown"],
        )
    )
    assert escalated.lifecycle_action == "escalate"
    assert deescalated.lifecycle_action == "deescalate"
    assert escalated.confidence_class == deescalated.confidence_class


def test_manual_override_requires_actor_and_reason():
    with pytest.raises(ValidationError, match="actor"):
        AlertPolicyInput(
            severity="High",
            manual_confidence_class="confirmed_event",
        )


def test_manual_override_is_explicit_in_decision():
    decision = evaluate_alert_policy(
        AlertPolicyInput(
            severity="High",
            source_names=["unknown"],
            manual_confidence_class="confirmed_event",
            manual_override_by="analyst@example.test",
            manual_override_reason="verified by operations centre",
        )
    )
    assert decision.manual_override is True
    assert "audited_manual_override" in decision.reasons
