"""Tests for Open-Meteo Air Quality connector (S8-P4)."""

import pytest

from connectors.open_meteo_air_quality import (
    REGION_CENTROIDS,
    fetch_region_air_quality,
    us_aqi_category,
)


class TestUsAqiCategory:
    def test_good(self):
        assert us_aqi_category(30) == "Baik"

    def test_moderate(self):
        assert us_aqi_category(75) == "Sedang"

    def test_unhealthy_sensitive(self):
        assert us_aqi_category(120) == "Tidak Sehat (rentan)"

    def test_unhealthy(self):
        assert us_aqi_category(180) == "Tidak Sehat"

    def test_very_unhealthy(self):
        assert us_aqi_category(250) == "Sangat Tidak Sehat"

    def test_hazardous(self):
        assert us_aqi_category(350) == "Berbahaya"

    def test_none(self):
        assert us_aqi_category(None) == "—"


class TestRegionCentroids:
    def test_eight_regions(self):
        assert len(REGION_CENTROIDS) == 8


class TestFetchAirQuality:
    @pytest.mark.asyncio
    async def test_parse_response(self):
        class FakeResponse:
            def raise_for_status(self):
                pass

            def json(self):
                return {
                    "hourly": {
                        "time": ["2026-08-23T06:00", "2026-08-23T07:00", "2026-08-23T08:00"],
                        "pm10": [10.0, 45.9, 50.2],
                        "pm2_5": [5.0, 42.0, 48.1],
                        "us_aqi": [21, 103, 120],
                    }
                }

        class FakeClient:
            async def get(self, url, params=None):
                return FakeResponse()

        data = await fetch_region_air_quality(FakeClient(), -6.2, 106.8)
        assert data is not None
        assert data["pm25"] is not None
        assert data["pm10"] is not None
        assert data["us_aqi"] is not None

    @pytest.mark.asyncio
    async def test_empty_response(self):
        class EmptyResponse:
            def raise_for_status(self):
                pass

            def json(self):
                return {"hourly": {}}

        class FakeClient:
            async def get(self, url, params=None):
                return EmptyResponse()

        assert await fetch_region_air_quality(FakeClient(), 0, 0) is None
