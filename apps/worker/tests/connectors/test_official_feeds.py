import pytest
from connectors.official_feeds import (
    normalize_bnpb_impact,
    normalize_inarisk_context,
    normalize_inatews,
    normalize_pvmbg,
    validate_official_feed_url,
)


def test_rejects_non_official_or_insecure_feed_urls():
    with pytest.raises(ValueError):
        validate_official_feed_url("inarisk", "https://evil.example/layers")
    with pytest.raises(ValueError):
        validate_official_feed_url("pvmbg", "http://magma.esdm.go.id/api")
    validate_official_feed_url("bnpb", "https://data.bnpb.go.id/api/3/action/package_show")


def test_inatews_final_bulletin_cancels_original_group():
    alert = normalize_inatews({
        "event_group_id": "202606160327",
        "bulletin_number": 5,
        "bulletin_type": "FINAL BULLETIN",
        "sent_at": "2026-06-16T03:40:00Z",
        "headline": "Final bulletin",
    })
    assert alert.source_alert_id == "202606160327"
    assert alert.message_type == "cancel"
    assert alert.status == "cancelled"


def test_pvmbg_preserves_level_and_recommendation_without_magnitude():
    alert = normalize_pvmbg({
        "volcano_id": "semeru",
        "volcano_name": "Semeru",
        "level": 3,
        "revision": 2,
        "published_at": "2026-06-30T01:00:00Z",
        "recommendation": "Tidak beraktivitas dalam radius resmi.",
    })
    assert "Level 3" in alert.headline
    assert alert.description.startswith("Tidak beraktivitas")
    assert "magnitude" not in alert.raw_payload


def test_bnpb_is_impact_confirmation_not_warning():
    impact = normalize_bnpb_impact({
        "report_id": "report-1",
        "observed_at": "2026-06-30T01:00:00Z",
        "deaths": 1,
        "displaced": 20,
    })
    assert impact["verification_status"] == "official"
    assert "message_type" not in impact


def test_inarisk_requires_vintage_and_attribution():
    with pytest.raises(ValueError):
        normalize_inarisk_context({"layer_id": "flood-1", "context_type": "hazard"})
    context = normalize_inarisk_context({
        "layer_id": "flood-1",
        "context_type": "hazard",
        "peril_type": "flood",
        "data_vintage": "2025-12-31",
        "attribution": "InaRISK BNPB",
        "values": {"class": "high"},
    })
    assert context["data_vintage"] == "2025-12-31"
