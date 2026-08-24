"""Open-Meteo Air Quality connector (S8-P4).

Fetches PM2.5 / PM10 / US AQI per region centroid from the free
Open-Meteo Air Quality API (no key required — same provider as the
weather forecast connector). Replaces the need for OpenAQ (which now
requires an API key) for cross-border haze monitoring context.

Upserts into region_air_quality: one row per region (latest snapshot).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from asyncpg import Pool

logger = logging.getLogger(__name__)

AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
REQUEST_TIMEOUT_SECONDS = 15.0
ATTRIBUTION = "Open-Meteo Air Quality (CAMS)"

# Must mirror regions_situation.go regionDefinitions.
REGION_CENTROIDS: list[dict[str, Any]] = [
    {"code": "sumatera", "lat": -0.5, "lng": 101.5},
    {"code": "jawa", "lat": -7.0, "lng": 110.0},
    {"code": "kalimantan", "lat": -0.5, "lng": 114.0},
    {"code": "sulawesi", "lat": -2.0, "lng": 121.5},
    {"code": "bali-ntb", "lat": -8.3, "lng": 117.0},
    {"code": "ntt", "lat": -9.7, "lng": 122.5},
    {"code": "maluku", "lat": -3.5, "lng": 129.5},
    {"code": "papua", "lat": -4.5, "lng": 136.0},
]


def us_aqi_category(aqi: int | None) -> str:
    """US AQI -> label kategori Indonesia."""
    if aqi is None:
        return "—"
    if aqi <= 50:
        return "Baik"
    if aqi <= 100:
        return "Sedang"
    if aqi <= 150:
        return "Tidak Sehat (rentan)"
    if aqi <= 200:
        return "Tidak Sehat"
    if aqi <= 300:
        return "Sangat Tidak Sehat"
    return "Berbahaya"


async def fetch_region_air_quality(
    client: httpx.AsyncClient, lat: float, lng: float
) -> dict[str, Any] | None:
    """Fetch current-hour air quality for one point."""
    resp = await client.get(
        AIR_QUALITY_URL,
        params={
            "latitude": lat,
            "longitude": lng,
            "hourly": "pm10,pm2_5,us_aqi",
            "timezone": "Asia/Jakarta",
            "forecast_days": 1,
        },
    )
    resp.raise_for_status()
    payload = resp.json()
    hourly = payload.get("hourly") or {}
    times = hourly.get("time") or []
    if not times:
        return None

    # Ambil jam terdekat dgn sekarang (index 0 = jam ini / jam depan).
    now_hour = datetime.now(timezone.utc).hour
    idx = min(now_hour, len(times) - 1)
    return {
        "pm25": hourly.get("pm2_5", [None] * (idx + 1))[idx],
        "pm10": hourly.get("pm10", [None] * (idx + 1))[idx],
        "us_aqi": hourly.get("us_aqi", [None] * (idx + 1))[idx],
    }


async def sync_region_air_quality(pool: Pool) -> dict[str, int]:
    """Fetch AQI per region and upsert (latest snapshot per region)."""
    fetched = 0
    upserted = 0
    now = datetime.now(timezone.utc)
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        for region in REGION_CENTROIDS:
            try:
                data = await fetch_region_air_quality(client, region["lat"], region["lng"])
                if not data:
                    continue
                fetched += 1
                aqi = int(data["us_aqi"]) if data["us_aqi"] is not None else None
                async with pool.acquire() as conn:
                    await conn.execute(
                        """
                        INSERT INTO region_air_quality
                          (region_code, pm25, pm10, us_aqi, aqi_category, fetched_at)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        ON CONFLICT (region_code) DO UPDATE SET
                          pm25 = EXCLUDED.pm25,
                          pm10 = EXCLUDED.pm10,
                          us_aqi = EXCLUDED.us_aqi,
                          aqi_category = EXCLUDED.aqi_category,
                          fetched_at = EXCLUDED.fetched_at
                        """,
                        region["code"],
                        data["pm25"],
                        data["pm10"],
                        aqi,
                        us_aqi_category(aqi),
                        now,
                    )
                    upserted += 1
            except Exception as exc:
                logger.warning("Air quality fetch failed for %s: %s", region["code"], exc)
    return {"fetched": fetched, "upserted": upserted}

# Hub ASEAN zona dampak asap lintas batas (S8-P6 → P7c: sumber diganti
# ke CAMS live karena stasiun ground OpenAQ mayoritas usang >30 hari).
ASEAN_HUBS: list[dict[str, Any]] = [
    {"code": "kuching", "name": "Kuching (Sarawak)", "lat": 1.55, "lng": 110.34, "country": "MY"},
    {"code": "kota-kinabalu", "name": "Kota Kinabalu (Sabah)", "lat": 5.98, "lng": 116.07, "country": "MY"},
    {"code": "kl", "name": "Kuala Lumpur", "lat": 3.14, "lng": 101.69, "country": "MY"},
    {"code": "singapore", "name": "Singapura", "lat": 1.35, "lng": 103.82, "country": "SG"},
    {"code": "johor", "name": "Johor Bahru", "lat": 1.49, "lng": 103.74, "country": "MY"},
    {"code": "penang", "name": "Penang", "lat": 5.41, "lng": 100.33, "country": "MY"},
    {"code": "brunei", "name": "Bandar Seri Begawan", "lat": 4.89, "lng": 114.94, "country": "BN"},
    {"code": "hat-yai", "name": "Hat Yai (S. Thailand)", "lat": 7.01, "lng": 100.47, "country": "TH"},
]


async def sync_asean_air_quality_cams(pool: Pool) -> dict[str, int]:
    """Sync kualitas udara 8 hub ASEAN via Open-Meteo CAMS (batch, live).

    Menggantikan stasiun ground OpenAQ utk panel lintas batas: data
    ground mayoritas usang (>30 hari) sehingga menyesatkan; CAMS
    memberi nilai jam-ini konsisten dgn panel wilayah domestik.
    """
    lats = ",".join(str(h["lat"]) for h in ASEAN_HUBS)
    lngs = ",".join(str(h["lng"]) for h in ASEAN_HUBS)
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.get(
            AIR_QUALITY_URL,
            params={
                "latitude": lats, "longitude": lngs,
                "hourly": "pm2_5,pm10,us_aqi",
                "timezone": "Asia/Jakarta", "forecast_days": 1,
            },
        )
        resp.raise_for_status()
        payloads = resp.json()
        if isinstance(payloads, dict):
            payloads = [payloads]

    now = datetime.now(timezone.utc)
    upserted = 0
    # Bersihkan hub OpenAQ ground lama (jakarta-bmkg) — domestik sudah
    # terwakili panel Situasi Wilayah; panel ini khusus lintas batas.
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM asean_air_quality WHERE hub_code = 'jakarta-bmkg'")
    for hub, payload in zip(ASEAN_HUBS, payloads):
        hourly = payload.get("hourly") or {}
        times = hourly.get("time") or []
        if not times:
            continue
        # parse batch (format per-lokasi sama dgn single)
        now_hour = datetime.now(timezone.utc).hour
        idx = min(now_hour, len(times) - 1)
        pm25 = (hourly.get("pm2_5") or [None] * (idx + 1))[idx]
        pm10 = (hourly.get("pm10") or [None] * (idx + 1))[idx]
        aqi_raw = (hourly.get("us_aqi") or [None] * (idx + 1))[idx]
        if pm25 is None and aqi_raw is None:
            continue
        aqi = int(aqi_raw) if aqi_raw is not None else None
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO asean_air_quality
                  (hub_code, hub_name, country, station_name, station_id,
                   pm25, aqi_category, measured_at, fetched_at, stale_after_hours)
                VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, 6)
                ON CONFLICT (hub_code) DO UPDATE SET
                  hub_name = EXCLUDED.hub_name,
                  country = EXCLUDED.country,
                  station_name = EXCLUDED.station_name,
                  pm25 = EXCLUDED.pm25,
                  aqi_category = EXCLUDED.aqi_category,
                  measured_at = EXCLUDED.measured_at,
                  fetched_at = EXCLUDED.fetched_at,
                  stale_after_hours = EXCLUDED.stale_after_hours
                """,
                hub["code"], hub["name"], hub["country"],
                "CAMS satelit (model)", pm25, us_aqi_category(aqi),
                now, now,
            )
            upserted += 1
    return {"fetched": len(payloads), "upserted": upserted}
