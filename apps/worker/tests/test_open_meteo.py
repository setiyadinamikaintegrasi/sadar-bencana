"""Tests for Open-Meteo forecast connector (S8-P1)."""

from datetime import date

import pytest

from connectors.open_meteo import (
    REGION_CENTROIDS,
    WMO_LABELS,
    parse_forecast,
    wmo_label,
)


SAMPLE_PAYLOAD = {
    "latitude": -0.53,
    "longitude": 114.03,
    "daily": {
        "time": ["2026-08-23", "2026-08-24", "2026-08-25"],
        "precipitation_probability_max": [76, 90, 48],
        "precipitation_sum": [2.2, 8.1, 1.9],
        "wind_speed_10m_max": [12.3, 18.7, 9.1],
        "weather_code": [61, 65, 2],
    },
}


class TestRegionCentroids:
    def test_eight_regions_defined(self):
        assert len(REGION_CENTROIDS) == 8

    def test_codes_match_situation_api(self):
        codes = {r["code"] for r in REGION_CENTROIDS}
        assert codes == {
            "sumatera", "jawa", "kalimantan", "sulawesi",
            "bali-ntb", "ntt", "maluku", "papua",
        }

    def test_all_have_coords(self):
        for r in REGION_CENTROIDS:
            assert -12 < r["lat"] < 7, f"{r['code']} lat out of range"
            assert 94 < r["lon"] < 142, f"{r['code']} lon out of range"


class TestWmoLabel:
    def test_known_codes(self):
        assert wmo_label(0) == "Cerah"
        assert wmo_label(65) == "Hujan lebat"
        assert wmo_label(95) == "Badai petir"

    def test_none_returns_dash(self):
        assert wmo_label(None) == "—"

    def test_unknown_code(self):
        assert wmo_label(999) == "Kode 999"

    def test_all_wmo_codes_have_labels(self):
        # Setiap kode di WMO_LABELS harus non-kosong
        for code, label in WMO_LABELS.items():
            assert label, f"Kode {code} tanpa label"


class TestParseForecast:
    def test_parse_three_days(self):
        rows = parse_forecast(SAMPLE_PAYLOAD)
        assert len(rows) == 3

    def test_first_day_values(self):
        rows = parse_forecast(SAMPLE_PAYLOAD)
        first = rows[0]
        assert first["forecast_date"] == date(2026, 8, 23)
        assert first["rain_probability"] == 76
        assert first["rain_sum_mm"] == 2.2
        assert first["wind_max_kmh"] == 12.3
        assert first["weather_code"] == 61
        assert first["weather_label"] == "Hujan ringan"

    def test_empty_payload(self):
        assert parse_forecast({}) == []
        assert parse_forecast({"daily": {}}) == []
