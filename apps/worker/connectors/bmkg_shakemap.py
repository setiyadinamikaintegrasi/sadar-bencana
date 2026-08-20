"""Shakemap MMI overlay connector (Sprint 6 S6).

BMKG mempublikasikan peta intensitas MMI (JPG) untuk gempa yang dirasakan
pada feed ``autogempa.json`` / ``gempadirasakan.json`` (field ``Shakemap``,
nama file ``<YYYYMMDDHHMMSS>.mmi.jpg``). Verifikasi pixel-level menunjukkan
peta adalah kotak **5°×5° berpusat episenter** — cukup untuk georeferensi
MapLibre image-source dengan 4 koordinat sudut.

Connector ini:
- menarik feed terbaru,
- memetakan event_id BMKG (dari DateTime+koordinat — konsisten normalizer
  utama) ke baris ``shakemap_overlays``,
- HEAD-check URL gambar (skip bila 404; tidak semua gempa punya shakemap).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

import hashlib

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://data.bmkg.go.id/DataMKG/TEWS"
SHAKEMAP_EXTENT_DEGREES = 5.0
SHAKEMAP_KEY_PATTERN = re.compile(r"^(\d{14})\.mmi\.jpg$")
MAX_OVERLAYS_PER_RUN = 40


@dataclass(frozen=True)
class ShakemapOverlay:
    event_id: str
    shakemap_key: str
    image_url: str
    magnitude: float
    depth_km: float | None
    latitude: float
    longitude: float
    min_longitude: float
    min_latitude: float
    max_longitude: float
    max_latitude: float
    felt_reports: str


def _parse_coordinates(raw: str) -> tuple[float, float] | None:
    """'−8.28,120.57' -> (lat, lon); koordinat selatan/barat negatif."""
    parts = [p.strip() for p in raw.split(",")]
    if len(parts) != 2:
        return None
    try:
        lat = float(parts[0].replace("LS", "").replace("LU", "").strip())
        lon = float(parts[1].replace("BT", "").replace("BB", "").strip())
    except ValueError:
        return None
    if "LS" in parts[0]:
        lat = -abs(lat)
    if "BB" in parts[1]:
        lon = -abs(lon)
    return lat, lon


def _parse_depth(raw: str) -> float | None:
    digits = re.sub(r"[^0-9.]", "", raw or "")
    if not digits:
        return None
    try:
        return float(digits)
    except ValueError:
        return None


def event_id_for_feed_item(item: dict[str, Any]) -> str | None:
    """ID kanonik konsisten normalizer BMKG utama.

    Normalizer utama (apps/worker/normalizers/bmkg.py) memakai
    sha1("DateTime|Coordinates")[:12] — formula yang sama di sini agar
    shakemap_overlays.event_id join bersih dengan tabel events.
    """
    fingerprint = "|".join([
        str(item.get("DateTime") or ""),
        str(item.get("Coordinates") or ""),
    ])
    if not fingerprint.strip("|"):
        return None
    digest = hashlib.sha1(fingerprint.encode("utf-8")).hexdigest()[:12]
    return f"bmkg:{digest}"


def overlay_from_feed_item(item: dict[str, Any]) -> ShakemapOverlay | None:
    shakemap_name = (item.get("Shakemap") or "").strip()
    match = SHAKEMAP_KEY_PATTERN.match(shakemap_name)
    if not match:
        return None
    coords = _parse_coordinates(item.get("Coordinates") or "")
    event_id = event_id_for_feed_item(item)
    if not coords or not event_id:
        return None
    lat, lon = coords
    half = SHAKEMAP_EXTENT_DEGREES / 2
    try:
        magnitude = float(item.get("Magnitude") or 0)
    except ValueError:
        magnitude = 0.0
    return ShakemapOverlay(
        event_id=event_id,
        shakemap_key=match.group(1),
        image_url=f"{BASE_URL}/{shakemap_name}",
        magnitude=magnitude,
        depth_km=_parse_depth(item.get("Kedalaman") or ""),
        latitude=lat,
        longitude=lon,
        min_longitude=lon - half,
        min_latitude=lat - half,
        max_longitude=lon + half,
        max_latitude=lat + half,
        felt_reports=(item.get("Dirasakan") or "")[:500],
    )


class BMKGShakemapConnector:
    """Menarik overlay shakemap dari feed gempa yang dirasakan."""

    def __init__(self, http_client: httpx.AsyncClient | None = None, timeout: float = 30.0) -> None:
        self._client = http_client
        self._timeout = timeout
        self._owns_client = http_client is None

    async def fetch_overlays(self) -> list[ShakemapOverlay]:
        overlays: dict[str, ShakemapOverlay] = {}
        client = self._client
        if client is None:
            client = httpx.AsyncClient(timeout=self._timeout)
            self._client = client
        for feed in ("autogempa.json", "gempadirasakan.json"):
            try:
                response = await client.get(f"{BASE_URL}/{feed}")
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                logger.warning("shakemap feed %s gagal: %s", feed, exc)
                continue
            for item in self._feed_items(payload):
                overlay = overlay_from_feed_item(item)
                if overlay is None:
                    continue
                overlays.setdefault(overlay.event_id, overlay)
        # gempa terbaru dulu; batasi jumlah per run.
        ranked = sorted(overlays.values(), key=lambda o: o.shakemap_key, reverse=True)
        return ranked[:MAX_OVERLAYS_PER_RUN]

    @staticmethod
    def _feed_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
        info = payload.get("Infogempa") or {}
        gempa = info.get("gempa")
        if isinstance(gempa, dict):
            return [gempa]
        if isinstance(gempa, list):
            return [g for g in gempa if isinstance(g, dict)]
        return []

    async def verify_image(self, overlay: ShakemapOverlay) -> bool:
        """HEAD-check URL gambar; False bila 404/tak tersedia."""
        client = self._client
        if client is None:
            client = httpx.AsyncClient(timeout=self._timeout)
            self._client = client
        try:
            response = await client.head(overlay.image_url)
        except httpx.HTTPError:
            return False
        return response.status_code == 200

    async def close(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None


async def upsert_overlays(pool, overlays: list[ShakemapOverlay]) -> int:
    """Simpan overlay (idempoten per event_id). Mengembalikan jumlah baris."""
    if not overlays:
        return 0
    rows = 0
    for overlay in overlays:
        row = await pool.fetchrow(
            """
            INSERT INTO shakemap_overlays (
                event_id, shakemap_key, image_url, magnitude, depth_km,
                latitude, longitude, min_longitude, min_latitude,
                max_longitude, max_latitude, felt_reports, fetched_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
            ON CONFLICT (event_id) DO UPDATE SET
                shakemap_key = EXCLUDED.shakemap_key,
                image_url = EXCLUDED.image_url,
                magnitude = EXCLUDED.magnitude,
                depth_km = EXCLUDED.depth_km,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                min_longitude = EXCLUDED.min_longitude,
                min_latitude = EXCLUDED.min_latitude,
                max_longitude = EXCLUDED.max_longitude,
                max_latitude = EXCLUDED.max_latitude,
                felt_reports = EXCLUDED.felt_reports,
                fetched_at = now()
            RETURNING (xmax = 0) AS inserted
            """,
            overlay.event_id, overlay.shakemap_key, overlay.image_url,
            overlay.magnitude, overlay.depth_km, overlay.latitude,
            overlay.longitude, overlay.min_longitude, overlay.min_latitude,
            overlay.max_longitude, overlay.max_latitude, overlay.felt_reports,
        )
        if row and row["inserted"]:
            rows += 1
    return rows


async def sync_shakemap_overlays(pool) -> dict[str, int]:
    """Alur lengkap: fetch feed -> verify gambar -> upsert. Return statistik."""
    connector = BMKGShakemapConnector()
    try:
        overlays = await connector.fetch_overlays()
    finally:
        pass  # klien dipakai verify di bawah; tutup di akhir.
    verified: list[ShakemapOverlay] = []
    for overlay in overlays:
        if await connector.verify_image(overlay):
            verified.append(overlay)
    inserted = await upsert_overlays(pool, verified)
    await connector.close()
    return {"fetched": len(overlays), "verified": len(verified), "inserted": inserted}
