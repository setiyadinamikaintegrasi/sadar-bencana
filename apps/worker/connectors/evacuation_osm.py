"""Connector OSM (Overpass) untuk fasilitas umum lokasi evakuasi.

Menarik rumah sakit, klinik/puskesmas, kantor polisi, dan damkar bertag OSM
dalam bbox Indonesia, lalu memetakan ke baris ``evacuation_locations``
(source_type='osm'). Kategori TES/TEA/posko/titik kumpul TIDAK diambil dari
OSM (tidak ada tag reliable) — itu jalur input manual admin.

Opt-in via CONNECTOR_EVACUATION_OSM_ENABLED: query se-Indonesia cukup berat
untuk Overpass public instance, jadwal mingguan.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
INDONESIA_BBOX = "(-11.0,92.0,8.0,142.0)"

AMENITY_TO_LOCATION_TYPE = {
    "hospital": "rumah_sakit",
    "clinic": "puskesmas",
    "police": "kantor_polisi",
    "fire_station": "damkar",
}

_FALLBACK_LABELS = {
    "hospital": "Rumah Sakit",
    "clinic": "Puskesmas/Klinik",
    "police": "Kantor Polisi",
    "fire_station": "Damkar",
}

_HEADERS = {"User-Agent": "sadar-bencana/1.0 (evacuation facilities sync)"}


def build_overpass_query(amenity: str) -> str:
    return f'[out:json][timeout:180];nwr["amenity"="{amenity}"]{INDONESIA_BBOX};out center;'


def element_to_location(element: dict[str, Any], amenity: str) -> dict[str, Any] | None:
    tags = element.get("tags") or {}
    if element.get("type") == "node":
        lat, lon = element.get("lat"), element.get("lon")
    else:
        center = element.get("center") or {}
        lat, lon = center.get("lat"), center.get("lon")
    if lat is None or lon is None:
        return None
    name = (tags.get("name") or "").strip()
    if not name:
        name = f"{_FALLBACK_LABELS[amenity]} (OSM {element.get('id')})"
    return {
        "source_ref": f"osm:{element.get('type')}/{element.get('id')}",
        "name": name[:200],
        "location_type": AMENITY_TO_LOCATION_TYPE[amenity],
        "latitude": float(lat),
        "longitude": float(lon),
        "address": (tags.get("addr:full") or tags.get("addr:street") or "").strip(),
        "phone": (tags.get("phone") or tags.get("contact:phone") or "").strip(),
        "operating_hours": (tags.get("opening_hours") or "").strip(),
    }


class EvacuationOSMConnector:
    """Fetch fasilitas umum dari Overpass, satu query per amenity."""

    def __init__(self, http_client: httpx.AsyncClient | None = None, timeout: float = 240.0) -> None:
        self._client = http_client
        self._timeout = timeout
        self._owns_client = http_client is None

    async def fetch_recent(self) -> list[dict[str, Any]]:
        client = self._client
        if client is None:
            client = httpx.AsyncClient(timeout=self._timeout, headers=_HEADERS)
            self._client = client
        rows: list[dict[str, Any]] = []
        for amenity in AMENITY_TO_LOCATION_TYPE:
            try:
                response = await client.post(
                    OVERPASS_URL, data={"data": build_overpass_query(amenity)}, headers=_HEADERS
                )
                response.raise_for_status()
                elements = (response.json() or {}).get("elements") or []
            except Exception as exc:  # graceful: satu amenity gagal, lanjut lainnya
                logger.warning("Evacuation OSM: %s gagal: %s", amenity, exc)
                continue
            count = 0
            for element in elements:
                row = element_to_location(element, amenity)
                if row is not None:
                    rows.append(row)
                    count += 1
            logger.info("Evacuation OSM: %s -> %d lokasi", amenity, count)
        return rows

    async def close(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None
