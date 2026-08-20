# Instruksi Deploy LENGKAP: Tumpukan PR #113–#122 (Sprint 4 P9–P12 + Sprint 5 S1–S4 + Sprint 6 S5–S6)

> Prompt ini menggantikan instruksi deploy S6 sebelumnya — mencakup SEMUA PR yang mungkin belum
> tertarik ke production. Jalankan berurutan; langkah yang sudah pernah dilakukan (mis. dari
> deploy S1/S2 sebelumnya) boleh dilewati dengan verifikasi singkat.

## Konteks

Repo: `sadar-bencana` (dir prod: `reinsurance-risk-monitor`). PR berikut sudah merged di `main`
(sebagian mungkin SUDAH pernah dideploy — verifikasi di tiap langkah):

| PR | Fitur | Komponen yang berubah |
|---|---|---|
| #113 | P9: unduh cuplikan peta PNG | frontend only |
| #114 | P10: satelit IR NASA GIBS | frontend + CSP |
| #115 | P12: badge komposisi klaster | frontend only |
| #116 | S1: populasi WorldPop zonal | **migration 041** + worker importer + deps + API endpoint |
| #117 | fix importer WorldPop (tempfile) | worker only (perbaikan bug #116) |
| #118 | S2: fasilitas kritis + panel dampak | API endpoint + frontend |
| #119 | S3: landcover ESA WorldCover | **migration 042** + worker importer + API endpoint + frontend |
| #120 | S4: medan SRTM | API (internal, tanpa DB) + frontend |
| #121 | S5: impact engine skor dampak | API (internal) + frontend |
| #122 | S6: Shakemap MMI BMKG + auto-aktif | **migration 043** + worker connector + API endpoint + frontend |

Endpoint API baru (semua publik):
- `GET /api/v1/spatial/population-summary?polygon=WKT` (#116)
- `GET /api/v1/spatial/critical-facilities?lat&lon&radius_km[&types]` (#118)
- `GET /api/v1/spatial/landcover-summary?polygon=WKT` (#119)
- `GET /api/v1/spatial/elevation-summary?min_lng&min_lat&max_lng&max_lat` (#120)
- `GET /api/v1/spatial/impact-score?event_id` (#121)
- `GET /api/v1/map/operations/shakemaps?bbox&zoom` (#122)

Lingkungan prod: PostgreSQL 17 + PostGIS di Docker (container seperti `sadar-postgres`), API Go
binary, worker Python proses, frontend `apps/web/dist/` via nginx/caddy.

## LANGKAH 0 — Sinkronkan kode

```bash
cd <direktori-repo-prod>
git fetch origin
git reset --hard origin/main
git log --oneline -1
# Harus: d3d64b7 feat(map): S6 — overlay Shakemap MMI BMKG + auto-aktif (#122)
```

## LANGKAH 1 — Migrasi DB (SEBELUM binary/proses baru)

Apply semua yang belum ada. Setiap file aman diulang (IF NOT EXISTS):

```bash
PG=<nama-container-postgres>
docker cp db/schema/041_worldpop_population_grid.sql  $PG:/tmp/041.sql
docker cp db/schema/042_worldcover_landcover_grid.sql $PG:/tmp/042.sql
docker cp db/schema/043_shakemap_overlays.sql         $PG:/tmp/043.sql
docker exec $PG psql -U sadar -d sadar_bencana -f /tmp/041.sql
docker exec $PG psql -U sadar -d sadar_bencana -f /tmp/042.sql
docker exec $PG psql -U sadar -d sadar_bencana -f /tmp/043.sql
```

Verifikasi:

```bash
docker exec $PG psql -U sadar -d sadar_bencana -c "\dt worldpop*"
docker exec $PG psql -U sadar -d sadar_bencana -c "\dt worldcover*"
docker exec $PG psql -U sadar -d sadar_bencana -c "\dt shakemap*"
docker exec $PG psql -U sadar -d sadar_bencana -c "\df zonal_*"
```

Ekspektasi: 3 tabel + 2 fungsi (`zonal_population_summary`, `zonal_landcover_summary`).

## LANGKAH 2 — Worker: deps baru + importer data (SEKALI saja, lama ±12 menit total)

```bash
cd apps/worker
source venv/bin/activate   # atau sesuai setup prod
pip install -r requirements.txt
```

Deps baru: `numpy`, `tifffile`, `imagecodecs` (untuk importer WorldPop/WorldCover).

### 2a. Import WorldPop (unduh 10 MB, ingest 2,27 juta sel, ±2 menit)

```bash
python -m importers.worldpop_grid --db "$DATABASE_URL"
```

Verifikasi:

```bash
docker exec $PG psql -U sadar -d sadar_bencana -t \
  -c "SELECT vintage, feature_count FROM spatial_datasets WHERE dataset='worldpop_population';"
docker exec $PG psql -U sadar -d sadar_bencana -t \
  -c "SELECT round(population), cells FROM zonal_population_summary(ST_GeomFromText('POLYGON((106.69 -6.37,107.01 -6.37,107.01 -6.08,106.69 -6.08,106.69 -6.37))',4326));"
```

Ekspektasi: vintage `2020`, ±2.270.281 fitur; zonal Jakarta ±15.0 juta jiwa / ±1.242 sel.
(TANPA `--tif` — bug tempfile lama sudah difix di #117.)

### 2b. Import WorldCover (unduh 1,5 GB via 95 tile, ±10 menit; pakai cache agar re-run murah)

```bash
python -m importers.worldcover_landcover --db "$DATABASE_URL" --cache-dir /tmp/wc
# selesai boleh: rm -rf /tmp/wc  (hemat 1,5 GB)
```

Verifikasi:

```bash
docker exec $PG psql -U sadar -d sadar_bencana -t \
  -c "SELECT vintage, feature_count FROM spatial_datasets WHERE dataset='worldcover_landcover';"
docker exec $PG psql -U sadar -d sadar_bencana -c \
  "SELECT class_code, round((fraction*100)::numeric,1) pct FROM zonal_landcover_summary(ST_GeomFromText('POLYGON((106.69 -6.37,107.01 -6.37,107.01 -6.08,106.69 -6.08,106.69 -6.37))',4326)) ORDER BY fraction DESC LIMIT 3;"
```

Ekspektasi: vintage `2020`, ±4.037.701 fitur; Jakarta dominan class 50 (built-up) ±76%.

### 2c. Restart worker

```bash
# restart sesuai manajemen proses prod
```

Scheduler shakemap baru aktif otomatis (tiap 10 menit). Log: "Shakemap sync: ...".
**Tanpa importer manual untuk shakemap** — data BMKG mengisi sendiri ≤10 menit.

## LANGKAH 3 — API (Go): build & restart

```bash
cd apps/api
go build -o sadar-api ./cmd/server
# restart proses API
```

Verifikasi keenam endpoint (semua harus 200, bukan 404):

```bash
B=http://127.0.0.1:8001/api/v1
curl -s "$B/spatial/population-summary?polygon=POLYGON((106.69%20-6.37,107.01%20-6.37,107.01%20-6.08,106.69%20-6.08,106.69%20-6.37))" | head -c 120; echo
curl -s "$B/spatial/critical-facilities?lat=-6.2&lon=106.8&radius_km=5" | head -c 120; echo
curl -s "$B/spatial/landcover-summary?polygon=POLYGON((106.69%20-6.37,107.01%20-6.37,107.01%20-6.08,106.69%20-6.08,106.69%20-6.37))" | head -c 120; echo
curl -s "$B/spatial/elevation-summary?min_lng=106.7&min_lat=-6.3&max_lng=106.9&max_lat=-6.1" | head -c 200; echo
curl -s "$B/map/operations/shakemaps?bbox=95,-11,142,7&zoom=5" | head -c 120; echo
```

Untuk `impact-score` butuh event nyata:

```bash
EID=$(docker exec $PG psql -U sadar -d sadar_bencana -t -A -c "SELECT event_id FROM events WHERE event_type='earthquake' AND event_time > now() - interval '48 hours' ORDER BY event_time DESC LIMIT 1;")
curl -s "$B/spatial/impact-score?event_id=$EID" | head -c 300; echo
```

Ekspektasi: JSON `{"data":{"score":...,"score_label":...,"components":...}}`.
Elevasi agak lambat pertama kali (mengunduh tile AWS) — normal 2–10 detik, lalu cache.

## LANGKAH 4 — Frontend: build & deploy

```bash
cd apps/web
npm ci
npm run build
# serve dist/ baru
```

## LANGKAH 5 — Caddyfile: dua entri CSP (cek & tambah bila belum)

```
connect-src: ... https://gibs.earthdata.nasa.gov    (P10 satelit IR)
img-src:     ... https://data.bmkg.go.id             (S6 shakemap MMI)
```

Reload caddy setelah edit. Gejala bila kurang: overlay satelit IR blank; shakemap toggle ON tapi kosong.

## LANGKAH 6 — Smoke test UI (browser, 3 menit)

1. **P9**: buka peta → panel legenda → tombol "Unduh peta (PNG)" → file PNG terunduh dengan footer atribusi.
2. **P10**: toggle "Satelit IR" → overlay awan inframerah tampil (butuh CSP langkah 5).
3. **P12**: zoom keluar hingga event mengklaster → titik-titik kecil berwarna di bawah lingkaran klaster.
4. **S1+S2+S3+S4+S5**: klik event gempa → panel detail menampilkan: **skor dampak** (angka + label), Populasi, Fasilitas kritis, Medan, Tutupan lahan.
5. **S6**: bila ada gempa dirasakan <24 jam → toggle "Shakemap MMI" menyala sendiri + overlay tampil; matikan manual → tidak menyala lagi (sesi itu).

## Perilaku yang WAJAR (bukan bug)

- Tabel `shakemap_overlays` boleh kosong — hanya gempa DIRASAKAN yang punya MMI (kebijakan BMKG).
- Elevasi lambat di request pertama per area (mengunduh tile SRTM; setelah itu cache memori).
- Panel dampak tetap tampil walau sebagian komponen gagal (graceful: "Data dampak area belum tersedia" per baris).
- Importer WorldPop/WorldCover hanya perlu sekali; ulang = idempoten (TRUNCATE + insert ulang).

## Troubleshooting ringkas

| Gejala | Sebab umum | Solusi |
|---|---|---|
| `population-summary` → error 500 / tabel tidak ada | Migration 041 belum jalan | Langkah 1 |
| populasi selalu 0 / `exposure_unavailable` | Importer WorldPop belum jalan | Langkah 2a (cek `spatial_datasets`) |
| landcover kosong semua | Migration 042 / importer belum | Langkah 1 + 2b |
| `impact-score` 404 event | `event_id` salah bentuk | Gunakan `event_id` kolom DB (bukan `bmkg:bmkg:...` dobel; keduanya kini didukung) |
| shakemap `observed_at` berformat `+07:00` | Binary API lama | Ulangi langkah 3 |
| overlay satelit IR blank di prod | CSP kurang `gibs.earthdata.nasa.gov` | Langkah 5 |
| shakemap toggle ON tapi kosong | CSP `img-src` / data belum tersinkron | Langkah 5 + tunggu 10 menit |
| worker gagal `pip install numpy` | Python prod tua | Gunakan venv worker; numpy>=2.0 butuh Python ≥3.10 |

## Definisi selesai

- [ ] Kode di `d3d64b7` (#122)
- [ ] Migrasi 041+042+043 applied (3 tabel + 2 fungsi zonal)
- [ ] Worker: deps terpasang; WorldPop ±2,27 jt baris; WorldCover ±4,04 jt baris; log "Shakemap sync"
- [ ] API: 6 endpoint baru merespons 200
- [ ] Frontend baru ter-deploy
- [ ] CSP: `gibs.earthdata.nasa.gov` + `data.bmkg.go.id`
- [ ] Smoke test UI: skor dampak di panel event; unduh PNG; satelit IR; shakemap auto/manual
