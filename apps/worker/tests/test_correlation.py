from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest

from correlation import (
    correlate_events,
    evidence_confidence,
    source_independence_group,
)
from models.correlation import CorrelationEvent, EvidenceSignal

NOW = datetime(2026, 6, 30, 8, 0, tzinfo=timezone.utc)
LEFT_ID = UUID("123e4567-e89b-42d3-a456-426614174000")
RIGHT_ID = UUID("123e4567-e89b-42d3-a456-426614174001")


def _event(
    event_id: UUID,
    *,
    source: str,
    peril: str = "earthquake",
    latitude: float = -6.2,
    longitude: float = 106.8,
    event_time: datetime = NOW,
    shared_identifier: str | None = None,
) -> CorrelationEvent:
    return CorrelationEvent(
        id=event_id,
        source=source,
        source_event_id=str(event_id),
        peril_type=peril,
        latitude=latitude,
        longitude=longitude,
        event_time=event_time,
        shared_identifier=shared_identifier,
    )


def test_nearby_independent_earthquake_events_merge():
    decision = correlate_events(
        _event(LEFT_ID, source="bmkg"),
        _event(
            RIGHT_ID,
            source="usgs",
            latitude=-6.21,
            event_time=NOW + timedelta(minutes=1),
        ),
    )

    assert decision.decision == "merge"
    assert decision.confidence >= 0.78
    assert "independent_sources" in decision.reasons


def test_ambiguous_distance_enters_review_queue():
    decision = correlate_events(
        _event(LEFT_ID, source="bmkg"),
        _event(
            RIGHT_ID,
            source="usgs",
            latitude=-6.55,
            event_time=NOW + timedelta(minutes=5),
        ),
    )

    assert decision.decision == "review"


def test_different_perils_are_always_distinct():
    decision = correlate_events(
        _event(LEFT_ID, source="bmkg", peril="earthquake"),
        _event(RIGHT_ID, source="bnpb", peril="flood"),
    )

    assert decision.decision == "distinct"
    assert decision.reasons == ["peril_mismatch"]


def test_shared_identifier_overrides_weak_spatiotemporal_match():
    decision = correlate_events(
        _event(LEFT_ID, source="bmkg", shared_identifier="official-42"),
        _event(
            RIGHT_ID,
            source="usgs",
            latitude=-8.0,
            event_time=NOW + timedelta(hours=2),
            shared_identifier="OFFICIAL-42",
        ),
    )

    assert decision.decision == "merge"
    assert decision.identifier_match is True


def test_copied_media_do_not_count_as_independent_sources():
    confidence, independent_count = evidence_confidence(
        [
            EvidenceSignal(source_name="bmkg", confidence=0.8),
            EvidenceSignal(
                source_name="media_a",
                origin_source_name="bmkg",
                confidence=0.7,
            ),
            EvidenceSignal(
                source_name="media_b",
                origin_source_name="bmkg",
                confidence=0.9,
            ),
            EvidenceSignal(source_name="usgs", confidence=0.6),
        ]
    )

    assert independent_count == 2
    assert confidence == 0.96
    assert source_independence_group("BMKG_CAP") == "bmkg"


def test_rejects_self_correlation():
    event = _event(LEFT_ID, source="bmkg")
    with pytest.raises(ValueError, match="itself"):
        correlate_events(event, event)
