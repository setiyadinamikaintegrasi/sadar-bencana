"""Database operations for marine vessel and aircraft asset positions."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import asyncpg

from connectors.aisstream import VesselPosition
from connectors.opensky import AircraftPosition

logger = logging.getLogger(__name__)


async def upsert_vessels(pool: asyncpg.Pool, vessels: list[VesselPosition]) -> int:
    """Upsert vessel positions into vessel_positions table."""

    if not vessels:
        return 0

    rows = [
        (
            v.mmsi,
            v.name,
            v.ship_type,
            v.latitude,
            v.longitude,
            v.sog,
            v.cog,
            v.heading,
            v.nav_status,
            v.timestamp,
            v.source,
        )
        for v in vessels
    ]

    try:
        await pool.executemany(
            """
            INSERT INTO vessel_positions
                (mmsi, name, ship_type, latitude, longitude,
                 sog, cog, heading, nav_status, timestamp, source)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (mmsi) DO UPDATE SET
                name = EXCLUDED.name,
                ship_type = EXCLUDED.ship_type,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                sog = EXCLUDED.sog,
                cog = EXCLUDED.cog,
                heading = EXCLUDED.heading,
                nav_status = EXCLUDED.nav_status,
                timestamp = EXCLUDED.timestamp,
                source = EXCLUDED.source
            """,
            rows,
        )
        count = len(rows)
        logger.info("Upserted %d vessel positions", count)
        return count
    except Exception as e:
        logger.error("Failed to upsert vessels: %s", e)
        raise


async def fetch_vessels(pool: asyncpg.Pool, limit: int = 500) -> list[dict]:
    """Fetch latest vessel positions."""

    rows = await pool.fetch(
        """
        SELECT mmsi, name, ship_type, latitude, longitude,
               sog, cog, heading, timestamp, source
        FROM vessel_positions
        ORDER BY timestamp DESC
        LIMIT $1
        """,
        limit,
    )
    return [dict(r) for r in rows]


async def upsert_aircraft(pool: asyncpg.Pool, aircraft: list[AircraftPosition]) -> int:
    """Upsert aircraft positions into aircraft_positions table."""

    if not aircraft:
        return 0

    rows = [
        (
            a.icao24,
            a.callsign,
            a.origin_country,
            a.latitude,
            a.longitude,
            a.altitude,
            a.velocity,
            a.heading,
            a.on_ground,
            a.vertical_rate,
            a.timestamp,
            "opensky",
        )
        for a in aircraft
    ]

    try:
        await pool.executemany(
            """
            INSERT INTO aircraft_positions
                (icao24, callsign, origin_country, latitude, longitude,
                 altitude, velocity, heading, on_ground, vertical_rate,
                 timestamp, source)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (icao24) DO UPDATE SET
                callsign = EXCLUDED.callsign,
                origin_country = EXCLUDED.origin_country,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                altitude = EXCLUDED.altitude,
                velocity = EXCLUDED.velocity,
                heading = EXCLUDED.heading,
                on_ground = EXCLUDED.on_ground,
                vertical_rate = EXCLUDED.vertical_rate,
                timestamp = EXCLUDED.timestamp,
                source = EXCLUDED.source
            """,
            rows,
        )
        count = len(rows)
        logger.info("Upserted %d aircraft positions", count)
        return count
    except Exception as e:
        logger.error("Failed to upsert aircraft: %s", e)
        raise


async def fetch_aircraft(pool: asyncpg.Pool, limit: int = 500) -> list[dict]:
    """Fetch latest aircraft positions."""

    rows = await pool.fetch(
        """
        SELECT icao24, callsign, origin_country, latitude, longitude,
               altitude, velocity, heading, on_ground, timestamp
        FROM aircraft_positions
        ORDER BY timestamp DESC
        LIMIT $1
        """,
        limit,
    )
    return [dict(r) for r in rows]
