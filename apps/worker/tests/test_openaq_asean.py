"""Tests for OpenAQ ASEAN connector (S8-P6)."""

import pytest

from connectors.openaq_asean import (
    ASEAN_STATION_HUBS,
    fetch_nearest_measurement,
    pm25_to_aqi_category,
    sync_openaq_asean,
)


class TestPm25ToAqiCategory:
    def test_good(self):
        assert pm25_to_aqi_category(10.0) == "Baik"

    def test_moderate(self):
        assert pm25_to_aqi_category(25.0) == "Sedang"

    def test_unhealthy_sensitive(self):
        assert pm25_to_aqi_category(45.0) == "Tidak Sehat (rentan)"

    def test_unhealthy(self):
        assert pm25_to_aqi_category(100.0) == "Tidak Sehat"

    def test_very_unhealthy(self):
        assert pm25_to_aqi_category(200.0) == "Sangat Tidak Sehat"

    def test_hazardous(self):
        assert pm25_to_aqi_category(300.0) == "Berbahaya"


class TestAseanHubs:
    def test_covers_transboundary_zone(self):
        countries = {h["country"] for h in ASEAN_STATION_HUBS}
        assert "MY" in countries
        assert "SG" in countries

    def test_kalimantan_impact_zone(self):
        kuching = next(h for h in ASEAN_STATION_HUBS if h["code"] == "kuching")
        assert kuching["lon"] < 111.0  # Borneo barat

    def test_eight_hubs(self):
        assert len(ASEAN_STATION_HUBS) == 8


class TestFetchNearest:
    @pytest.mark.asyncio
    async def test_with_pm25_station(self):
        class LocResp:
            def raise_for_status(self): pass
            def json(self):
                return {"results": [{
                    "id": 12345, "name": "Kuching Station",
                    "sensors": [{"id": 999, "parameter": {"name": "pm25"}}],
                }]}

        class MeasResp:
            def raise_for_status(self): pass
            def json(self):
                return {"results": [{"value": 88.5, "datetime": {"utc": "2026-08-23T10:00:00Z"}}]}

        class FakeClient:
            call_count = 0
            async def get(self, url, **kwargs):
                self.call_count += 1
                if "/locations" in url:
                    return LocResp()
                return MeasResp()

        data = await fetch_nearest_measurement(FakeClient(), "key", 1.55, 110.34)
        assert data is not None
        assert data["pm25"] == 88.5
        assert data["station_name"] == "Kuching Station"

    @pytest.mark.asyncio
    async def test_no_results(self):
        class EmptyResp:
            def raise_for_status(self): pass
            def json(self):
                return {"results": []}

        class FakeClient:
            async def get(self, url, **kwargs):
                return EmptyResp()

        assert await fetch_nearest_measurement(FakeClient(), "key", 0, 0) is None

    @pytest.mark.asyncio
    async def test_no_pm25_sensor(self):
        class NoPmResp:
            def raise_for_status(self): pass
            def json(self):
                return {"results": [{
                    "id": 1, "name": "Station A",
                    "sensors": [{"id": 2, "parameter": {"name": "o3"}}],
                }]}

        class FakeClient:
            async def get(self, url, **kwargs):
                return NoPmResp()

        assert await fetch_nearest_measurement(FakeClient(), "key", 0, 0) is None


class TestSyncSkipsWithoutKey:
    @pytest.mark.asyncio
    async def test_skip_graceful(self, monkeypatch):
        monkeypatch.delenv("OPENAQ_API_KEY", raising=False)
        # pool None aman karena skip sebelum dipakai
        stats = await sync_openaq_asean(None)
        assert stats == {"fetched": 0, "upserted": 0, "skipped": True}
