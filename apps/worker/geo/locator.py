"""Location extraction orchestrator: gazetteer → Nominatim fallback."""

from __future__ import annotations

import asyncpg

from geo.gazetteer import gazetteer_match
from geo.nominatim import extract_candidate_place, nominatim_geocode


async def extract_location(
    title: str, summary: str, pool: asyncpg.Pool | None = None
) -> tuple[str, float, float] | None:
    """Return ``(place_name, lat, lon)`` or *None*.

    Tries gazetteer first (no DB needed), then falls back to Nominatim
    geocoding (requires *pool*).
    """
    text = title + " " + summary
    result = gazetteer_match(text)
    if result:
        return result
    candidate = extract_candidate_place(title)  # title only — less noise
    if candidate and pool:
        return await nominatim_geocode(candidate, pool)
    return None


__all__ = [
    "extract_location",
]
