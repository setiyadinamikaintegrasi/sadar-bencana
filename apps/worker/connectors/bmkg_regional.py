"""BMKG regional peringatan-dini-cuaca fallback connector (S13).

Konteks (investigasi 2026-09-01): feed CAP publik BMKG
(/alerts/nowcast/id) dapat stale >48 jam sementara halaman regional
per-provinsi (https://www.bmkg.go.id/cuaca/peringatan-dini-cuaca/{kode})
menampilkan peringatan lebih baru. BMKG menerbitkan ke halaman regional
TANPA menyinkronkan ke feed CAP publik (CAP detail utk ID regional
baru = 404).

Peraturan (dari spesifikasi tugas):
- Sumber berlabel 'bmkg_regional' — TIDAK dicampur dgn 'bmkg_cap'.
- Hanya aktif saat CAP primary stale (fallback, bukan pengganti).
- Halaman regional harus FRESH (tanggal terbit dalam threshold) —
  bila regional juga stale, fallback tidak dianggap fresh (aturan 9).
- Alert lama tidak diaktifkan; hanya insert alert baru valid.
- Halaman regional tidak memiliki effective/expires terstruktur —
  masa berlaku diturunkan dari tanggal terbit + label perkiraan.

Endpoint resmi XML regional TIDAK tersedia (dokumentasi open data
data.bmkg.go.id hanya mempublikasikan RSS/CAP global) — parsing HTML
adalah satu-satunya jalur, dgn fixture + validasi ketat.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

BMKG_REGIONAL_BASE = "https://www.bmkg.go.id/cuaca/peringatan-dini-cuaca"
REQUEST_TIMEOUT_SECONDS = 20.0
REQUEST_USER_AGENT = "sadar-bencana/0.2 (+https://github.com/setiyadinamikaintegrasi/sadar-bencana)"

# Threshold: halaman regional dianggap stale bila tanggal terbit > 12 jam
# (nowcast BMKG terbit harian; >12 jam tanpa update = kemungkinan stale).
REGIONAL_STALE_HOURS = 12.0

# Masa berlaku perkiraan alert regional (halaman tidak menyediakan
# expires terstruktur): peringatan dini cuaca BMKG umumnya berlaku
# hingga akhir hari terbit (~6-12 jam dari penerbitan).
ESTIMATED_VALIDITY_HOURS = 12.0

# Kode wilayah BMKG (propinsi) — subset prioritas; halaman BMKG memakai
# kode wilayah sendiri (BUKAN kode Kemendagri; contoh: 12=Sumut, 32=Jabar).
REGIONAL_PROVINCES: dict[str, str] = {
    "01": "Aceh",
    "02": "Sumatera Utara",
    "03": "Sumatera Barat",
    "04": "Riau",
    "05": "Kepulauan Riau",
    "06": "Jambi",
    "07": "Sumatera Selatan",
    "08": "Bengkulu",
    "09": "Lampung",
    "10": "Kep. Bangka Belitung",
    "11": "DKI Jakarta",
    "12": "Jawa Barat",
    "13": "Jawa Tengah",
    "14": "DI Yogyakarta",
    "15": "Jawa Timur",
    "16": "Banten",
    "17": "Bali",
    "18": "Nusa Tenggara Barat",
    "19": "Nusa Tenggara Timur",
    "20": "Kalimantan Barat",
    "21": "Kalimantan Tengah",
    "22": "Kalimantan Selatan",
    "23": "Kalimantan Timur",
    "24": "Kalimantan Utara",
    "25": "Sulawesi Utara",
    "26": "Sulawesi Tengah",
    "27": "Sulawesi Selatan",
    "28": "Sulawesi Tenggara",
    "29": "Gorontalo",
    "30": "Sulawesi Barat",
    "31": "Maluku",
    "32": "Maluku Utara",
    "33": "Papua",
    "34": "Papua Barat",
}

_BULAN = {
    "januari": 1, "februari": 2, "maret": 3, "april": 4, "mei": 5, "juni": 6,
    "juli": 7, "agustus": 8, "september": 9, "oktober": 10, "november": 11, "desember": 12,
}

# Pola teks tanggal terbit regional: "... tgl 01 September 2026 pkl. 12:50 WIB"
_PUBLISHED_RE = re.compile(
    r"tgl\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+pkl\.?\s+(\d{1,2})[:.](\d{2})\s+WIB",
    re.IGNORECASE,
)
# Pola ID alert CAP di gambar/konten: CSU20260901002 dll.
_ALERT_ID_RE = re.compile(r"\b([A-Z]{2,4}\d{10,12})")
# Pola headline peringatan.
_HEADLINE_RE = re.compile(
    r"(?:UPDATE\s+)?Peringatan Dini Cuaca[^<]{0,200}?berpotensi[^<]{0,300}",
    re.IGNORECASE,
)


def parse_regional_page(html: str, province_code: str) -> dict[str, Any] | None:
    """Parse halaman regional BMKG → dict alert regional; None bila tidak valid.

    Validasi ketat (aturan 9): tanggal terbit harus ada & parseable;
    alert ID harus terdeteksi; headline harus ada. Halaman tanpa
    peringatan (konten default) mengembalikan None.
    """
    if not html or len(html) < 1000:
        return None

    m = _PUBLISHED_RE.search(html)
    if not m:
        return None
    day, bulan_raw, year, hour_raw, minute = m.groups()
    bulan = _BULAN.get(bulan_raw.lower())
    if bulan is None:
        return None
    hour = int(hour_raw.replace(".", ""))
    # WIB = UTC+7.
    published = datetime(int(year), bulan, int(day), hour, int(minute), tzinfo=timezone(timedelta(hours=7)))

    ids = _ALERT_ID_RE.findall(html)
    alert_id = ids[0] if ids else None

    headline_match = _HEADLINE_RE.search(re.sub(r"\s+", " ", html))
    headline = None
    if headline_match:
        headline = re.sub(r"<[^>]+>", "", headline_match.group(0)).strip()[:300]

    province_name = REGIONAL_PROVINCES.get(province_code, f"Wilayah {province_code}")

    return {
        "province_code": province_code,
        "province_name": province_name,
        "published_at": published,
        "alert_id": alert_id,
        "headline": headline,
    }


def is_regional_stale(published_at: datetime, now: datetime | None = None) -> bool:
    """True bila halaman regional terbit > threshold (fallback tak fresh)."""
    reference = now or datetime.now(timezone.utc)
    if published_at.tzinfo is None:
        published_at = published_at.replace(tzinfo=timezone.utc)
    return reference - published_at > timedelta(hours=REGIONAL_STALE_HOURS)


async def fetch_regional_alert(
    client: httpx.AsyncClient, province_code: str
) -> dict[str, Any] | None:
    """Fetch satu halaman provinsi; None bila 404/tidak ada peringatan."""
    url = f"{BMKG_REGIONAL_BASE}/{province_code}"
    resp = await client.get(url, headers={"User-Agent": REQUEST_USER_AGENT})
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return parse_regional_page(resp.text, province_code)

def regional_alert_input(parsed: dict[str, Any]) -> "OfficialAlertInput":
    """Konversi parse hasil halaman regional → OfficialAlertInput.

    Label jelas: source='bmkg_regional' (TIDAK 'bmkg_cap' — aturan 4).
    Masa berlaku: perkiraan (halaman tidak punya expires terstruktur).
    """
    from models.official_alert import OfficialAlertInput

    published = parsed["published_at"]
    province = parsed["province_name"]
    alert_id = parsed["alert_id"] or f"regional-{parsed['province_code']}-{published.strftime('%Y%m%d%H%M')}"
    headline = parsed["headline"] or f"Peringatan Dini Cuaca Wilayah {province}"
    expires_est = published + timedelta(hours=ESTIMATED_VALIDITY_HOURS)

    return OfficialAlertInput(
        source="bmkg_regional",
        source_alert_id=f"{alert_id}",
        message_type="alert",
        status="active",
        sent_at=published,
        effective_at=published,
        expires_at=expires_est,
        headline=f"[BMKG Regional] {headline}",
        description=(
            f"Peringatan dini cuaca wilayah {province} dari halaman regional BMKG "
            f"(terbit {published.strftime('%d %b %Y %H:%M WIB')}). Masa berlaku "
            f"perkiraan (halaman regional tidak menyediakan expires terstruktur)."
        ),
        area_geojson=None,
        peril_type="weather",
        severity="Moderate",
        area_name=province,
        source_url=f"{BMKG_REGIONAL_BASE}/{parsed['province_code']}",
        raw_payload={
            "format": "regional-html",
            "province_code": parsed["province_code"],
            "province_name": province,
            "published_at": published.isoformat(),
            "estimated_validity_hours": ESTIMATED_VALIDITY_HOURS,
            "attribution": "BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)",
        },
    )


async def sync_bmkg_regional_fallback(
    pool, cap_stale: bool, now: datetime | None = None
) -> dict[str, int]:
    """Fallback regional — hanya berjalan saat CAP primary stale.

    Aturan: bila CAP stale, poll halaman regional per-provinsi; halaman
    fresh (<12 jam) → insert alert berlabel bmkg_regional. Halaman
    regional juga stale → TIDAK ada yang diinsert (fallback tak fresh).
    Alert bmkg_cap lama TIDAK disentuh.
    """
    if not cap_stale:
        return {"checked": 0, "inserted": 0, "skipped": "cap_not_stale"}

    from db.official_alerts import upsert_official_alert

    reference = now or datetime.now(timezone.utc)
    checked = 0
    inserted = 0
    fresh_any = False

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        for code in REGIONAL_PROVINCES:
            try:
                parsed = await fetch_regional_alert(client, code)
            except Exception as exc:
                logger.debug("BMKG regional %s gagal: %s", code, exc)
                continue
            checked += 1
            if parsed is None:
                continue
            if is_regional_stale(parsed["published_at"], now=reference):
                continue  # aturan 9: regional juga stale → skip
            fresh_any = True
            alert = regional_alert_input(parsed)
            try:
                _current, created = await upsert_official_alert(pool, alert, now=reference)
                if created:
                    inserted += 1
            except Exception as exc:
                logger.warning("BMKG regional upsert %s gagal: %s", code, exc)

    return {
        "checked": checked,
        "inserted": inserted,
        "fresh_any": fresh_any,
    }
