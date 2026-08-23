"""Open-Meteo weather forecast connector (S8-P1).

Fetches multi-model daily forecasts (ECMWF/GFS/ICON blend) for the 8
Indonesian region centroids used by /api/v1/regions/situation. Free,
no API key required (https://open-meteo.com/, CC-BY 4.0 attribution).

Upgrades weather_forecasts table: one row per (region_code, forecast_date).
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any

import httpx
from asyncpg import Pool

logger = logging.getLogger(__name__)

OPEN_METEO_BASE_URL = "https://api.open-meteo.com/v1/forecast"
REQUEST_TIMEOUT_SECONDS = 15.0
ATTRIBUTION = "Open-Meteo (CC-BY 4.0)"

# Must mirror apps/api/internal/http/regions_situation.go regionDefinitions.
REGION_CENTROIDS: list[dict[str, Any]] = [
    {"code": "sumatera", "name": "Sumatera", "lat": -0.5, "lon": 101.5},
    {"code": "jawa", "name": "Jawa", "lat": -7.0, "lon": 110.0},
    {"code": "kalimantan", "name": "Kalimantan", "lat": -0.5, "lon": 114.0},
    {"code": "sulawesi", "name": "Sulawesi", "lat": -2.0, "lon": 121.5},
    {"code": "bali-ntb", "name": "Bali & Nusa Tenggara Barat", "lat": -8.3, "lon": 117.0},
    {"code": "ntt", "name": "Nusa Tenggara Timur", "lat": -9.7, "lon": 122.5},
    {"code": "maluku", "name": "Maluku", "lat": -3.5, "lon": 129.5},
    {"code": "papua", "name": "Papua", "lat": -4.5, "lon": 136.0},
]

# WMO weather interpretation codes -> label ringkas Indonesia.
WMO_LABELS: dict[int, str] = {
    0: "Cerah", 1: "Cerah berawan", 2: "Berawan", 3: "Mendung",
    45: "Berkabut", 48: "Kabut membeku",
    51: "Gerimis ringan", 53: "Gerimis", 55: "Gerimis lebat",
    61: "Hujan ringan", 63: "Hujan", 65: "Hujan lebat",
    66: "Hujan membeku", 67: "Hujan membeku lebat",
    71: "Salju ringan", 73: "Salju", 75: "Salju lebat",
    80: "Hujan lokal", 81: "Hujan lokal", 82: "Hujan lokal hebat",
    95: "Badai petir", 96: "Badai petir + hujan es", 99: "Badai petir hebat",
}


def wmo_label(code: int | None) -> str:
    if code is None:
        return "—"
    return WMO_LABELS.get(code, f"Kode {code}")


async def fetch_region_forecast(
    client: httpx.AsyncClient, lat: float, lon: float, days: int = 3
) -> dict[str, Any] | None:
    """Fetch daily forecast for one point; returns parsed dict or None."""
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": "precipitation_probability_max,precipitation_sum,wind_speed_10m_max,weather_code",
        "timezone": "Asia/Jakarta",
        "forecast_days": days,
    }
    resp = await client.get(OPEN_METEO_BASE_URL, params=params)
    resp.raise_for_status()
    return resp.json()


def parse_forecast(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Parse Open-Meteo daily payload into per-day rows."""
    daily = payload.get("daily") or {}
    times = daily.get("time") or []
    rain_prob = daily.get("precipitation_probability_max") or []
    rain_sum = daily.get("precipitation_sum") or []
    wind_max = daily.get("wind_speed_10m_max") or []
    codes = daily.get("weather_code") or []
    rows: list[dict[str, Any]] = []
    for i, day_str in enumerate(times):
        rows.append({
            "forecast_date": date.fromisoformat(day_str),
            "rain_probability": rain_prob[i] if i < len(rain_prob) else None,
            "rain_sum_mm": rain_sum[i] if i < len(rain_sum) else None,
            "wind_max_kmh": wind_max[i] if i < len(wind_max) else None,
            "weather_code": codes[i] if i < len(codes) else None,
            "weather_label": wmo_label(codes[i] if i < len(codes) else None),
        })
    return rows


async def sync_weather_forecasts(pool: Pool) -> dict[str, int]:
    """Fetch forecasts for all 8 regions and upsert into weather_forecasts."""
    fetched = 0
    upserted = 0
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        for region in REGION_CENTROIDS:
            try:
                payload = await fetch_region_forecast(client, region["lat"], region["lon"])
                if not payload:
                    continue
                fetched += 1
                rows = parse_forecast(payload)
                now = datetime.now(timezone.utc)
                async with pool.acquire() as conn:
                    for row in rows:
                        await conn.execute(
                            """
                            INSERT INTO weather_forecasts
                              (region_code, forecast_date, rain_probability,
                               rain_sum_mm, wind_max_kmh, weather_code, weather_label,
                               fetched_at)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                            ON CONFLICT (region_code, forecast_date) DO UPDATE SET
                              rain_probability = EXCLUDED.rain_probability,
                              rain_sum_mm = EXCLUDED.rain_sum_mm,
                              wind_max_kmh = EXCLUDED.wind_max_kmh,
                              weather_code = EXCLUDED.weather_code,
                              weather_label = EXCLUDED.weather_label,
                              fetched_at = EXCLUDED.fetched_at
                            """,
                            region["code"],
                            row["forecast_date"],
                            row["rain_probability"],
                            row["rain_sum_mm"],
                            row["wind_max_kmh"],
                            row["weather_code"],
                            row["weather_label"],
                            now,
                        )
                        upserted += 1
            except Exception as exc:
                logger.warning(
                    "Open-Meteo fetch failed for %s: %s", region["code"], exc
                )
    return {"fetched": fetched, "upserted": upserted}
