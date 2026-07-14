from datetime import datetime, timezone

import pytest

from models.official_alert import OfficialAlertInput


def base_alert(**overrides):
    values = {
        "source": "bmkg_cap",
        "source_alert_id": "alert-1",
        "sent_at": datetime(2026, 7, 15, tzinfo=timezone.utc),
        "peril_type": "weather",
        "severity": "High",
        "area_name": "Jawa Barat",
        "source_url": "https://www.bmkg.go.id/alerts/alert-1",
        "raw_payload": {"id": "alert-1"},
    }
    values.update(overrides)
    return OfficialAlertInput(**values)


def test_official_alert_accepts_structured_metadata():
    alert = base_alert(latitude=-6.9, longitude=107.6)

    assert alert.peril_type == "weather"
    assert alert.severity == "High"
    assert alert.latitude == -6.9


def test_official_alert_rejects_invalid_coordinates():
    with pytest.raises(ValueError):
        base_alert(latitude=-91)


def test_official_alert_rejects_malformed_geojson():
    with pytest.raises(ValueError):
        base_alert(area_geojson={"type": "Polygon", "coordinates": [[[107.0, -6.0]]]})
