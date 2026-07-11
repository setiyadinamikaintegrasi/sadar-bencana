"""Upsert lokasi evakuasi hasil sinkron OSM (dedup via source_ref)."""

from __future__ import annotations

from typing import Any

from db.pool import get_pool

_UPSERT_SQL = """
INSERT INTO evacuation_locations
  (name, location_type, source_type, source_ref, latitude, longitude,
   address, phone, operating_hours)
VALUES ($1, $2, 'osm', $3, $4, $5, $6, $7, $8)
ON CONFLICT (source_ref) WHERE source_ref IS NOT NULL
DO UPDATE SET
  name = EXCLUDED.name,
  location_type = EXCLUDED.location_type,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  address = EXCLUDED.address,
  phone = EXCLUDED.phone,
  operating_hours = EXCLUDED.operating_hours,
  updated_at = now()
"""


async def upsert_osm_locations(rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    pool = get_pool()
    args = [
        (r["name"], r["location_type"], r["source_ref"], r["latitude"],
         r["longitude"], r["address"], r["phone"], r["operating_hours"])
        for r in rows
    ]
    async with pool.acquire() as conn:
        await conn.executemany(_UPSERT_SQL, args)
    return len(args)
