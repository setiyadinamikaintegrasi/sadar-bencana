"""Historical warehouse backfill (Fase 3B 2/2).

Mengisi historical_disaster_events dari sumber terbuka:
- USGS FDSN earthquake catalog (M>=5.0, bbox Indonesia, 2020-2024) —
  900+ events, kaya, gratis, no key.
- GDACS archive (volcano/tropical cyclone/flood signifikan) — pelengkap
  multi-peril utk event besar saja (few per year utk Indonesia).

Setiap event dipetakan ke kode provinsi via point-in-polygon terhadap
administrative_boundaries (bbox pre-filter lalu ray-casting).

Menjalankan: fungsi dipanggil manual via worker endpoint (sekali),
bukan scheduler — backfill adalah operasi one-shot per dataset.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import date, datetime, timezone
from typing import Any

import httpx
from asyncpg import Pool

logger = logging.getLogger(__name__)

USGS_FDSN_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"
GDACS_ARCHIVE_URL = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
REQUEST_TIMEOUT_SECONDS = 60.0

INDONESIA_BBOX = {"min_lat": -11.0, "max_lat": 6.0, "min_lon": 95.0, "max_lon": 141.0}

BACKFILL_YEARS = range(2020, 2025)  # 5 tahun terakhir


def payload_checksum(payload: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


# ---------------------------------------------------------------------------
# Point-in-polygon (bbox pre-filter + ray casting) — dilakukan di worker
# karena PostGIS tidak terpasang di semua environment.
# ---------------------------------------------------------------------------

def _ring_contains(coords: list, lon: float, lat: float) -> bool:
    inside = False
    n = len(coords)
    j = n - 1
    for i in range(n):
        xi, yi = coords[i][0], coords[i][1]
        xj, yj = coords[j][0], coords[j][1]
        if ((yi > lat) != (yj > lat)) and (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def _polygon_contains(geom: dict, lon: float, lat: float) -> bool:
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    return any(_ring_contains(p[0], lon, lat) for p in polys)


class ProvinceIndex:
    """Index provinsi (bbox pre-filter -> PIP) dari tabel boundaries."""

    def __init__(self, rows: list[tuple[str, str, Any, float, float, float, float]]):
        # rows: (code, name, geometry, min_lon, min_lat, max_lon, max_lat)
        self._entries = [
            (code, json.loads(geometry) if isinstance(geometry, str) else geometry,
             min_lon, min_lat, max_lon, max_lat)
            for code, name, geometry, min_lon, min_lat, max_lon, max_lat in rows
        ]

    def lookup(self, lon: float, lat: float) -> str | None:
        for code, geom, min_lon, min_lat, max_lon, max_lat in self._entries:
            if not (min_lon <= lon <= max_lon and min_lat <= lat <= max_lat):
                continue
            if _polygon_contains(geom, lon, lat):
                return code
        return None

    def lookup_nearest(self, lon: float, lat: float) -> str | None:
        """Fallback event laut: provinsi dgn jarak bbox terdekat.

        Gempa bawah laut (utama sumber tsunami) penting tetap tercatat
        pada provinsi paling terdampak — pakai jarak ke bbox (0 jika
        di dalam), bukan polygon, agar tidak mahal.
        """
        best_code = None
        best_dist = float("inf")
        for code, _geom, min_lon, min_lat, max_lon, max_lat in self._entries:
            dx = max(min_lon - lon, 0, lon - max_lon)
            dy = max(min_lat - lat, 0, lat - max_lat)
            dist = dx * dx + dy * dy
            if dist < best_dist:
                best_dist = dist
                best_code = code
        return best_code


# ---------------------------------------------------------------------------
# USGS earthquakes
# ---------------------------------------------------------------------------

async def fetch_usgs_year(client: httpx.AsyncClient, year: int) -> list[dict[str, Any]]:
    """Fetch satu tahun gempa M>=5 bbox Indonesia."""
    resp = await client.get(
        USGS_FDSN_URL,
        params={
            "starttime": f"{year}-01-01",
            "endtime": f"{year}-12-31",
            "minlatitude": INDONESIA_BBOX["min_lat"],
            "maxlatitude": INDONESIA_BBOX["max_lat"],
            "minlongitude": INDONESIA_BBOX["min_lon"],
            "maxlongitude": INDONESIA_BBOX["max_lon"],
            "minmagnitude": 5.0,
            "format": "geojson",
            "limit": 20000,
            "orderby": "time-asc",
        },
    )
    resp.raise_for_status()
    payload = resp.json()
    events = []
    for feature in payload.get("features", []):
        props = feature.get("properties", {})
        coords = (feature.get("geometry", {}) or {}).get("coordinates") or [0, 0]
        if len(coords) < 2:
            continue
        events.append({
            "source_record_id": f"usgs-{feature.get('id', '')}",
            "peril_type": "earthquake",
            "occurred_at": datetime.fromtimestamp(props["time"] / 1000, tz=timezone.utc),
            "magnitude": props.get("mag"),
            "latitude": float(coords[1]),
            "longitude": float(coords[0]),
            "title": props.get("place") or f"Gempa M{props.get('mag', '?')}",
            "raw_payload": {
                "mag": props.get("mag"),
                "place": props.get("place"),
                "tsunami": props.get("tsunami"),
                "alert": props.get("alert"),
                "url": props.get("url"),
            },
        })
    return events


# ---------------------------------------------------------------------------
# GDACS significant events (volcano / cyclone / flood)
# ---------------------------------------------------------------------------

GDACS_PERIL_MAP = {"VO": "volcano", "TC": "tropical_cyclone", "FL": "flood"}


async def fetch_gdacs_range(
    client: httpx.AsyncClient, year: int
) -> list[dict[str, Any]]:
    resp = await client.get(
        GDACS_ARCHIVE_URL,
        params={"fromDate": f"{year}-01-01", "toDate": f"{year}-12-31"},
    )
    resp.raise_for_status()
    payload = resp.json()
    events = []
    for feature in payload.get("features", []):
        props = feature.get("properties", {})
        etype = props.get("eventtype")
        peril = GDACS_PERIL_MAP.get(etype)
        if not peril:
            continue
        country = props.get("country") or ""
        if "Indonesia" not in country:
            continue
        coords = (feature.get("geometry", {}) or (feature.get("point", {}) or {}).get("coordinates")) or None
        if not coords:
            # GDACS GeoJSON: geometry {type: Point, coordinates: [lon, lat]}
            continue
        lon, lat = float(coords[0]), float(coords[1])
        if not (INDONESIA_BBOX["min_lon"] <= lon <= INDONESIA_BBOX["max_lon"]
                and INDONESIA_BBOX["min_lat"] <= lat <= INDONESIA_BBOX["max_lat"]):
            continue
        raw_date = props.get("fromdate") or ""
        try:
            occurred = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
        except ValueError:
            continue
        events.append({
            "source_record_id": f"gdacs-{props.get('eventid', '')}-{props.get('episodeid', '')}",
            "peril_type": peril,
            "occurred_at": occurred,
            "magnitude": None,
            "latitude": lat,
            "longitude": lon,
            "title": props.get("name") or f"{peril} event",
            "raw_payload": {
                "alertlevel": props.get("alertlevel"),
                "glide": props.get("glide"),
                "url": props.get("url"),
                "country": country,
            },
        })
    return events


# ---------------------------------------------------------------------------
# Sinkronisasi utama
# ---------------------------------------------------------------------------

async def run_historical_backfill(pool: Pool) -> dict[str, int]:
    """Backfill warehouse: USGS + GDACS -> historical_disaster_events."""
    async with pool.acquire() as conn:
        province_rows = await conn.fetch(
            """SELECT code, name, geometry, min_longitude, min_latitude,
                      max_longitude, max_latitude
               FROM administrative_boundaries WHERE level = 'province'"""
        )
    index = ProvinceIndex([tuple(r) for r in province_rows])

    inserted_total = 0
    skipped_total = 0

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        for year in BACKFILL_YEARS:
            events: list[dict[str, Any]] = []
            try:
                events.extend(await fetch_usgs_year(client, year))
            except Exception as exc:
                logger.warning("USGS backfill %s gagal: %s", year, exc)
            try:
                events.extend(await fetch_gdacs_range(client, year))
            except Exception as exc:
                logger.warning("GDACS backfill %s gagal: %s", year, exc)

            async with pool.acquire() as conn:
                async with conn.transaction():
                    for event in events:
                        code = index.lookup(event["longitude"], event["latitude"])
                        if code is None:
                            # Event di laut (mayoritas gempa bawah laut) —
                            # provinsi terdekat via bbox agar tetap tercatat.
                            code = index.lookup_nearest(event["longitude"], event["latitude"])
                            if code is None:
                                skipped_total += 1
                                continue
                            event["raw_payload"]["province_assignment"] = "nearest_bbox"
                        checksum = payload_checksum(event["raw_payload"])
                        # Registrasikan dataset sekali per sumber-tahun.
                        await conn.execute(
                            """
                            INSERT INTO historical_datasets
                              (source_name, dataset_version, data_vintage, source_url, attribution, license, payload_checksum)
                            VALUES ($1, $2, $3, $4, $5, $6, $7)
                            ON CONFLICT (source_name, dataset_version, payload_checksum) DO NOTHING
                            """,
                            "usgs-fdsn" if event["peril_type"] == "earthquake" else "gdacs-archive",
                            f"{year}-backfill",
                            date(year, 12, 31),
                            USGS_FDSN_URL if event["peril_type"] == "earthquake" else GDACS_ARCHIVE_URL,
                            "USGS Earthquake Hazards Program" if event["peril_type"] == "earthquake" else "GDACS (JRC European Commission)",
                            None,
                            hashlib.sha256(str(year).encode()).hexdigest(),
                        )
                        dataset_id = await conn.fetchval(
                            """SELECT id FROM historical_datasets
                               WHERE source_name=$1 AND dataset_version=$2 AND payload_checksum=$3""",
                            "usgs-fdsn" if event["peril_type"] == "earthquake" else "gdacs-archive",
                            f"{year}-backfill",
                            hashlib.sha256(str(year).encode()).hexdigest(),
                        )
                        result = await conn.execute(
                            """
                            INSERT INTO historical_disaster_events
                              (dataset_id, source_record_id, peril_type, occurred_at,
                               administrative_code, latitude, longitude, title, raw_payload, payload_checksum)
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
                            ON CONFLICT DO NOTHING
                            """,
                            dataset_id, event["source_record_id"], event["peril_type"],
                            event["occurred_at"], code, event["latitude"], event["longitude"],
                            event["title"], json.dumps(event["raw_payload"]), checksum,
                        )
                        inserted_total += int(result.endswith(" 1"))

    return {"inserted": inserted_total, "skipped_no_province": skipped_total}
