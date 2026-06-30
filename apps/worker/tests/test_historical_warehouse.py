from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from db.official_alerts import payload_checksum
from models.historical import HistoricalDatasetInput, HistoricalEventInput


def test_dataset_requires_attribution_and_versioned_manifest():
    dataset = HistoricalDatasetInput(
        source_name="bnpb",
        dataset_version="dibi-2025-r1",
        attribution="BNPB",
        raw_manifest={"rows": 1200, "published": "2025-12-31"},
    )
    assert dataset.dataset_version == "dibi-2025-r1"
    assert len(payload_checksum(dataset.raw_manifest)) == 64


def test_event_uses_administrative_code_not_free_name_matching():
    event = HistoricalEventInput(
        source_record_id="event-001",
        peril_type="flood",
        occurred_at=datetime(2025, 1, 1, tzinfo=timezone.utc),
        administrative_code="31.71",
        raw_payload={"id": "event-001"},
    )
    assert event.administrative_code == "31.71"


def test_historical_event_rejects_naive_time():
    with pytest.raises(ValidationError, match="timezone"):
        HistoricalEventInput(
            source_record_id="event-001",
            peril_type="flood",
            occurred_at=datetime(2025, 1, 1),
            administrative_code="31.71",
            raw_payload={},
        )
