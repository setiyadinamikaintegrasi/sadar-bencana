"""CCTV jalan tol resmi — BPJT Kementerian PUPR (S12a).

Mengambil katalog CCTV jalan tol langsung dari sumber resmi pertama
(https://bpjt.pu.go.id/cctv) yang memuat seluruh Badan Usaha Jalan Tol
(BUJT): Jasa Marga, Hutama Karya, Astra Infra, Waskita, dll. — beserta
koordinat presisi, ruas tol, titik kilometer, dan URL stream HLS resmi.

100% mandiri (first-party) — tanpa perantara pihak ketiga.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

import httpx
from asyncpg import Pool

logger = logging.getLogger(__name__)

BPJT_CCTV_URL = "https://bpjt.pu.go.id/cctv/"
REQUEST_TIMEOUT_SECONDS = 30.0

# Kode BUJT -> nama operator resmi.
OPERATOR_NAMES: dict[str, str] = {
    "jm": "PT Jasa Marga (Persero) Tbk",
    "hk": "PT Hutama Karya (Persero)",
    "mhi": "PT Marga Harjaya Infrastruktur",
    "wtr": "PT Waskita Toll Road",
    "mbmr": "PT Marga Bumi Manik Raja",
    "ckjt": "PT Citra Karya Jabar Tol",
    "mms": "PT Marga Mandalasakti",
    "wbw": "PT Waskita Bumi Wira",
    "btb": "PT Bangun Tol Bali",
    "ppsd": "PT Pemalang Batang",
    "cw": "PT Cimanggis Cibitung Tollways",
    "TLKJ": "PT Trans Lingkar Kita Jaya",
    "cct": "PT Cipali (Citra Marga Cipali)",
    "pbtr": "PT Pelabuhan Bakauheni Terbanggi Besar",
    "pptr": "PT Penajam Paser Utara (IKN)",
    "cmlj": "PT Cimanggis Cibitung",
    "cmnp": "PT Cibitung Cilincing",
    "smr": "PT Semarang Demak",
    "kkdm": "PT Kukar (Kutai Kertanegara)",
    "tjt": "PT Trans Jawa Tengah",
    "jlb": "PT Jalan Layang (Jakarta)",
    "lms": "PT Lintas Marga Sedaya (Cipali)",
    "TBS": "PT Trans Bintaro Serpong",
    "jtd": "PT Jalan Tol Demak",
    "mun": "PT Multi Usaha (Mks)",
    "hmw": "PT Hutama Marga Waskita",
    "wst": "PT Waskita Sriwijaya",
    "ctp": "PT Cikopo-Palimanan",
    "csj": "PT Cibitung-Sejong",
    "cms": "PT Cikarang Serang",
    "mlj": "PT Makassar",
    "mtn": "PT Manado",
    "man": "PT Manado-Bitung",
    "wsp": "PT Waskita Serang-Panimbang",
    "cmlj2": "PT Cimanggis Cibitung 2",
    "-": "Operator Lain",
}


def operator_name(code: str) -> str:
    return OPERATOR_NAMES.get(code, f"BUJT {code.upper()}")


def _decode_json(raw: str) -> list[dict[str, Any]]:
    """Dekode blob allStreams dari halaman BPJT.

    Format: const allStreams = { <ruas_id>: [ {camera...}, ... ], ... };
    Halaman memuat ribuan kamera — pakai raw_decode (bukan full loads)
    agar robust terhadap konten trailing di belakang objek JSON.
    """
    marker = "const allStreams ="
    idx = raw.find(marker)
    if idx == -1:
        raise ValueError("allStreams tidak ditemukan di halaman BPJT")
    brace = raw.find("{", idx)
    if brace == -1:
        raise ValueError("objek allStreams tidak valid")
    decoder = json.JSONDecoder()
    payload, _ = decoder.raw_decode(raw[brace:])
    if not isinstance(payload, dict):
        raise ValueError("allStreams bukan objek JSON")
    cameras: list[dict[str, Any]] = []
    for ruas_id, items in payload.items():
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            item["toll_road_id"] = str(ruas_id)
            cameras.append(item)
    return cameras


def _in_indonesia(lat: float, lon: float) -> bool:
    return 94.0 <= lon <= 141.5 and -11.5 <= lat <= 7.5


def parse_cameras(raw: str) -> list[dict[str, Any]]:
    """Parse & validasi katalog kamera BPJT ke bentuk normal."""
    if not raw:
        return []
    cameras = _decode_json(raw)
    parsed: list[dict[str, Any]] = []
    for cam in cameras:
        try:
            lat = float(cam.get("lat"))
            lon = float(cam.get("lon"))
        except (TypeError, ValueError):
            continue
        if not _in_indonesia(lat, lon):
            continue
        stream = str(cam.get("stream") or "").strip()
        if not stream:
            continue
        # unique_id BPJT (mis. 479-1-105) — id unik per kamera.
        camera_id = str(cam.get("unique_id") or f"{cam.get('camera_id')}-{cam.get('no_urut_segment')}")
        parsed.append({
            "camera_id": camera_id,
            "toll_road_id": str(cam.get("toll_road_id") or ""),
            "toll_road_name": str(cam.get("nama_ruas") or "Tidak diketahui"),
            "segment_name": str(cam.get("nama_segment") or ""),
            "km_point": str(cam.get("nama_km") or ""),
            "operator_code": str(cam.get("bujt") or "-"),
            "latitude": lat,
            "longitude": lon,
            "stream_url": stream,
            "stream_protocol": str(cam.get("protocol") or "m3u8"),
            "is_online": str(cam.get("status")) == "1",
        })
    return parsed


async def sync_bpjt_cctv(pool: Pool) -> dict[str, int]:
    """Tarik katalog CCTV BPJT dan upsert ke public_cctv_cameras."""
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.get(BPJT_CCTV_URL, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
        cameras = parse_cameras(resp.text)

    now = datetime.now(timezone.utc)
    upserted = 0
    async with pool.acquire() as conn:
        async with conn.transaction():
            for cam in cameras:
                await conn.execute(
                    """
                    INSERT INTO public_cctv_cameras
                      (camera_id, toll_road_id, toll_road_name, segment_name,
                       km_point, operator_code, operator_name, latitude,
                       longitude, stream_url, stream_protocol, is_online, fetched_at)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                    ON CONFLICT (camera_id) DO UPDATE SET
                      toll_road_id = EXCLUDED.toll_road_id,
                      toll_road_name = EXCLUDED.toll_road_name,
                      segment_name = EXCLUDED.segment_name,
                      km_point = EXCLUDED.km_point,
                      operator_code = EXCLUDED.operator_code,
                      operator_name = EXCLUDED.operator_name,
                      latitude = EXCLUDED.latitude,
                      longitude = EXCLUDED.longitude,
                      stream_url = EXCLUDED.stream_url,
                      stream_protocol = EXCLUDED.stream_protocol,
                      is_online = EXCLUDED.is_online,
                      fetched_at = EXCLUDED.fetched_at
                    """,
                    cam["camera_id"], cam["toll_road_id"], cam["toll_road_name"],
                    cam["segment_name"], cam["km_point"], cam["operator_code"],
                    operator_name(cam["operator_code"]), cam["latitude"],
                    cam["longitude"], cam["stream_url"], cam["stream_protocol"],
                    cam["is_online"], now,
                )
                upserted += 1
    return {"fetched": len(cameras), "upserted": upserted}
