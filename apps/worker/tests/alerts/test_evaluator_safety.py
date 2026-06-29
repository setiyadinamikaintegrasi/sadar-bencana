"""Safety policy tests for peril-specific event alerts."""

from alerts.evaluator import (
    _severity_for_event,
    _should_alert_event,
    _verification_status_for_source,
)


def test_event_thresholds_are_peril_specific():
    assert _should_alert_event("earthquake", 5.0)
    assert not _should_alert_event("earthquake", 4.9)
    assert _should_alert_event("flood", 3.0)
    assert not _should_alert_event("flood", 2.9)
    assert _should_alert_event("volcano", 3.0)
    assert _should_alert_event("wildfire", 4.0)


def test_unknown_event_type_does_not_create_alert():
    assert not _should_alert_event("unknown", 10.0)


def test_existing_earthquake_escalation_bands_are_preserved():
    assert _severity_for_event("earthquake", 5.0) == "Moderate"
    assert _severity_for_event("earthquake", 5.5) == "High"
    assert _severity_for_event("earthquake", 6.5) == "Critical"
    assert _severity_for_event("flood", 3.0) == "High"


def test_source_verification_is_conservative():
    assert _verification_status_for_source("BMKG") == "official"
    assert _verification_status_for_source("USGS") == "corroborated"
    assert _verification_status_for_source("petabencana") == "unverified"
