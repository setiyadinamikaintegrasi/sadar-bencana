"""Tests for historical warehouse backfill runner (Fase 3B 2/2)."""

import json

import pytest

from historical_backfill_runner import (
    GDACS_PERIL_MAP,
    ProvinceIndex,
    _polygon_contains,
    _ring_contains,
    payload_checksum,
)


SQUARE = {"type": "Polygon", "coordinates": [[[110.0, -6.0], [112.0, -6.0], [112.0, -4.0], [110.0, -4.0], [110.0, -6.0]]]}


class TestRingContains:
    def test_inside(self):
        ring = SQUARE["coordinates"][0]
        assert _ring_contains(ring, 111.0, -5.0) is True

    def test_outside(self):
        ring = SQUARE["coordinates"][0]
        assert _ring_contains(ring, 115.0, -5.0) is False


class TestPolygonContains:
    def test_polygon_inside(self):
        assert _polygon_contains(SQUARE, 111.0, -5.0) is True

    def test_polygon_outside(self):
        assert _polygon_contains(SQUARE, 109.0, -7.0) is False

    def test_multipolygon(self):
        multi = {"type": "MultiPolygon", "coordinates": [
            [[[95.0, 4.0], [97.0, 4.0], [97.0, 6.0], [95.0, 6.0], [95.0, 4.0]]],
            SQUARE["coordinates"],
        ]}
        assert _polygon_contains(multi, 96.0, 5.0) is True
        assert _polygon_contains(multi, 111.0, -5.0) is True
        assert _polygon_contains(multi, 120.0, -8.0) is False


class TestProvinceIndex:
    def test_lookup_hits(self):
        rows = [("62", "Kalimantan Tengah", SQUARE, 110.0, -6.0, 112.0, -4.0)]
        idx = ProvinceIndex(rows)
        assert idx.lookup(111.0, -5.0) == "62"

    def test_lookup_bbox_reject(self):
        # Titik jauh — ditolak bbox tanpa perlu PIP.
        rows = [("62", "Kalimantan Tengah", SQUARE, 110.0, -6.0, 112.0, -4.0)]
        idx = ProvinceIndex(rows)
        assert idx.lookup(130.0, -3.0) is None

    def test_lookup_geometry_as_string(self):
        rows = [("62", "Kalteng", json.dumps(SQUARE), 110.0, -6.0, 112.0, -4.0)]
        idx = ProvinceIndex(rows)
        assert idx.lookup(111.0, -5.0) == "62"


class TestGdacsPerilMap:
    def test_mapping(self):
        assert GDACS_PERIL_MAP["VO"] == "volcano"
        assert GDACS_PERIL_MAP["TC"] == "tropical_cyclone"
        assert GDACS_PERIL_MAP["FL"] == "flood"
        assert "EQ" not in GDACS_PERIL_MAP  # gempa dari USGS (lebih kaya)


class TestChecksum:
    def test_deterministic(self):
        a = payload_checksum({"x": 1, "y": 2})
        b = payload_checksum({"y": 2, "x": 1})
        assert a == b

    def test_different(self):
        assert payload_checksum({"x": 1}) != payload_checksum({"x": 2})
