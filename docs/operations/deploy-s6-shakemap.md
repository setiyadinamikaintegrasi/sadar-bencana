# Instruksi Deploy: PR #122 — Overlay Shakemap MMI BMKG (Sprint 6 S6)

## Konteks

Repo aplikasi: `sadar-bencana` (repo lokal di VPS: `reinsurance-risk-monitor`).
PR #122 baru saja di-merge ke `main` (fitur: overlay Shakemap MMI BMKG pada peta operasional, termasuk auto-aktif saat ada gempa dirasakan baru <24 jam).

Komponen yang berubah:
- **DB**: migration baru `db/schema/043_shakemap_overlays.sql` (tabel `shakemap_overlays`)
- **API (Go)**: endpoint baru `GET /api/v1/map/operations/shakemaps` (+ field `observed_at` format UTC "Z")
- **Worker (Python)**: connector baru `apps/worker/connectors/bmkg_shakemap.py` + scheduler baru (sinkron tiap 10 menit, jalan otomatis saat worker start; tanpa dependency baru)
- **Web (frontend)**: toggle legenda "Shakemap MMI", layer overlay raster, auto-aktif

Lingkungan prod: PostgreSQL di Docker (container bernama seperti `sadar-postgres` — sesuaikan), API Go di-build jadi binary, worker Python jalan sebagai proses, frontend di-serve dari `apps/web/dist/`.

## Langkah Deploy (urutan wajib)

### 1. Sinkronkan kode ke main terbaru

```bash
cd <direktori-repo-prod>
git fetch origin
git reset --hard origin/main
git log --oneline -1   # harus menunjukkan commit merge PR #122 (feat(map): S6 — overlay Shakemap MMI BMKG)
```

### 2. Apply migration 043 ke database (SEBELUM binary baru)

```bash
docker cp db/schema/043_shakemap_overlays.sql <nama-container-postgres>:/tmp/043.sql
docker exec <nama-container-postgres> psql -U sadar -d sadar_bencana -f /tmp/043.sql
```

- Ekspektasi output: `CREATE TABLE`, `CREATE INDEX`, `COMMENT`, `COMMIT` (atau `psql:... already exists` bila pernah jalan — aman, migration ditulis idempoten-friendly).
- Tabel akan KOSONG setelah dibuat — itu NORMAL, tidak ada importer manual. Data terisi otomatis oleh worker dalam ≤10 menit setelah restart.

### 3. Build & restart API (Go)

```bash
cd apps/api
go build -o sadar-api ./cmd/server
# restart proses API sesuai manajemen proses prod (systemd/supervisor/pm2/docker)
```

Verifikasi cepat:

```bash
curl -s "http://127.0.0.1:8001/api/v1/health" || true
curl -s "http://127.0.0.1:8001/api/v1/map/operations/shakemaps?bbox=95,-11,142,7&zoom=5"
```

- Respons `{"type":"FeatureCollection","layer":"shakemaps","features":[],"truncated":false}` = endpoint hidup (kosong wajar sebelum worker sinkron).

### 4. Restart Worker (Python) — tanpa install dependency baru

```bash
# cukup restart; connector dan scheduler baru aktif otomatis
# scheduler _shakemap_sync_once berjalan tiap 600 detik, eksekusi pertama saat startup
```

Verifikasi log worker menunjukkan sinkronisasi (dalam ≤10 menit):

```bash
# cari baris seperti: "Shakemap sync: N fetched, N verified, N new"
# atau warning "shakemap feed ... gagal" bila BMKG sedang down (tidak fatal)
```

### 5. Build & deploy frontend

```bash
cd apps/web
npm ci
npm run build
# serve dist/ baru via nginx/caddy sesuai setup prod
```

### 6. Verifikasi end-to-end

a) Data terisi (setelah worker sinkron ≥1 siklus):

```bash
docker exec <nama-container-postgres> psql -U sadar -d sadar_bencana \
  -c "SELECT event_id, magnitude, felt_reports, fetched_at FROM shakemap_overlays;"
```

- Ekspektasi: 0–beberapa baris. **Nol baris pun VALID** — BMKG hanya membuat shakemap untuk gempa yang DIRASAKAN (feed gempadirasakan); bila beberapa hari terakhir tidak ada gempa dirasakan, tabel memang kosong.

b) Endpoint publik via domain prod:

```bash
curl -s "https://<domain-prod>/api/v1/map/operations/shakemaps?bbox=95,-11,142,7&zoom=5"
```

- Bila ada data: setiap feature punya `properties.shakemap_url`, `shakemap_bbox` (4 angka = bbox 5°×5° berpusat episenter), `felt_reports`, `event_id`, dan `observed_at` **berakhiran "Z"** (UTC). JIKA `observed_at` berformat `+07:00` (bukan Z), binary API masih versi lama — ulangi langkah 3.

c) UI: buka peta prod.
- Bila ada gempa dirasakan baru (<24 jam) dalam viewport: toggle "Shakemap MMI" di legenda **menyala sendiri** dan overlay peta intensitas tampil.
- Bila tidak ada yang fresh: nyalakan toggle manual; overlay muncul 1–3 detik (unduhan gambar dari data.bmkg.go.id) untuk event yang tersimpan.
- Matikan toggle manual → tidak menyala lagi otomatis di sesi itu (perilaku diinginkan).

## Catatan perilaku (jangan dianggap bug)

1. **Tidak semua gempa punya shakemap** — hanya yang dirasakan masyarakat (kebijakan BMKG). Gempa besar di laut lepas boleh jadi tanpa overlay.
2. **Riwayat terbatas** — hanya gempa dirasakan yang masih ada di feed BMKG (~15 terakhir) yang tersinkron; tidak ada backfill historis.
3. **Volume kecil & aman** — maks 40 upsert per 10 menit; feed BMKG down → skip senyap, tidak mengganggu ingest lain.
4. **Latensi kemunculan** — gempa baru → overlay tersedia ≤10 menit kemudian (interval scheduler).

## Troubleshooting

| Gejala | Cek | Solusi |
|---|---|---|
| Toggle ON tapi overlay kosong | `shakemap_overlays` di DB kosong? Log worker? | Tunggu siklus worker; cek feed BMKG reachable dari VPS: `curl -s https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json` |
| Overlay tak tampil di prod tapi tampil di dev | CSP Caddyfile | Tambah `https://data.bmkg.go.id` ke `img-src` |
| `observed_at` berformat `+07:00` | Binary API lama | Ulangi langkah 3 (build+restart API) |
| Auto-aktif tak bekerja | Data fresh ada? (`fetched_at` < 24 jam) | Auto-aktif hanya untuk data <24 jam; cek juga toggle pernah dimatikan manual (reload halaman mereset) |
| Worker log: "shakemap feed ... gagal" | Jaringan VPS → data.bmkg.go.id | Sementara down di sisi BMKG; scheduler retry otomatis 10 menit |

## Sekalian (backlog CSP lama, sekali cek)

Pastikan `connect-src` Caddyfile juga mengandung `https://gibs.earthdata.nasa.gov` (untuk overlay satelit IR dari PR #114) bila belum ditambahkan.

## Rollback

Tidak perlu rollback khusus: tabel boleh kosong, endpoint mengembalikan koleksi kosong, layer frontend diam, auto-aktif tak terpicu tanpa data fresh. Cukup rollback binary/API/frontend ke versi sebelumnya bila diperlukan.

## Definisi selesai

- [ ] Migration 043 applied
- [ ] API baru: endpoint `/api/v1/map/operations/shakemaps` merespons (kosong/berisi, tanpa error 404/500)
- [ ] `observed_at` berakhiran `Z` pada respons (bila ada data)
- [ ] Worker log menunjukkan siklus "Shakemap sync" tanpa error fatal
- [ ] Frontend prod: toggle "Shakemap MMI" ada di legenda; overlay tampil bila data tersedia
- [ ] (Bila ada gempa fresh) auto-aktif bekerja tanpa klik manual
