"""Unit tests flood-areas connector (S7) — dekode TopoJSON + sync replace-set."""

from __future__ import annotations

import httpx
import pytest

from connectors.petabencana_flood_areas import (
    area_bounds,
    decode_topology,
)

# TopoJSON mini meniru struktur PetaBencana: transform None, arcs absolut.
TOPOLOGY = {
    "type": "Topology",
    "arcs": [
        [[106.90, -6.29], [106.91, -6.29], [106.91, -6.28]],
        [[106.91, -6.28], [106.90, -6.29]],  # penutup ke titik awal
    ],
    "objects": {
        "output": {
            "type": "GeometryCollection",
            "geometries": [
                {
                    "type": "Polygon",
                    "arcs": [0, 1],
                    "properties": {
                        "area_id": "2945", "geom_id": "3175x", "area_name": "RT 013",
                        "parent_name": "LUBANG BUAYA", "city_name": "CIPAYUNG", "state": 2,
                        "attributes": {"District": "JAKARTA TIMUR"},
                    },
                }
            ],
        }
    },
}


def test_decode_topology_stitches_absolute_arcs_into_closed_ring():
    features = decode_topology(TOPOLOGY)
    assert len(features) == 1
    ring = features[0]["geometry"]["coordinates"][0]
    # Ring tertutup: titik akhir == titik awal.
    assert ring[0] == ring[-1]
    assert ring[0] == [106.90, -6.29]
    assert features[0]["properties"]["state"] == 2


def test_area_bounds_from_rings():
    min_lng, min_lat, max_lng, max_lat = area_bounds([[[106.9, -6.3], [106.95, -6.25], [106.92, -6.2]]])
    assert (min_lng, min_lat, max_lng, max_lat) == (106.9, -6.3, 106.95, -6.2)


def test_decode_topology_skips_geometry_without_arcs():
    broken = {"arcs": [], "objects": {"output": {"geometries": [{"type": "Polygon", "arcs": [], "properties": {"state": 1}}]}}}
    assert decode_topology(broken) == []


@pytest.mark.asyncio
async def test_connector_filters_invalid_state(monkeypatch):
    from connectors.petabencana_flood_areas import PetaBencanaFloodAreasConnector

    mixed = {
        "result": {
            "type": "Topology",
            "arcs": TOPOLOGY["arcs"],
            "objects": {
                "output": {
                    "geometries": [
                        TOPOLOGY["objects"]["output"]["geometries"][0],
                        # state tidak valid -> dilewati
                        {**TOPOLOGY["objects"]["output"]["geometries"][0], "properties": {"state": 9, "geom_id": "bad"}},
                        # state 0 (tidak terendam) -> dilewati
                        {**TOPOLOGY["objects"]["output"]["geometries"][0], "properties": {"state": 0, "geom_id": "dry"}},
                    ]
                }
            },
        }
    }

    async def fake_get(self, url, **_):
        return httpx.Response(200, json=mixed, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    connector = PetaBencanaFloodAreasConnector()
    try:
        rows = await connector.fetch_areas()
    finally:
        await connector.close()
    assert len(rows) == 1
    assert rows[0]["state"] == 2
    assert rows[0]["area_id"] == "3175x"


@pytest.mark.asyncio
async def test_sync_replaces_set(tmp_path):
    """Area yang hilang dari feed (surut) dihapus dari tabel."""
    import os

    import asyncpg

    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL tidak di-set — butuh Postgres")

    import json as jsonlib

    from connectors.petabencana_flood_areas import sync_flood_areas

    conn = await asyncpg.connect(database_url)
    try:
        await conn.execute(
            """CREATE TABLE IF NOT EXISTS flood_areas (
                area_id TEXT PRIMARY KEY, area_name TEXT NOT NULL DEFAULT '',
                parent_name TEXT NOT NULL DEFAULT '', city_name TEXT NOT NULL DEFAULT '',
                district TEXT NOT NULL DEFAULT '', state SMALLINT NOT NULL,
                geometry JSONB NOT NULL, min_longitude DOUBLE PRECISION NOT NULL,
                min_latitude DOUBLE PRECISION NOT NULL, max_longitude DOUBLE PRECISION NOT NULL,
                max_latitude DOUBLE PRECISION NOT NULL,
                source TEXT NOT NULL DEFAULT 'petabencana',
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
        # Seed dua area lama; feed hanya membawa satu -> satu dihapus.
        polygon = {"type": "Polygon", "coordinates": [[[1.0, 1.0], [1.1, 1.0], [1.1, 1.1], [1.0, 1.0]]]}
        await conn.execute(
            "INSERT INTO flood_areas (area_id, area_name, state, geometry, min_longitude, min_latitude, max_longitude, max_latitude) "
            "VALUES ('stale', 'RT Lama', 1, $1::jsonb, 1.0, 1.0, 1.1, 1.1) ON CONFLICT DO NOTHING",
            jsonlib.dumps(polygon),
        )
        stats = await sync_flood_areas(await _pool_from_url(database_url))
        remaining = await conn.fetchval("SELECT count(*) FROM flood_areas WHERE area_id = 'stale'")
        assert remaining == 0  # surut -> terhapus
        assert stats["active"] >= 0
    finally:
        await conn.close()


async def _pool_from_url(url: str):
    import asyncpg

    return await asyncpg.create_pool(url, min_size=1, max_size=1)
