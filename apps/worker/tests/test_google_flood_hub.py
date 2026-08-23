"""Tests for Google Flood Hub connector (S9-P1)."""

import pytest

from connectors.google_flood_hub import (
    INDONESIA_BBOX,
    SEVERITY_LABELS,
    _in_indonesia,
    _parse_ts,
    fetch_gauges,
    severity_label,
    sync_flood_hub,
)


def _gauge(gid: str, lat: float, lon: float, river: str = "Kapuas") -> dict:
    return {
        "gaugeId": {"gaugeId": gid},
        "location": {"latitude": lat, "longitude": lon},
        "riverName": river,
        "stationName": f"Stasiun {river}",
        "siteName": river,
        "state": "Kalimantan Barat",
    }


class TestSeverityLabel:
    def test_all_levels(self):
        assert severity_label(1) == "Normal"
        assert severity_label(2) == "Waspada"
        assert severity_label(3) == "Bahaya"
        assert severity_label(4) == "Bahaya Ekstrem"

    def test_none(self):
        assert severity_label(None) == "—"

    def test_unknown(self):
        assert severity_label(9) == "Level 9"

    def test_labels_complete(self):
        assert len(SEVERITY_LABELS) == 4


class TestInIndonesia:
    def test_kalimantan_inside(self):
        assert _in_indonesia(-0.5, 114.0) is True

    def test_jakarta_inside(self):
        assert _in_indonesia(-6.2, 106.8) is True

    def test_papua_inside(self):
        assert _in_indonesia(-4.5, 136.0) is True

    def test_paris_outside(self):
        assert _in_indonesia(48.85, 2.35) is False

    def test_bbox_bounds_sane(self):
        assert INDONESIA_BBOX["min_lon"] < INDONESIA_BBOX["max_lon"]
        assert INDONESIA_BBOX["min_lat"] < INDONESIA_BBOX["max_lat"]


class TestParseTs:
    def test_valid(self):
        ts = _parse_ts("2026-08-23T10:00:00Z")
        assert ts is not None and ts.year == 2026

    def test_none(self):
        assert _parse_ts(None) is None
        assert _parse_ts("") is None

    def test_invalid(self):
        assert _parse_ts("bogus") is None


class TestFetchGauges:
    @pytest.mark.asyncio
    async def test_filters_to_indonesia(self):
        class Resp:
            status_code = 200

            def raise_for_status(self):
                pass

            def json(self):
                return {
                    "gauges": [
                        _gauge("id-1", -0.5, 114.0, river="Kapuas"),
                        _gauge("id-2", -6.2, 106.8, river="Ciliwung"),
                        _gauge("paris", 48.85, 2.35, river="Seine"),
                        _gauge("no-loc", 0.0, 0.0, river="X"),
                    ]
                }

        class FakeClient:
            async def get(self, url, **kwargs):
                return Resp()

        gauges = await fetch_gauges(FakeClient(), "key")
        ids = [g["gauge_id"] for g in gauges]
        assert "id-1" in ids
        assert "id-2" in ids
        assert "paris" not in ids
        assert "no-loc" not in ids
        assert len(gauges) == 2

    @pytest.mark.asyncio
    async def test_pagination(self):
        pages = [
            {"gauges": [_gauge("g1", -2.0, 115.0)], "nextPageToken": "tok"},
            {"gauges": [_gauge("g2", -7.0, 110.0)]},
        ]
        calls = {"n": 0}

        class Resp:
            status_code = 200

            def raise_for_status(self):
                pass

            def json(self):
                page = pages[calls["n"]]
                calls["n"] += 1
                return page

        class FakeClient:
            async def get(self, url, **kwargs):
                return Resp()

        gauges = await fetch_gauges(FakeClient(), "key")
        assert len(gauges) == 2


class TestSyncSkipsWithoutKey:
    @pytest.mark.asyncio
    async def test_skip_graceful(self, monkeypatch):
        monkeypatch.delenv("GOOGLE_FLOOD_HUB_API_KEY", raising=False)
        stats = await sync_flood_hub(None)
        assert stats == {"gauges": 0, "forecasts": 0, "skipped": True}
