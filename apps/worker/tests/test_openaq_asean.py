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

    def test_nine_hubs_incl_jakarta(self):
        # 8 ASEAN + 1 domestik (Jakarta BMKG ground) sejak S8-P7.
        assert len(ASEAN_STATION_HUBS) == 9
        codes = {h["code"] for h in ASEAN_STATION_HUBS}
        assert "jakarta-bmkg" in codes


class TestFetchNearest:
    @pytest.mark.asyncio
    async def test_with_pm25_station(self):
        class LocResp:
            status_code = 200
            def raise_for_status(self): pass
            def json(self):
                return {"results": [{
                    "id": 12345, "name": "Kuching Station",
                    "datetimeLast": {"utc": "2026-08-23T10:00:00Z"},
                    "sensors": [{"id": 999, "parameter": {"name": "pm25"}}],
                }]}

        class MeasResp:
            status_code = 200
            def raise_for_status(self): pass
            def json(self):
                return {"results": [{"value": 88.5, "period": {"datetimeTo": {"utc": "2026-08-23T10:00:00Z"}}}]}

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
            status_code = 200
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
            status_code = 200
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


class TestFreshnessSorting:
    """Strategi S8-P7b: pilih stasiun berdasarkan timestamp PM25 AKTUAL
    (bukan datetimeLast lokasi yang bisa menyesatkan — bug Taman Tun)."""

    @pytest.mark.asyncio
    async def test_prefers_freshest_pm25_not_location_last(self):
        # Stale-by-pm25: loc.datetimeLast BARU (dari sensor meteo) tapi
        # pm25-nya lama — harus kalah dari stasiun dgn pm25 baru.
        measurements = {
            "11": {"value": 50.0, "period": {"datetimeTo": {"utc": "2024-12-23T07:00:00Z"}}},
            "22": {"value": 42.0, "period": {"datetimeTo": {"utc": "2026-08-23T10:00:00Z"}}},
        }

        class Resp:
            status_code = 200
            def raise_for_status(self): pass
            def json(self):
                return {"results": [
                    {"id": 1, "name": "Meteo Fresh, PM25 Stale",
                     "datetimeLast": {"utc": "2026-08-24T06:00:00Z"},
                     "sensors": [{"id": 11, "parameter": {"name": "pm25"}}]},
                    {"id": 2, "name": "PM25 Fresh Station",
                     "datetimeLast": {"utc": "2026-08-23T10:00:00Z"},
                     "sensors": [{"id": 22, "parameter": {"name": "pm25"}}]},
                ]}

        class MeasResp:
            status_code = 200
            def raise_for_status(self): pass
            def __init__(self, payload):
                self._payload = payload
            def json(self):
                return {"results": [self._payload]}

        class FakeClient:
            async def get(self, url, **kwargs):
                if "/locations" in url:
                    return Resp()
                sid = url.split("/sensors/")[1].split("/")[0]
                return MeasResp(measurements[sid])

        data = await fetch_nearest_measurement(FakeClient(), "key", 0, 0)
        assert data is not None
        # PM25 Fresh menang meski loc.datetimeLast-nya lebih lama
        assert data["station_name"] == "PM25 Fresh Station"
        assert data["measured_at"] is not None

    @pytest.mark.asyncio
    async def test_caps_candidates_at_five(self):
        sensors = [{"id": i, "parameter": {"name": "pm25"}} for i in range(1, 9)]
        class Resp:
            status_code = 200
            def raise_for_status(self): pass
            def json(self):
                return {"results": [
                    {"id": i, "name": f"S{i}", "datetimeLast": {"utc": "2026-08-23T10:00:00Z"}, "sensors": [s]}
                    for i, s in enumerate(sensors, 1)
                ]}
        class MeasResp:
            status_code = 200
            def raise_for_status(self): pass
            def json(self):
                return {"results": [{"value": 10.0, "period": {"datetimeTo": {"utc": "2026-08-20T10:00:00Z"}}}]}
        calls = {"n": 0}
        class FakeClient:
            async def get(self, url, **kwargs):
                if "/locations" in url:
                    return Resp()
                calls["n"] += 1
                return MeasResp()
        await fetch_nearest_measurement(FakeClient(), "key", 0, 0)
        assert calls["n"] <= 5

    @pytest.mark.asyncio
    async def test_skips_erroring_sensor(self):
        class Resp:
            status_code = 200
            def raise_for_status(self): pass
            def json(self):
                return {"results": [
                    {"id": 1, "name": "Broken", "datetimeLast": {"utc": "2026-08-24T00:00:00Z"},
                     "sensors": [{"id": 11, "parameter": {"name": "pm25"}}]},
                    {"id": 2, "name": "Works", "datetimeLast": {"utc": "2026-08-23T00:00:00Z"},
                     "sensors": [{"id": 22, "parameter": {"name": "pm25"}}]},
                ]}
        class Err:
            status_code = 429
            def raise_for_status(self): pass
            def json(self): return {}
        class Ok:
            status_code = 200
            def raise_for_status(self): pass
            def json(self):
                return {"results": [{"value": 20.0, "period": {"datetimeTo": {"utc": "2026-08-22T10:00:00Z"}}}]}
        class FakeClient:
            async def get(self, url, **kwargs):
                if "/locations" in url:
                    return Resp()
                sid = url.split("/sensors/")[1].split("/")[0]
                return Err() if sid == "11" else Ok()
        data = await fetch_nearest_measurement(FakeClient(), "key", 0, 0)
        assert data is not None and data["station_name"] == "Works"
