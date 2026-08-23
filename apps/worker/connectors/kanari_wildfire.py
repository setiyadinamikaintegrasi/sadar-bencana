"""Kanari wildfire cluster connector (S8-P2).

Fetches aggregated global fire clusters from kanari.io (VIIRS + GOES +
Meteosat MTG satellite detections, cross-checked witness confidence).
Free, no API key. Licensed CC BY 4.0 (https://kanari.io/en/api).

Distinct value vs NASA FIRMS (point hotspots): kanari returns
*aggregated clusters* with multi-sensor counts, max FRP, confidence
levels (possible/probable/corrobore), and first/last-seen windows —
a corroboration layer for the existing FIRMS feed.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from asyncpg import Pool

logger = logging.getLogger(__name__)

KANARI_EVENTS_URL = "https://kanari.io/api/events"
REQUEST_TIMEOUT_SECONDS = 25.0
ATTRIBUTION = "Kanari (CC BY 4.0) — VIIRS, GOES, Meteosat MTG"
CONFIDENCE_RANK = {"possible": 1, "probable": 2, "corrobore": 3}

# Bounding box Indonesia (luas: Maluku/Papua termasuk).
INDONESIA_BBOX = {"min_lon": 94.0, "min_lat": -11.5, "max_lon": 141.5, "max_lat": 7.5}

# Simpan maksimum N klaster terkuat per sync (urut count desc).
MAX_PERSISTED_CLUSTERS = 500


async def fetch_fire_clusters(
    client: httpx.AsyncClient, hours: int = 24
) -> list[dict[str, Any]]:
    """Fetch aggregated fire clusters; return list filtered to Indonesia."""
    resp = await client.get(
        KANARI_EVENTS_URL, params={"hours": str(hours)}
    )
    resp.raise_for_status()
    payload = resp.json()
    events = payload.get("events") or []
    bbox = INDONESIA_BBOX
    filtered = []
    for event in events:
        centroid = event.get("centroid") or []
        if len(centroid) < 2:
            continue
        lon, lat = float(centroid[0]), float(centroid[1])
        if not (bbox["min_lon"] <= lon <= bbox["max_lon"]
                and bbox["min_lat"] <= lat <= bbox["max_lat"]):
            continue
        confidence = str(event.get("confidence") or "possible")
        filtered.append({
            "cluster_id": str(event.get("id") or f"{lat:.3f},{lon:.3f}"),
            "longitude": lon,
            "latitude": lat,
            "detection_count": int(event.get("count") or 0),
            "viirs_count": int(event.get("viirsCount") or 0),
            "goes_count": int(event.get("goesCount") or 0),
            "mtg_count": int(event.get("mtgCount") or 0),
            "max_frp_mw": float(event["maxFrp"]) if event.get("maxFrp") is not None else None,
            "confidence": confidence if confidence in CONFIDENCE_RANK else "possible",
            "first_seen_at": _parse_ts(event.get("firstSeen")),
            "last_seen_at": _parse_ts(event.get("lastSeen")),
        })
    # Prioritaskan klaster terkuat: count desc lalu frp desc.
    filtered.sort(key=lambda e: (e["detection_count"], e["max_frp_mw"] or 0), reverse=True)
    return filtered[:MAX_PERSISTED_CLUSTERS]


def _parse_ts(raw: Any) -> datetime | None:
    if not raw or not isinstance(raw, str):
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


async def sync_kanari_fire_clusters(pool: Pool) -> dict[str, int]:
    """Fetch kanari clusters and refresh kanari_fire_clusters table.

    Strategy: full refresh (delete + insert) in a transaction — the table
    is a moving snapshot of active clusters, not an append-only log.
    """
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        clusters = await fetch_fire_clusters(client, hours=24)

    now = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM kanari_fire_clusters")
            for cluster in clusters:
                await conn.execute(
                    """
                    INSERT INTO kanari_fire_clusters
                      (cluster_id, longitude, latitude, detection_count,
                       viirs_count, goes_count, mtg_count, max_frp_mw,
                       confidence, first_seen_at, last_seen_at, fetched_at)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                    """,
                    cluster["cluster_id"],
                    cluster["longitude"],
                    cluster["latitude"],
                    cluster["detection_count"],
                    cluster["viirs_count"],
                    cluster["goes_count"],
                    cluster["mtg_count"],
                    cluster["max_frp_mw"],
                    cluster["confidence"],
                    cluster["first_seen_at"],
                    cluster["last_seen_at"],
                    now,
                )
    return {"fetched": len(clusters), "persisted": len(clusters)}
