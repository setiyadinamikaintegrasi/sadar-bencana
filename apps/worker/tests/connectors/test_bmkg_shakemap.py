"""Unit tests untuk Shakemap MMI overlay connector (Sprint 6 S6)."""

from __future__ import annotations

import httpx
import pytest

from connectors.bmkg_shakemap import (
    SHAKEMAP_EXTENT_DEGREES,
    BMKGShakemapConnector,
    event_id_for_feed_item,
    overlay_from_feed_item,
    upsert_overlays,
)
from normalizers.bmkg import _generate_event_id

# Item feed asli (dipangkas) dari autogempa 20 Agu 2026.
REAL_ITEM = {
    "DateTime": "2026-08-19T23:20:13+00:00",
    "Coordinates": "-8.28,120.57",
    "Magnitude": "4.5",
    "Kedalaman": "3 km",
    "Wilayah": "Pusat gempa berada di laut 39 km utara Ruteng",
    "Dirasakan": "II Kab. Manggarai",
    "Shakemap": "20260820062013.mmi.jpg",
}


def test_overlay_from_feed_item_builds_georeference():
    overlay = overlay_from_feed_item(REAL_ITEM)
    assert overlay is not None
    assert overlay.shakemap_key == "20260820062013"
    assert overlay.image_url.endswith("/20260820062013.mmi.jpg")
    assert overlay.magnitude == 4.5
    assert overlay.depth_km == 3.0
    assert overlay.latitude == -8.28
    assert overlay.longitude == 120.57
    # Bbox 5° berpusat episenter (terverifikasi pixel-level pada gambar asli).
    half = SHAKEMAP_EXTENT_DEGREES / 2
    assert overlay.min_longitude == pytest.approx(120.57 - half)
    assert overlay.max_longitude == pytest.approx(120.57 + half)
    assert overlay.min_latitude == pytest.approx(-8.28 - half)
    assert overlay.max_latitude == pytest.approx(-8.28 + half)
    assert overlay.felt_reports == "II Kab. Manggarai"


def test_event_id_matches_main_normalizer():
    """Wajib identik dengan normalizer BMKG utama agar join ke events bersih."""
    assert event_id_for_feed_item(REAL_ITEM) == _generate_event_id(REAL_ITEM)


def test_overlay_skips_items_without_shakemap():
    no_map = {k: v for k, v in REAL_ITEM.items() if k != "Shakemap"}
    assert overlay_from_feed_item(no_map) is None
    assert overlay_from_feed_item({**REAL_ITEM, "Shakemap": ""}) is None
    assert overlay_from_feed_item({**REAL_ITEM, "Shakemap": "readme.txt"}) is None


def test_overlay_rejects_bad_coordinates():
    bad = {**REAL_ITEM, "Coordinates": "tidak valid"}
    assert overlay_from_feed_item(bad) is None


def test_connector_parses_both_feed_shapes(monkeypatch):
    """autogempa (objek tunggal) dan gempadirasakan (list) keduanya terbaca."""
    autogempa = {"Infogempa": {"gempa": REAL_ITEM}}
    dirasakan = {"Infogempa": {"gempa": [REAL_ITEM, {**REAL_ITEM, "Shakemap": "x"}]}}
    calls = iter([
        httpx.Response(200, json=autogempa, request=httpx.Request("GET", "x")),
        httpx.Response(200, json=dirasakan, request=httpx.Request("GET", "x")),
    ])

    async def fake_get(self, url, **_):
        return next(calls)

    class FakeHead:
        async def __call__(self, url, **_):
            return httpx.Response(200, request=httpx.Request("HEAD", url))

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    monkeypatch.setattr(httpx.AsyncClient, "head", FakeHead())

    import asyncio

    async def run():
        connector = BMKGShakemapConnector()
        try:
            overlays = await connector.fetch_overlays()
        finally:
            await connector.close()
        return overlays

    overlays = asyncio.run(run())
    # Dedup by event_id: objek tunggal + list menghasilkan 1 overlay unik.
    assert len(overlays) == 1
    assert overlays[0].shakemap_key == "20260820062013"


def test_connector_tolerates_feed_failure(monkeypatch):
    import asyncio

    async def failing_get(self, url, **_):
        raise httpx.ConnectError("down", request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx.AsyncClient, "get", failing_get)

    async def run():
        connector = BMKGShakemapConnector()
        try:
            return await connector.fetch_overlays()
        finally:
            await connector.close()

    assert asyncio.run(run()) == []


SHAKEMAP_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS shakemap_overlays (
    event_id      TEXT PRIMARY KEY,
    shakemap_key  TEXT NOT NULL,
    image_url     TEXT NOT NULL,
    magnitude     DOUBLE PRECISION NOT NULL,
    depth_km      DOUBLE PRECISION,
    latitude      DOUBLE PRECISION NOT NULL,
    longitude     DOUBLE PRECISION NOT NULL,
    min_longitude DOUBLE PRECISION NOT NULL,
    min_latitude  DOUBLE PRECISION NOT NULL,
    max_longitude DOUBLE PRECISION NOT NULL,
    max_latitude  DOUBLE PRECISION NOT NULL,
    felt_reports  TEXT NOT NULL DEFAULT '',
    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""

@pytest.mark.asyncio
async def test_upsert_overlays_idempotent():
    """Upsert dua kali tidak menduplikasi baris (butuh TEST_DATABASE_URL;
    skema dibuat mandiri sehingga tak bergantung migrasi repo)."""
    import os

    import asyncpg

    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL tidak di-set — butuh Postgres")

    pool = await asyncpg.connect(database_url)
    try:
        await pool.execute("DROP TABLE IF EXISTS shakemap_overlays")
        await pool.execute(SHAKEMAP_SCHEMA_SQL)
        overlay = overlay_from_feed_item(REAL_ITEM)
        first = await upsert_overlays(pool, [overlay])
        second = await upsert_overlays(pool, [overlay])
        count = await pool.fetchval("SELECT count(*) FROM shakemap_overlays WHERE event_id = $1", overlay.event_id)
        assert count == 1
        assert first >= 0 and second == 0  # insert pertama, update murni kedua.
    finally:
        await pool.close()
