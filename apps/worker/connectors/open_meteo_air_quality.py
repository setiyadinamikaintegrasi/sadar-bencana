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
