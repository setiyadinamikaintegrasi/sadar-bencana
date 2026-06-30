from datetime import date, datetime, timezone

from db.scoring_context import build_scoring_context, point_in_geojson
from models.event import EarthquakeEvent

POLYGON = {"type": "Polygon", "coordinates": [[[106, -7], [108, -7], [108, -5], [106, -5], [106, -7]]]}


def _event(latitude=-6.2, longitude=106.8):
    return EarthquakeEvent(
        event_id="bmkg:test", source="bmkg", event_type="earthquake",
        magnitude=6, latitude=latitude, longitude=longitude,
        place="Test", time="2026-06-30T00:00:00Z",
    )


def test_point_polygon_intersection():
    assert point_in_geojson(-6.2, 106.8, POLYGON)
    assert not point_in_geojson(-2, 120, POLYGON)


def test_spatial_context_populates_exposure_vulnerability_and_vintage():
    context = build_scoring_context(_event(), [{
        "event_id": None,
        "values": {"population_exposed": 250000, "vulnerability_index": 0.7},
        "area_geojson": POLYGON,
        "data_vintage": date(2025, 12, 31),
        "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
    }], evidence_confidence=0.9)
    assert context.population_exposed == 250000
    assert context.vulnerability_index == 0.7
    assert context.evidence_confidence == 0.9
    assert context.data_vintage == "2025-12-31"


def test_context_outside_event_is_not_applied():
    context = build_scoring_context(_event(-2, 120), [{
        "event_id": None, "values": {"population_exposed": 999999},
        "area_geojson": POLYGON, "created_at": datetime.now(timezone.utc),
    }])
    assert context.population_exposed is None
