"""Google Flood Hub connector (S9-P1).

Fetches riverine flood gauge forecasts from the Google Flood Hub API
(floodhub.googleapis.com — requires GOOGLE_FLOOD_HUB_API_KEY, free GCP
tier). Indonesia is covered by Flood Hub (verified against the official
country list). This gives SadarBencana flood *forecasting* (up to 7 days
ahead per river gauge) to complement PetaBencana real-time reports.

Gracefully skips when GOOGLE_FLOOD_HUB_API_KEY is not set (same proven
pattern as the OpenAQ connector).
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx
from asyncpg import Pool

logger = logging.getLogger(__name__)

FLOOD_HUB_BASE_URL = "https://floodhub.googleapis.com/v1"
REQUEST_TIMEOUT_SECONDS = 20.0
ATTRIBUTION = "Google Flood Hub"

# Bounding box Indonesia (luas: Sumatera s.d. Papua).
INDONESIA_BBOX = {"min_lon": 94.0, "min_lat": -11.5, "max_lon": 141.5, "max_lat": 7.5}

# Rating curve severity -> label Indonesia.
SEVERITY_LABELS: dict[int, str] = {
    1: "Normal",
    2: "Waspada",
    3: "Bahaya",
    4: "Bahaya Ekstrem",
}


def get_api_key() -> str:
    return os.environ.get("GOOGLE_FLOOD_HUB_API_KEY", "")


def severity_label(severity: int | None) -> str:
    if severity is None:
        return "—"
    return SEVERITY_LABELS.get(int(severity), f"Level {severity}")


def _in_indonesia(lat: float, lon: float) -> bool:
    bbox = INDONESIA_BBOX
    return bbox["min_lon"] <= lon <= bbox["max_lon"] and bbox["min_lat"] <= lat <= bbox["max_lat"]


def _parse_ts(raw: str | None) -> datetime | None:
    if not raw or not isinstance(raw, str):
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


async def fetch_gauges(client: httpx.AsyncClient, api_key: str) -> list[dict[str, Any]]:
    """Fetch all gauges (paginated), filter to Indonesia bbox."""
    gauges: list[dict[str, Any]] = []
    page_token: str | None = None
    for _ in range(10):  # guard: maks 10 halaman
        params: dict[str, Any] = {"pageSize": 500}
        if page_token:
            params["pageToken"] = page_token
        resp = await client.get(
            f"{FLOOD_HUB_BASE_URL}/gauges",
            params=params,
            headers={"X-Goog-Api-Key": api_key},
        )
        resp.raise_for_status()
        payload = resp.json()
        for g in payload.get("gauges", []):
            gauge_id = g.get("gaugeId", {})
            loc = g.get("location", {}) or {}
            lat = float(loc.get("latitude") or 0)
            lon = float(loc.get("longitude") or 0)
            if lat == 0 and lon == 0:
                continue
            if not _in_indonesia(lat, lon):
                continue
            gauges.append({
                "gauge_id": gauge_id.get("gaugeId", ""),
                "latitude": lat,
                "longitude": lon,
                "river_name": (g.get("riverName") or "").strip(),
                "station_name": (g.get("stationName") or gauge_id.get("gaugeId", "")).strip(),
                "site_name": (g.get("siteName") or "").strip(),
                "state": (g.get("state") or "").strip(),
                "country": "ID",
            })
        page_token = payload.get("nextPageToken")
        if not page_token:
            break
    return gauges


async def fetch_latest_forecast(
    client: httpx.AsyncClient, api_key: str, gauge_id: str
) -> dict[str, Any] | None:
    """Fetch the newest issued forecast for one gauge."""
    # Flood Hub: /v1/gauges/{gaugeId}/forecasts list of issued forecasts;
    # ambil issued_at terbaru lalu detail-nya.
    resp = await client.get(
        f"{FLOOD_HUB_BASE_URL}/gauges/{gauge_id}/forecasts",
        params={"pageSize": 5},
        headers={"X-Goog-Api-Key": api_key},
    )
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    payload = resp.json()
    forecasts = payload.get("forecasts", [])
    if not forecasts:
        return None
    latest = max(
        forecasts,
        key=lambda f: f.get("issuedTime", "") or "",
    )
    severity = latest.get("rainfallProbabilities") or {}
    # Struktur alternatif umum: todayProbabilityOfExceedanceLevel {sev2yr, sev5yr...}
    exceed = latest.get("todayProbabilityOfExceedanceLevel") or {}
    return {
        "gauge_id": gauge_id,
        "issued_at": _parse_ts(latest.get("issuedTime")),
        "severity_level": latest.get("severityLevel"),
        # value = estimasi tinggi muka air (m) bila tersedia
        "value": latest.get("value"),
        "threshold_sev_2yr": (exceed.get("sev2yr") or 0) or None,
        "threshold_sev_5yr": (exceed.get("sev5yr") or 0) or None,
    }


async def sync_flood_hub(pool: Pool) -> dict[str, int]:
    """Fetch Indonesia gauges + latest forecasts; upsert snapshot."""
    api_key = get_api_key()
    if not api_key:
        logger.info("Flood Hub: GOOGLE_FLOOD_HUB_API_KEY tidak diset — skip sync.")
        return {"gauges": 0, "forecasts": 0, "skipped": True}

    now = datetime.now(timezone.utc)
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        try:
            gauges = await fetch_gauges(client, api_key)
        except Exception as exc:
            logger.warning("Flood Hub gauge fetch failed: %s", exc)
            return {"gauges": 0, "forecasts": 0, "skipped": False}

        forecasts_saved = 0
        async with pool.acquire() as conn:
            async with conn.transaction():
                for g in gauges:
                    await conn.execute(
                        """
                        INSERT INTO flood_hub_gauges
                          (gauge_id, latitude, longitude, river_name,
                           station_name, site_name, state, fetched_at)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                        ON CONFLICT (gauge_id) DO UPDATE SET
                          latitude = EXCLUDED.latitude,
                          longitude = EXCLUDED.longitude,
                          river_name = EXCLUDED.river_name,
                          station_name = EXCLUDED.station_name,
                          site_name = EXCLUDED.site_name,
                          state = EXCLUDED.state,
                          fetched_at = EXCLUDED.fetched_at
                        """,
                        g["gauge_id"], g["latitude"], g["longitude"],
                        g["river_name"], g["station_name"], g["site_name"],
                        g["state"], now,
                    )
                    try:
                        forecast = await fetch_latest_forecast(client, api_key, g["gauge_id"])
                    except Exception:
                        forecast = None
                    if not forecast:
                        continue
                    await conn.execute(
                        """
                        INSERT INTO flood_hub_forecasts
                          (gauge_id, severity_level, value,
                           threshold_sev_2yr, threshold_sev_5yr, issued_at, fetched_at)
                        VALUES ($1,$2,$3,$4,$5,$6,$7)
                        ON CONFLICT (gauge_id) DO UPDATE SET
                          severity_level = EXCLUDED.severity_level,
                          value = EXCLUDED.value,
                          threshold_sev_2yr = EXCLUDED.threshold_sev_2yr,
                          threshold_sev_5yr = EXCLUDED.threshold_sev_5yr,
                          issued_at = EXCLUDED.issued_at,
                          fetched_at = EXCLUDED.fetched_at
                        """,
                        forecast["gauge_id"], forecast["severity_level"],
                        forecast["value"], forecast["threshold_sev_2yr"],
                        forecast["threshold_sev_5yr"], forecast["issued_at"], now,
                    )
                    forecasts_saved += 1

    return {"gauges": len(gauges), "forecasts": forecasts_saved, "skipped": False}
