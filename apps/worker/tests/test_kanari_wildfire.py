"""Tests for kanari wildfire cluster connector (S8-P2)."""

import pytest

from connectors.kanari_wildfire import (
    CONFIDENCE_RANK,
    INDONESIA_BBOX,
    MAX_PERSISTED_CLUSTERS,
    _parse_ts,
    fetch_fire_clusters,
)


def _event(lon: float, lat: float, count: int = 5, frp: float | None = 50.0,
           conf: str = "probable", cid: str | None = None) -> dict:
    return {
        "id": cid or f"test-{lon}-{lat}",
        "centroid": [lon, lat],
        "count": count,
        "viirsCount": 3,
        "goesCount": 1,
        "mtgCount": 1,
        "maxFrp": frp,
        "confidence": conf,
        "firstSeen": "2026-08-23T02:00:00Z",
        "lastSeen": "2026-08-23T05:00:00Z",
    }


class TestBbox:
    def test_indonesia_bbox_covers_archipelago(self):
        assert INDONESIA_BBOX["min_lon"] < 100 < INDONESIA_BBOX["max_lon"]
        assert INDONESIA_BBOX["min_lat"] < -2.5 < INDONESIA_BBOX["max_lat"]

    def test_confidence_rank_ordering(self):
        assert CONFIDENCE_RANK["possible"] < CONFIDENCE_RANK["probable"] < CONFIDENCE_RANK["corrobore"]


class TestParseTs:
    def test_valid_iso(self):
        ts = _parse_ts("2026-08-23T05:00:00Z")
        assert ts is not None and ts.year == 2026

    def test_none(self):
        assert _parse_ts(None) is None
        assert _parse_ts("") is None

    def test_invalid(self):
        assert _parse_ts("not-a-date") is None


class TestFetchFireClusters:
    @pytest.fixture
    def fake_client(self, monkeypatch):
        """Mock httpx client returning kanari-style payload."""
        class FakeResponse:
            def raise_for_status(self):
                pass

            def json(self):
                return {
                    "events": [
                        _event(114.0, -0.5, count=20, frp=400, cid="kal-1"),   # Kalimantan
                        _event(120.0, -2.0, count=15, frp=300, cid="sul-1"),   # Sulawesi
                        _event(2.35, 48.85, count=50, frp=900, cid="paris"),   # Paris (luar)
                        _event(123.5, -9.5, count=8, frp=100, cid="ntt-1"),    # NTT
                    ],
                    "meta": {"totalEvents": 4},
                }

        class FakeClient:
            async def get(self, url, params=None):
                return FakeResponse()

        return FakeClient()

    @pytest.mark.asyncio
    async def test_filters_to_indonesia(self, fake_client):
        clusters = await fetch_fire_clusters(fake_client)
        ids = [c["cluster_id"] for c in clusters]
        assert "kal-1" in ids
        assert "sul-1" in ids
        assert "ntt-1" in ids
        assert "paris" not in ids
        assert len(clusters) == 3

    @pytest.mark.asyncio
    async def test_sorted_by_strength(self, fake_client):
        clusters = await fetch_fire_clusters(fake_client)
        counts = [c["detection_count"] for c in clusters]
        assert counts == sorted(counts, reverse=True)

    @pytest.mark.asyncio
    async def test_fields_parsed(self, fake_client):
        clusters = await fetch_fire_clusters(fake_client)
        kal = next(c for c in clusters if c["cluster_id"] == "kal-1")
        assert kal["detection_count"] == 20
        assert kal["max_frp_mw"] == 400.0
        assert kal["confidence"] == "probable"
        assert kal["viirs_count"] == 3
        assert kal["last_seen_at"] is not None

    @pytest.mark.asyncio
    async def test_invalid_confidence_defaults(self, fake_client, monkeypatch):
        class WeirdResponse:
            def raise_for_status(self): pass
            def json(self):
                return {"events": [_event(110.0, -1.0, conf="weird")]}
        async def weird_get(*a, **k):
            return WeirdResponse()
        fake_client.get = weird_get
        clusters = await fetch_fire_clusters(fake_client)
        assert clusters[0]["confidence"] == "possible"

    @pytest.mark.asyncio
    async def test_caps_at_max(self, fake_client):
        events = [_event(110 + (i % 20), -1 + (i % 3), count=i) for i in range(600)]
        class BigResponse:
            def raise_for_status(self): pass
            def json(self): return {"events": events}
        async def big_get(*a, **k): return BigResponse()
        fake_client.get = big_get
        clusters = await fetch_fire_clusters(fake_client)
        assert len(clusters) <= MAX_PERSISTED_CLUSTERS
