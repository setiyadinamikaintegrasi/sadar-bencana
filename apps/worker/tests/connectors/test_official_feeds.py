import json
from pathlib import Path

import pytest
from connectors.official_feeds import (
    apply_field_mapping,
    extract_official_records,
    normalize_bnpb_impact,
    normalize_inarisk_context,
    normalize_inatews,
    normalize_pvmbg,
    validate_adapter_record,
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


def test_versioned_adapter_maps_nested_official_contract():
    payload = {
        "response": {
            "records": [{
                "id": "report-42",
                "times": {"observed": "2026-06-30T01:00:00Z"},
            }],
        },
    }
    mapping = {
        "__records": "response.records",
        "report_id": "id",
        "observed_at": "times.observed",
    }
    records = extract_official_records(payload, mapping)
    assert records[0]["report_id"] == "report-42"
    validate_adapter_record("bnpb", "v1", records[0])


def test_contract_rejects_unknown_version_and_missing_fields():
    with pytest.raises(ValueError, match="unsupported adapter"):
        validate_adapter_record("bnpb", "v999", {})
    with pytest.raises(ValueError, match="observed_at"):
        validate_adapter_record("bnpb", "v1", {"report_id": "report-1"})


def test_mapping_does_not_mutate_raw_record():
    raw = {"source": {"identifier": "x"}}
    mapped = apply_field_mapping(raw, {"report_id": "source.identifier"})
    assert mapped["report_id"] == "x"
    assert "report_id" not in raw


def test_provisional_contract_fixture_matches_all_v1_adapters():
    fixture = json.loads(
        (Path(__file__).parents[1] / "fixtures" / "official_sources" / "provisional-v1.json").read_text()
    )
    assert fixture["provenance"].startswith("synthetic-provisional")
    for source in ("inatews", "pvmbg", "bnpb", "inarisk"):
        validate_adapter_record(source, "v1", fixture[source])
