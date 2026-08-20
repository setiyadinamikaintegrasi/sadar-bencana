"""PetaBencana flood-areas connector (Sprint 6 S7).

Menarik status genangan real-time per area RW/RT dari endpoint
``/floods`` PetaBencana.id (TopoJSON; sumber BPBD). Berbeda dari
connector ``petabencana_flood`` (laporan insiden titik), ini adalah
status genangan per wilayah administratif dengan tingkat kedalaman:

    state 1 = 10-30 cm, 2 = 30-70 cm, 3 = 70-150 cm, 4 = >150 cm.

TopoJSON didekode manual (transform None = koordinat absolut) sehingga
worker tidak butuh dependency baru. Sinkron penuh tiap siklus: baris
lama yang tidak lagi muncul di feed (surut) dihapus.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

import httpx

logger = logging.getLogger(__name__)

FLOODS_URL = "https://data.petabencana.id/floods?minimum_state=1"
_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; sadar-bencana/1.0)"}
MAX_AREAS_PER_RUN = 5000


def decode_topology(topology: dict[str, Any]) -> list[dict[str, Any]]:
    """Dekode TopoJSON PetaBencana (transform=None) -> daftar feature GeoJSON.

    Arc pada feed ini berisi koordinat absolut (bukan delta), sehingga
    dekode hanya menjahit arc sesuai indeks (negatif = terbalik).
    """
    arcs: list[list[list[float]]] = topology.get("arcs") or []

    def arc_coords(index: int) -> list[list[float]]:
        if index >= 0:
            return arcs[index]
        return list(reversed(arcs[~index]))

    def decode_ring(indices: list[int]) -> list[list[float]]:
        ring: list[list[float]] = []
        for index in indices:
            coords = arc_coords(index)
            ring.extend(coords if not ring else coords[1:])
        if ring and ring[0] != ring[-1]:
            ring.append(list(ring[0]))
        return ring

    features: list[dict[str, Any]] = []
    geometries = (topology.get("objects") or {}).get("output", {}).get("geometries", [])
    for geometry in geometries:
        arc_groups = geometry.get("arcs") or []
        rings: list[list[list[float]]] = []
        for group in arc_groups:
            indices = group if isinstance(group, list) else [group]
            # Elemen bisa nested (multi-ring); tangani keduanya.
            if indices and isinstance(indices[0], list):
                for nested in indices:
                    rings.append(decode_ring([int(i) for i in nested]))
            else:
                rings.append(decode_ring([int(i) for i in indices]))
        if not rings:
            continue
        features.append({
            "type": "Feature",
            "properties": geometry.get("properties") or {},
            "geometry": {"type": "Polygon", "coordinates": rings},
        })
    return features


def area_bounds(rings: list[list[list[float]]]) -> tuple[float, float, float, float]:
    """(min_lng, min_lat, max_lng, max_lat) dari semua ring poligon."""
    lons = [point[0] for ring in rings for point in ring]
    lats = [point[1] for ring in rings for point in ring]
    return min(lons), min(lats), max(lons), max(lats)


class PetaBencanaFloodAreasConnector:
    """Menarik area terendam aktif (state >= 1) dari PetaBencana."""

    def __init__(self, http_client: httpx.AsyncClient | None = None, timeout: float = 30.0) -> None:
        self._client = http_client
        self._timeout = timeout
        self._owns_client = http_client is None

    async def fetch_areas(self) -> list[dict[str, Any]]:
        """Daftar baris siap-upsert: area aktif + poligon + bbox."""
        client = self._client
        if client is None:
            client = httpx.AsyncClient(timeout=self._timeout)
            self._client = client
        response = await client.get(FLOODS_URL, headers=_HEADERS)
        response.raise_for_status()
        payload = response.json()
        result = payload.get("result") or {}
        if result.get("type") != "Topology":
            logger.warning("floods: bentuk feed tidak dikenal (%s)", result.get("type"))
            return []

        rows: list[dict[str, Any]] = []
        for feature in decode_topology(result)[:MAX_AREAS_PER_RUN]:
            props = feature.get("properties") or {}
            state = props.get("state")
            rings = (feature.get("geometry") or {}).get("coordinates") or []
            if not isinstance(state, int) or not 1 <= state <= 4 or not rings:
                continue
            min_lng, min_lat, max_lng, max_lat = area_bounds(rings)
            attributes = props.get("attributes") or {}
            rows.append({
                "area_id": str(props.get("geom_id") or props.get("area_id") or ""),
                "area_name": str(props.get("area_name") or "")[:120],
                "parent_name": str(props.get("parent_name") or "")[:120],
                "city_name": str(props.get("city_name") or "")[:120],
                "district": str(attributes.get("District") or "")[:120],
                "state": state,
                "geometry": feature["geometry"],
                "min_longitude": min_lng,
                "min_latitude": min_lat,
                "max_longitude": max_lng,
                "max_latitude": max_lat,
            })
        rows = [row for row in rows if row["area_id"]]
        logger.info("PetaBencana flood areas: %d aktif", len(rows))
        return rows

    async def close(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None


async def sync_flood_areas(pool) -> dict[str, int]:
    """Alur lengkap: fetch -> replace-set (hapus yang surut, upsert aktif)."""
    connector = PetaBencanaFloodAreasConnector()
    try:
        rows = await connector.fetch_areas()
    finally:
        await connector.close()

    seen_ids = {row["area_id"] for row in rows}
    async with pool.acquire() as conn:
        async with conn.transaction():
            removed = await conn.execute(
                "DELETE FROM flood_areas WHERE area_id <> ALL($1::text[])",
                sorted(seen_ids) or ["__none__"],
            )
            removed_count = int(removed.split()[-1]) if removed else 0
            for row in rows:
                await conn.execute(
                    """
                    INSERT INTO flood_areas (
                        area_id, area_name, parent_name, city_name, district,
                        state, geometry, min_longitude, min_latitude,
                        max_longitude, max_latitude, updated_at
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11, now())
                    ON CONFLICT (area_id) DO UPDATE SET
                        state = EXCLUDED.state,
                        geometry = EXCLUDED.geometry,
                        updated_at = now()
                    """,
                    row["area_id"], row["area_name"], row["parent_name"],
                    row["city_name"], row["district"], row["state"],
                    __import__("json").dumps(row["geometry"]),
                    row["min_longitude"], row["min_latitude"],
                    row["max_longitude"], row["max_latitude"],
                )
    return {"active": len(rows), "removed": removed_count}
