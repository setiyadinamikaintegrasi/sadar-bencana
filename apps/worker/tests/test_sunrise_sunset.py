"""Tests for sunrise-sunset connector (S8-P3)."""

from datetime import time

import pytest

from connectors.sunrise_sunset import (
    REGION_CENTROIDS,
    parse_day_length,
    parse_hms,
)


class TestParseHms:
    def test_morning(self):
        assert parse_hms("5:22:39 AM") == time(5, 22, 39)

    def test_afternoon(self):
        assert parse_hms("5:30:47 PM") == time(17, 30, 47)

    def test_noon(self):
        assert parse_hms("12:00:00 PM") == time(12, 0, 0)

    def test_midnight(self):
        assert parse_hms("12:00:00 AM") == time(0, 0, 0)

    def test_none(self):
        assert parse_hms(None) is None
        assert parse_hms("") is None

    def test_invalid(self):
        assert parse_hms("not-a-time") is None
        assert parse_hms("25:00:00") is None


class TestParseDayLength:
    def test_twelve_hours(self):
        assert parse_day_length("12:08:08") == 12 * 3600 + 8 * 60 + 8

    def test_none(self):
        assert parse_day_length(None) is None

    def test_invalid(self):
        assert parse_day_length("abc") is None


class TestRegionCentroids:
    def test_eight_regions(self):
        assert len(REGION_CENTROIDS) == 8

    def test_codes_match(self):
        codes = {r["code"] for r in REGION_CENTROIDS}
        assert "kalimantan" in codes
        assert "ntt" in codes
