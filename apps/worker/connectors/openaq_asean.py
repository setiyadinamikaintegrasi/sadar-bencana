"""OpenAQ ASEAN transboundary haze connector (S8-P6).

Fetches ground-station air quality measurements from OpenAQ v3
(requires OPENAQ_API_KEY) for stations in neighboring countries
(Malaysia, Singapore, Brunei, Thailand) — the transboundary haze
impact zone for Indonesian wildfire smoke.

Complements the Open-Meteo AQ connector (model/satellite CAMS) with
real ground measurements: "smoke from Kalimantan fires has reached
Kuching AQI 180" — critical regional impact narrative for reinsurance.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx
from asyncpg import Pool

logger = logging.getLogger(__name__)

OPENAQ_BASE_URL = "https://api.openaq.org/v3"
REQUEST_TIMEOUT_SECONDS = 15.0
ATTRIBUTION = "OpenAQ (CC BY 4.0)"

# Stasiun ASEAN pemantau dampak asap lintas batas (radius pencarian 25km per hub dari
# pusat Kalimantan/Sumatera). OpenAQ coordinates+radius search.
ASEAN_STATION_HUBS: list[dict[str, Any]] = [
    # Kalimantan smoke impact zone
    {"code": "kuching", "name": "Kuching (Sarawak)", "lat": 1.55, "lon": 110.34, "country": "MY"},
    {"code": "kota-kinabalu", "name": "Kota Kinabalu (Sabah)", "lat": 5.98, "lon": 116.07, "country": "MY"},
    {"code": "kl", "name": "Kuala Lumpur", "lat": 3.14, "lon": 101.69, "country": "MY"},
    # Sumatera smoke impact zone
    {"code": "singapore", "name": "Singapore", "lat": 1.35, "lon": 103.82, "country": "SG"},
    {"code": "johor", "name": "Johor Bahru", "lat": 1.49, "lon": 103.74, "country": "MY"},
    {"code": "penang", "name": "Penang", "lat": 5.41, "lon": 100.33, "country": "MY"},
    # Regional
    {"code": "brunei", "name": "Bandar Seri Begawan", "lat": 4.89, "lon": 114.94, "country": "BN"},
    {"code": "hat-yai", "name": "Hat Yai (S. Thailand)", "lat": 7.01, "lon": 100.47, "country": "TH"},
]


def get_api_key() -> str:
    return os.environ.get("OPENAQ_API_KEY", "")


async def fetch_nearest_measurement(
    client: httpx.AsyncClient, api_key: str, lat: float, lon: float
) -> dict[str, Any] | None:
    """Fetch latest PM2.5 measurement from the nearest station."""
    resp = await client.get(
        f"{OPENAQ_BASE_URL}/locations",
        params={"coordinates": f"{lat},{lon}", "radius": "25000", "limit": 5},
        headers={"X-API-Key": api_key},
    )
    resp.raise_for_status()
    payload = resp.json()
    results = payload.get("results") or []
    if not results:
        return None

    # Ambil location terdekat yang punya sensor pm25.
    for location in results:
        loc_id = location.get("id")
        if not loc_id:
            continue
        sensors = location.get("sensors") or []
        pm25_sensor = next((s for s in sensors if s.get("parameter", {}).get("name") == "pm25"), None)
        if not pm25_sensor:
            continue
        sensor_id = pm25_sensor.get("id")
        if not sensor_id:
            continue

        # Fetch latest measurement utk sensor ini.
        meas_resp = await client.get(
            f"{OPENAQ_BASE_URL}/sensors/{sensor_id}/measurements",
            params={"limit": 1, "sort": "desc"},
            headers={"X-API-Key": api_key},
        )
        meas_resp.raise_for_status()
        meas = (meas_resp.json().get("results") or [{}])[0]
        value = meas.get("value")
        if value is None:
            continue
        return {
            "station_name": location.get("name", ""),
            "station_id": loc_id,
            "pm25": float(value),
            "measured_at": meas.get("datetime", {}).get("utc"),
        }
    return None


def pm25_to_aqi_category(pm25: float) -> str:
    """PM2.5 (µg/m³) -> kategori ringkas (EPA breakpoints)."""
    if pm25 <= 12.0:
        return "Baik"
    if pm25 <= 35.4:
        return "Sedang"
    if pm25 <= 55.4:
        return "Tidak Sehat (rentan)"
    if pm25 <= 150.4:
        return "Tidak Sehat"
    if pm25 <= 250.4:
        return "Sangat Tidak Sehat"
    return "Berbahaya"


async def sync_openaq_asean(pool: Pool) -> dict[str, int]:
    """Fetch latest PM2.5 from ASEAN stations; upsert snapshot."""
    api_key = get_api_key()
    if not api_key:
        logger.info("OpenAQ: OPENAQ_API_KEY tidak diset — skip sync.")
        return {"fetched": 0, "upserted": 0, "skipped": True}

    fetched = 0
    upserted = 0
    now = datetime.now(timezone.utc)
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        for hub in ASEAN_STATION_HUBS:
            try:
                data = await fetch_nearest_measurement(client, api_key, hub["lat"], hub["lon"])
                if not data:
                    continue
                fetched += 1
                category = pm25_to_aqi_category(data["pm25"])
                async with pool.acquire() as conn:
                    await conn.execute(
                        """
                        INSERT INTO asean_air_quality
                          (hub_code, hub_name, country, station_name, station_id,
                           pm25, aqi_category, measured_at, fetched_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9)
                        ON CONFLICT (hub_code) DO UPDATE SET
                          hub_name = EXCLUDED.hub_name,
                          country = EXCLUDED.country,
                          station_name = EXCLUDED.station_name,
                          station_id = EXCLUDED.station_id,
                          pm25 = EXCLUDED.pm25,
                          aqi_category = EXCLUDED.aqi_category,
                          measured_at = EXCLUDED.measured_at,
                          fetched_at = EXCLUDED.fetched_at
                        """,
                        hub["code"], hub["name"], hub["country"],
                        data["station_name"], data["station_id"],
                        data["pm25"], category,
                        data["measured_at"], now,
                    )
                    upserted += 1
            except Exception as exc:
                logger.warning("OpenAQ fetch failed for %s: %s", hub["code"], exc)
    return {"fetched": fetched, "upserted": upserted}
