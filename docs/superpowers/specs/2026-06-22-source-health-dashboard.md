# Source Health Dashboard — Design Spec

**Date:** 2026-06-22
**Scope:** DB migration, Python worker module, Go API handler, React frontend page
**Dependencies added:** none
**Constraints:** No new npm/Go/Python packages beyond what's already installed

---

## Goal

Memberikan visibilitas kepada tim PT Tugure tentang status setiap connector data — kapan terakhir poll, berapa item yang didapat, dan apakah ada error — sehingga data stale atau broken terdeteksi sebelum mempengaruhi keputusan underwriting.

---

## Bagian 1 — Database Schema

### Migration: `db/schema/008_connector_health.sql`

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS connector_health (
    name           VARCHAR(64)  PRIMARY KEY,
    last_polled_at TIMESTAMPTZ,
    items_fetched  INT          NOT NULL DEFAULT 0,
    error_message  TEXT,
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMIT;
```

Satu baris per connector. Di-upsert setiap poll cycle selesai (berhasil maupun gagal). `error_message` NULL berarti poll berhasil. Tidak ada riwayat — hanya status terkini.

Migration diterapkan dengan pola yang sama seperti migration sebelumnya:
```bash
cat db/schema/008_connector_health.sql | docker exec -i rrm-postgres psql -U rrm -d reinsurance_risk_monitor
```

---

## Bagian 2 — Worker

### Connector yang dilacak

| `name` | Kategori | Scheduler | Interval | Threshold merah |
|--------|----------|-----------|----------|-----------------|
| `bmkg` | Hazard | IngestScheduler | 5 menit | > 600 detik |
| `usgs` | Hazard | IngestScheduler | 5 menit | > 600 detik |
| `gdacs_fl` | Hazard | IngestScheduler | 5 menit | > 600 detik |
| `gdacs_vo` | Hazard | IngestScheduler | 5 menit | > 600 detik |
| `nasa_firms` | Hazard | IngestScheduler | 5 menit | > 600 detik |
| `antara` | News | NewsScheduler | 15 menit | > 1800 detik |
| `detik` | News | NewsScheduler | 15 menit | > 1800 detik |
| `cnn` | News | NewsScheduler | 15 menit | > 1800 detik |
| `tempo` | News | NewsScheduler | 15 menit | > 1800 detik |
| `republika` | News | NewsScheduler | 15 menit | > 1800 detik |
| `sindo` | News | NewsScheduler | 15 menit | > 1800 detik |
| `okezone` | News | NewsScheduler | 15 menit | > 1800 detik |
| `aisstream` | Vessel | AssetScheduler | 60 detik | > 120 detik |
| `vesselfinder` | Vessel | AssetScheduler | 60 detik | > 120 detik |
| `opensky` | Aircraft | AssetScheduler | 60 detik | > 120 detik |

### Modul baru: `apps/worker/db/health.py`

```python
"""Persistence helpers for the connector_health table."""
from __future__ import annotations
import logging
from datetime import datetime, timezone
import asyncpg

logger = logging.getLogger(__name__)

_UPSERT_SQL = """
INSERT INTO connector_health (name, last_polled_at, items_fetched, error_message, updated_at)
VALUES ($1, $2, $3, $4, now())
ON CONFLICT (name) DO UPDATE SET
    last_polled_at = EXCLUDED.last_polled_at,
    items_fetched  = EXCLUDED.items_fetched,
    error_message  = EXCLUDED.error_message,
    updated_at     = now()
"""

async def upsert_connector_health(
    pool: asyncpg.Pool,
    name: str,
    items_fetched: int,
    error_message: str | None = None,
) -> None:
    now = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        await conn.execute(_UPSERT_SQL, name, now, items_fetched, error_message)
    logger.debug("connector_health upserted: %s items=%d err=%s", name, items_fetched, error_message)
```

### Integrasi di `apps/worker/main.py`

Tiga titik integrasi — masing-masing memanggil `upsert_connector_health` per sub-connector setelah selesai (berhasil maupun gagal):

**1. `_ingest_cycle()`** — setelah fetch per connector (bmkg, usgs, gdacs_fl, gdacs_vo, nasa_firms):
```python
from db.health import upsert_connector_health

# Setelah setiap sub-connector fetch, dalam try/except:
try:
    events = await sub_connector.fetch_recent()
    await upsert_connector_health(pool, connector_name, len(events))
except Exception as exc:
    await upsert_connector_health(pool, connector_name, 0, str(exc))
    raise
```

**2. `_news_poll_cycle()`** — setelah fetch per RSS source (antara, detik, cnn, tempo, republika, sindo, okezone):
`RSSNewsConnector.fetch_all()` mengembalikan list `NewsItem` dan sudah menangkap error per-source secara internal (log warning, lanjut ke source berikutnya). Untuk melacak health per-source, `fetch_all()` dimodifikasi agar juga mengembalikan `dict[str, int | str]` berisi `{source: items_count}` untuk sukses dan `{source: error_str}` untuk gagal. `_news_poll_cycle()` mengiterasi dict ini dan memanggil `upsert_connector_health` per source.

**3. Asset scheduler** — setelah fetch vessels dan aircraft (aisstream, vesselfinder, opensky):
Sama dengan pola ingest — try/except per connector, upsert setelah selesai.

---

## Bagian 3 — Go API

### Handler baru: `apps/api/internal/http/connector_health.go`

File `health.go` sudah ada (berisi fungsi `Health` untuk ping endpoint `GET /health`). Handler baru dibuat di file terpisah untuk menghindari konflik.

```go
package http

import (
    "database/sql"
    "net/http"
    "time"
    "github.com/gin-gonic/gin"
)

type ConnectorHealth struct {
    Name             string     `json:"name"`
    Status           string     `json:"status"`           // "ok" | "stale" | "error"
    LastPolledAt     *time.Time `json:"last_polled_at"`
    ItemsFetched     int        `json:"items_fetched"`
    ErrorMessage     *string    `json:"error_message"`
    ThresholdSeconds int        `json:"threshold_seconds"`
    UpdatedAt        time.Time  `json:"updated_at"`
}
```

Status dihitung di Go saat request masuk:
- `"error"` — `error_message IS NOT NULL`
- `"stale"` — `now() - last_polled_at > threshold_seconds`
- `"ok"` — sisanya

Threshold per connector didefinisikan sebagai map konstanta di `health.go` (bukan di DB) sehingga mudah diubah tanpa migrasi.

**Endpoint:** `GET /api/v1/health/connectors`

**Response envelope:**
```json
{
  "data": [
    {
      "name": "bmkg",
      "status": "ok",
      "last_polled_at": "2026-06-22T10:00:00Z",
      "items_fetched": 12,
      "error_message": null,
      "threshold_seconds": 600,
      "updated_at": "2026-06-22T10:00:01Z"
    }
  ],
  "meta": { "count": 15 }
}
```

Jika connector belum pernah poll (baris tidak ada di DB), tetap muncul di response dengan `status: "stale"`, `last_polled_at: null`, `items_fetched: 0`. Daftar 15 connector didefinisikan sebagai konstanta di handler sehingga semua connector selalu tampil meski tabel kosong.

Handler didaftarkan di `apps/api/cmd/server/main.go` bersama route lainnya:
```go
router.GET("/api/v1/health/connectors", apihttp.ConnectorHealthHandler(dbPool))
```

Fungsi handler bernama `ConnectorHealthHandler` (bukan `ConnectorHealth`) untuk menghindari ambiguitas dengan struct `ConnectorHealth`.

---

## Bagian 4 — Frontend

### Type & fetch (`apps/web/src/lib/api/client.ts`)

```typescript
export type ConnectorHealth = {
  name: string
  status: 'ok' | 'stale' | 'error'
  last_polled_at: string | null
  items_fetched: number
  error_message: string | null
  threshold_seconds: number
  updated_at: string
}

export async function getConnectorHealth(): Promise<ConnectorHealth[]> {
  const res = await request<{ data: ConnectorHealth[]; meta: { count: number } }>('/health/connectors')
  return res.data
}
```

### Halaman baru: `apps/web/src/features/health/SourceHealthPage.tsx`

**Layout:** card per kategori (Hazard, News, Vessel & Aircraft), masing-masing berisi tabel (desktop) / card list (mobile). Auto-refresh setiap 30 detik.

**Status badge:**
- `ok` → dot hijau `●` + teks `"OK"`
- `stale` → dot kuning `◐` + teks `"STALE"`
- `error` → silang merah `✕` + teks `"ERROR"`

**Setiap baris menampilkan:**
- Nama connector
- Status badge
- Waktu relatif sejak `last_polled_at` (misal "2 mnt lalu", "baru saja")
- `items_fetched` + satuan kontekstual ("item")
- `error_message` ditruncate 80 karakter dengan full text di HTML `title` attribute (tooltip native browser)

**Integrasi App.tsx:**
- Tambah `"Source Health"` ke `sections` array dengan icon `◈`
- Tambah ke `moreSections` di More sheet (mobile)
- Render `<SourceHealthPage />` di switch render content

### Files changed (frontend)

| File | Perubahan |
|------|-----------|
| `apps/web/src/lib/api/client.ts` | Tambah `ConnectorHealth` type + `getConnectorHealth()` |
| `apps/web/src/features/health/SourceHealthPage.tsx` | File baru |
| `apps/web/src/App.tsx` | Tambah "Source Health" ke sections + render |

---

## File Changes Summary

| File | Jenis |
|------|-------|
| `db/schema/008_connector_health.sql` | Baru — migration |
| `apps/worker/db/health.py` | Baru — upsert helper |
| `apps/worker/main.py` | Modifikasi — integrasi upsert di 3 titik |
| `apps/worker/tests/db/test_health.py` | Baru — unit tests |
| `apps/api/internal/http/connector_health.go` | Baru — Go handler (`ConnectorHealthHandler`) |
| `apps/api/cmd/server/main.go` | Modifikasi — daftarkan route `GET /api/v1/health/connectors` |
| `apps/web/src/lib/api/client.ts` | Modifikasi — tambah type + fetch |
| `apps/web/src/features/health/SourceHealthPage.tsx` | Baru — halaman |
| `apps/web/src/App.tsx` | Modifikasi — tambah sidebar entry + render |

---

## Non-Goals

- Tidak ada riwayat error (hanya status terkini)
- Tidak ada alert/notifikasi push saat connector merah
- Tidak ada manual trigger re-poll dari dashboard
- Tidak ada grafik uptime atau sparkline
- Tidak ada perubahan pada logika scheduler atau connector yang sudah ada
