"""Tests for EWS geo-matching."""

import unittest

from alerts.geo import find_matching_subscriber_ids, haversine_km, zone_matches


class HaversineTests(unittest.TestCase):
    def test_same_point(self) -> None:
        self.assertAlmostEqual(
            haversine_km(-6.2, 106.8, -6.2, 106.8), 0.0, delta=0.1
        )

    def test_jakarta_to_bandung(self) -> None:
        # Great-circle (straight-line) distance ~115 km; road distance is
        # longer (~150 km) but haversine measures the geodesic.
        d = haversine_km(-6.21, 106.85, -6.92, 107.61)
        self.assertTrue(100 < d < 130, f"expected ~115km, got {d:.1f}")

    def test_jakarta_to_tokyo(self) -> None:
        d = haversine_km(-6.21, 106.85, 35.68, 139.69)
        self.assertTrue(5500 < d < 6500, f"expected ~5800km, got {d:.1f}")


class ZoneMatchTests(unittest.TestCase):
    def _base_zone(self) -> dict:
        return {
            "subscriber_id": "sub-1",
            "latitude": -6.21,
            "longitude": 106.85,
            "radius_km": 100,
            "peril_types": [],
            "min_magnitude": 5.0,
        }

    def test_match_inside_radius(self) -> None:
        self.assertTrue(
            zone_matches(self._base_zone(), -6.3, 106.9, "earthquake", 5.5)
        )

    def test_no_match_outside_radius(self) -> None:
        self.assertFalse(
            zone_matches(self._base_zone(), -7.5, 110.0, "earthquake", 5.5)
        )

    def test_no_match_low_magnitude(self) -> None:
        self.assertFalse(
            zone_matches(self._base_zone(), -6.3, 106.9, "earthquake", 4.0)
        )

    def test_no_match_wrong_peril(self) -> None:
        zone = self._base_zone()
        zone["peril_types"] = ["flood"]
        self.assertFalse(zone_matches(zone, -6.3, 106.9, "earthquake", 5.5))

    def test_match_empty_peril_list(self) -> None:
        self.assertTrue(
            zone_matches(self._base_zone(), -6.3, 106.9, "volcano", 5.5)
        )


class FindMatchingSubscribersTests(unittest.TestCase):
    def test_multiple_zones(self) -> None:
        zones = [
            {"subscriber_id": "s1", "latitude": -6.2, "longitude": 106.8,
             "radius_km": 50, "peril_types": [], "min_magnitude": 5.0},
            {"subscriber_id": "s2", "latitude": 35.6, "longitude": 139.6,
             "radius_km": 50, "peril_types": [], "min_magnitude": 5.0},
        ]
        matched = find_matching_subscriber_ids(
            zones, -6.3, 106.9, "earthquake", 5.5
        )
        self.assertIn("s1", matched)
        self.assertNotIn("s2", matched)


if __name__ == "__main__":
    unittest.main()
