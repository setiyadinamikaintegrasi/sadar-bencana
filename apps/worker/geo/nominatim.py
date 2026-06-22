"""Nominatim geocoder with geocode_cache DB table as persistent cache."""

from __future__ import annotations

import asyncio
import logging
import re

import asyncpg
import httpx

logger = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "tugure-risk-monitor/1.0 (setiyadijoko@gmail.com)"

# Regex patterns for Indonesian location extraction from news headlines
_PLACE_PATTERNS = [
    r"di ([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?)",
    r"([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?) dilanda",
    r"([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?) terdampak",
    r"([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?) diterjang",
]


def extract_candidate_place(text: str) -> str | None:
    """Extract a candidate place name from *text* using heuristics, or None."""
    for pattern in _PLACE_PATTERNS:
        m = re.search(pattern, text)
        if m:
            return m.group(1)
    return None


async def nominatim_geocode(
    place: str, pool: asyncpg.Pool
) -> tuple[str, float, float] | None:
    """Geocode *place* via Nominatim, caching in geocode_cache table.

    Returns ``(place, lat, lon)`` or *None*.
    """
    # Check cache first
    async with pool.acquire() as conn:
        cached = await conn.fetchrow(
            "SELECT lat, lon FROM geocode_cache WHERE query_text = $1", place
        )
        if cached:
            if cached["lat"] is None:
                return None  # known-bad entry
            return (place, cached["lat"], cached["lon"])

    await asyncio.sleep(1.0)  # Nominatim rate limit: 1 req/sec
    try:
        async with httpx.AsyncClient(
            headers={"User-Agent": USER_AGENT}, timeout=10.0
        ) as client:
            resp = await client.get(
                NOMINATIM_URL,
                params={
                    "q": place,
                    "countrycodes": "id",
                    "format": "json",
                    "limit": 1,
                },
            )
            resp.raise_for_status()
            results = resp.json()
    except Exception as exc:
        logger.warning("Nominatim failed for '%s': %s", place, exc)
        return None

    lat_val: float | None = float(results[0]["lat"]) if results else None
    lon_val: float | None = float(results[0]["lon"]) if results else None

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO geocode_cache (query_text, lat, lon) "
            "VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
            place,
            lat_val,
            lon_val,
        )

    if lat_val is not None:
        return (place, lat_val, lon_val)  # type: ignore[return-value]
    return None


__all__ = [
    "extract_candidate_place",
    "nominatim_geocode",
]
