"""Sunrise/Sunset operational context connector (S8-P3).

Fetches day/night window per region centroid from sunrise-sunset.org
(free, no key). Powers operational context: remaining daylight hours
for firefighting/evacuation, night-operations risk flag.

Upserts into region_daylight table: one row per (region_code, date).
"""

from __future__ import annotations

import logging
from datetime import date, datetime, time, timezone
from typing import Any

import httpx
from asyncpg import Pool

logger = logging.getLogger(__name__)

SUNRISE_SUNSET_URL = "https://api.sunrise-sunset.org/json"
REQUEST_TIMEOUT_SECONDS = 10.0

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


def parse_hms(raw: str | None) -> time | None:
    """Parse '5:22:39 AM' (12h format from sunrise-sunset.org) to time."""
    if not raw or not isinstance(raw, str):
        return None
    raw = raw.strip().upper()
    try:
        parts = raw.split(":")
        if len(parts) != 3:
            return None
        hour = int(parts[0])
        minute = int(parts[1])
        second = int(parts[2].split()[0])
        if "PM" in raw and hour != 12:
            hour += 12
        if "AM" in raw and hour == 12:
            hour = 0
        if not (0 <= hour <= 23 and 0 <= minute <= 59 and 0 <= second <= 59):
            return None
        return time(hour, minute, second)
    except (ValueError, IndexError):
        return None


def parse_day_length(raw: str | None) -> int | None:
    """Parse '12:08:08' to seconds."""
    if not raw:
        return None
    parts = raw.split(":")
    if len(parts) != 3:
        return None
    try:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    except ValueError:
        return None


async def fetch_daylight(
    client: httpx.AsyncClient, lat: float, lng: float, target: date
) -> dict[str, Any] | None:
    """Fetch sunrise/sunset for one point; returns parsed fields or None."""
    resp = await client.get(
        SUNRISE_SUNSET_URL,
        params={"lat": lat, "lng": lng, "date": target.isoformat(), "tzid": "Asia/Jakarta"},
    )
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("status") != "OK":
        return None
    results = payload.get("results") or {}
    return {
        "sunrise": parse_hms(results.get("sunrise")),
        "sunset": parse_hms(results.get("sunset")),
        "civil_twilight_begin": parse_hms(results.get("civil_twilight_begin")),
        "civil_twilight_end": parse_hms(results.get("civil_twilight_end")),
        "day_length_seconds": parse_day_length(results.get("day_length")),
    }


async def sync_region_daylight(pool: Pool) -> dict[str, int]:
    """Fetch daylight window for all 8 regions (today + tomorrow) and upsert."""
    from datetime import timedelta

    fetched = 0
    upserted = 0
    today = date.today()
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        for region in REGION_CENTROIDS:
            for offset in (0, 1):  # hari ini + besok
                target = today + timedelta(days=offset)
                try:
                    data = await fetch_daylight(client, region["lat"], region["lng"], target)
                    if not data:
                        continue
                    fetched += 1
                    now = datetime.now(timezone.utc)
                    async with pool.acquire() as conn:
                        await conn.execute(
                            """
                            INSERT INTO region_daylight
                              (region_code, date, sunrise, sunset,
                               civil_twilight_begin, civil_twilight_end,
                               day_length_seconds, fetched_at)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                            ON CONFLICT (region_code, date) DO UPDATE SET
                              sunrise = EXCLUDED.sunrise,
                              sunset = EXCLUDED.sunset,
                              civil_twilight_begin = EXCLUDED.civil_twilight_begin,
                              civil_twilight_end = EXCLUDED.civil_twilight_end,
                              day_length_seconds = EXCLUDED.day_length_seconds,
                              fetched_at = EXCLUDED.fetched_at
                            """,
                            region["code"], target,
                            data["sunrise"], data["sunset"],
                            data["civil_twilight_begin"], data["civil_twilight_end"],
                            data["day_length_seconds"], now,
                        )
                        upserted += 1
                except Exception as exc:
                    logger.warning(
                        "Sunrise-sunset fetch failed for %s %s: %s",
                        region["code"], target, exc,
                    )
    return {"fetched": fetched, "upserted": upserted}
