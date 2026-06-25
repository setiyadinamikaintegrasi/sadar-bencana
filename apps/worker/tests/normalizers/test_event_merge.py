import unittest

from models.event import EarthquakeEvent
from normalizers.events import merge_events_by_proximity


def _event(event_id: str, lat: float, lon: float) -> EarthquakeEvent:
    return EarthquakeEvent(
        event_id=event_id,
        source="test",
        event_type="volcano",
        magnitude=2.0,
        latitude=lat,
        longitude=lon,
        place=event_id,
        time="2026-06-11T00:00:00+00:00",
    )


class MergeEventsByProximityTests(unittest.TestCase):
    def test_drops_secondary_event_near_a_primary_event(self) -> None:
        primary = [_event("gvp_dukono", 1.6992, 127.8783)]
        # Same volcano from another source, slightly different coordinates.
        secondary = [_event("gdacs_dukono", 1.69, 127.87)]

        merged = merge_events_by_proximity(primary, secondary)

        self.assertEqual([e.event_id for e in merged], ["gvp_dukono"])

    def test_keeps_secondary_event_far_from_primary(self) -> None:
        primary = [_event("gvp_dukono", 1.6992, 127.8783)]
        secondary = [_event("gdacs_semeru", -8.108, 112.922)]

        merged = merge_events_by_proximity(primary, secondary)

        self.assertEqual([e.event_id for e in merged], ["gvp_dukono", "gdacs_semeru"])

    def test_primary_events_always_retained(self) -> None:
        primary = [_event("a", -7.5, 110.4), _event("b", 1.5, 127.8)]

        merged = merge_events_by_proximity(primary, [])

        self.assertEqual([e.event_id for e in merged], ["a", "b"])
