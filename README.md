# SadarBencana

Platform open-source untuk monitoring risiko bencana dan early warning. SadarBencana
menggabungkan sumber publik, feed resmi yang diizinkan, dan data internal untuk
menghasilkan monitoring event, risk scoring, historical intelligence, EWS, serta
executive dashboard yang dapat diaudit.

**Greenfield project** — dibangun dari nol tanpa memakai codebase AGPL, dengan fokus pada enterprise-readiness (RBAC, audit trail, explainability, source traceability).

> **Batas keselamatan:** SadarBencana adalah alat monitoring dan pendukung
> keputusan, bukan pengganti peringatan atau arahan evakuasi dari BMKG, BNPB,
> PVMBG, BPBD, dan instansi berwenang lainnya. Aplikasi tidak memprediksi waktu
> atau lokasi gempa.

## Tampilan Aplikasi

![Dashboard SadarBencana](docs/images/sadar-bencana-dashboard.png)

## Fitur Utama

- dashboard situational awareness untuk gempa, banjir, gunung api, dan karhutla;
- ingest sumber publik BMKG, USGS, GDACS, NASA FIRMS, Smithsonian GVP,
  PetaBencana, serta RSS berita;
- lifecycle peringatan resmi: active, update, expiry, dan cancellation;
- evidence correlation, source authority, freshness, confidence policy, dan
  risk scoring yang dapat dijelaskan;
- EWS berbasis watch zone dengan action card, acknowledgement, retry,
  dead-letter, dan notifikasi multi-channel;
- historical disaster warehouse, profil wilayah, seasonal analytics, dan AI
  regional analyst yang hanya menggunakan snapshot terstruktur;
- pengaturan sumber resmi dengan adapter terversi, configurable field mapping,
  preview tanpa penyimpanan, dry-run/shadow, activation gate, rollback, dan
  audit administrator;
- preview XLSX historis BMKG Data Online dengan checksum dan staging aman untuk
  record yang belum memiliki administrative boundary;
- daftar risiko privat per-user, aset personal dengan pin peta, serta
  accumulation analysis untuk portofolio perusahaan.

## Community dan Hosted

Satu codebase Apache 2.0 mendukung dua mode deployment:

- **`DEPLOYMENT_MODE=community`** — default self-hosted; aset personal dan
  portofolio perusahaan tidak memerlukan token.
- **`DEPLOYMENT_MODE=hosted`** — digunakan sadarbencana.id; aset personal
  dibatasi `PERSONAL_ASSET_LIMIT` dan portofolio perusahaan memerlukan token
  organisasi bertanda tangan.

### Akses halaman (persyaratan login)

| Halaman | Login Wajib | Catatan |
|---|---|---|
| **Daftar Risiko** | ✅ | Aset personal di-scope ke user; portofolio hosted di-scope ke organisasi |
| **EWS** (Early Warning System) | ✅ | Monitoring alert dan early warning |
| **Sumber Resmi** | ✅ Admin | Konfigurasi feed, token, preview, dry-run, rollback, dan audit |
| Executive Overview | ❌ | Public dashboard |
| Events, Alerts, Briefing, Riwayat Wilayah | ❌ | Public |
| AI Copilot | ❌ | Public |
| Source Health | ❌ | Public |

### Petunjuk untuk pengguna

Pengguna sadarbencana.id memperoleh hingga 20 aset personal. Organisasi dapat
meminta token portofolio perusahaan kepada pengelola. Instalasi community tetap
dapat digunakan mandiri tanpa bergantung pada layanan lisensi.

---

## Tech Stack

| Komponen | Teknologi | Versi |
|---|---|---|
| Frontend | React + Vite | 18 + v5 |
| Language (Frontend) | TypeScript | v5+ |
| Backend API | Go + Gin | 1.25 + gin |
| Data Access | database/sql + pgx | sql, pgx |
| Worker / Ingestion | Python + FastAPI | 3.11+ + uvicorn |
| AI / Briefing | TypeScript + Mastra | sesuai lockfile |
| Database | Supabase Postgres / PostgreSQL | kompatibel PostgreSQL 16 |
| Cache | Redis | 7 |
| Auth | Supabase Auth (JWT ES256) | — |
| Package Manager | npm (monorepo workspaces) | v10+ (Node 20+) |

---

## Port & Service Endpoints

| Service | Port | Deskripsi |
|---|---|---|
| **Web** (Vite dev) | 3001 | Frontend dashboard |
| **API** (Go) | 8001 | Business API `/api/v1/*` |
| **Worker** (FastAPI) | 8002 | Ingestion, scoring, AI briefing |
| **Mastra AI** | 4111 | AI assistant backend (local dev saja) |
| **Redis** | 6379 | Cache |

---

## Instalasi

### Prasyarat

- **Docker & Docker Compose** (untuk opsi A)
- **Node.js 20+**, **Go 1.25**, **Python 3.11+** (untuk opsi B)
- **PostgreSQL 16** + **Redis 7** (untuk opsi B; atau gunakan container)

### Opsi A: Docker Compose (Paling Sederhana)

Menjalankan stack aplikasi dalam container: redis, api, worker, web. Database utama tetap Supabase melalui `DATABASE_URL`.

```bash
# 1. Clone repo dan masuk direktori
git clone https://github.com/setiyadinamikaintegrasi/sadar-bencana.git
cd sadar-bencana

# 2. Copy .env.example ke .env
cp .env.example .env

# 3. Isi DATABASE_URL, konfigurasi Supabase, dan dua token internal di .env
# Generate WORKER_API_TOKEN dan MASTRA_API_TOKEN secara terpisah:
openssl rand -hex 32
openssl rand -hex 32

# 4. Jalankan docker compose
docker compose up -d

# 5. Akses dashboard
# Buka browser: http://localhost:3001
```

**Troubleshooting Docker Compose:**

- Jika API/worker gagal start, cek `DATABASE_URL`, konfigurasi Supabase,
  `WORKER_API_TOKEN`, dan `MASTRA_API_TOKEN`.
- Lihat status semua container: `docker compose ps`
- Hentikan semua service: `docker compose down`

### Opsi B: Pengembangan Lokal (tanpa container app)

Jalankan Redis dalam container, namun API, Web, Mastra dijalankan di host. Database tetap Supabase melalui `.env.local`.

```bash
# 1. Clone repo dan masuk direktori
git clone https://github.com/setiyadinamikaintegrasi/sadar-bencana.git
cd sadar-bencana

# 2. Install dependency Node.js dari root
npm install

# 3. Jalankan Redis saja dalam container
docker compose up -d redis

# 4. Copy .env.example menjadi .env.local, lalu edit nilainya
cp .env.example .env
cp .env.example .env.local

# 5a. Jalankan semua service sekaligus (recommended)
./start.sh

# atau 5b. Jalankan per-service secara manual:

# API (Go) — di terminal 1
cd apps/api && go run ./cmd/server  # :8001

# Mastra (TypeScript) — di terminal 2
cd apps/mastra && npx mastra dev  # :4111

# Web (Vite) — di terminal 3
npm run dev --workspace apps/web  # :3001

# Worker (Python, jika diperlukan) — di terminal 4
cd apps/worker
python -m venv venv
source venv/bin/activate  # atau: venv\Scripts\activate (Windows)
pip install -r requirements.txt
uvicorn main:app --reload --port 8002  # :8002

# 6. Akses dashboard
# Buka browser: http://localhost:3001
```

**Catatan start.sh:**

- `start.sh` otomatis membaca `.env.local` dan menjalankan API, Mastra, Web sekaligus.
- Saat Vite dev server hidup, supervisor lokal memantau port API `8001` dan
  worker `8002`; service yang berhenti akan dijalankan kembali otomatis.
  Supervisor hanya aktif pada mode `vite serve`, tidak pada production build.
- Log disimpan di `.logs/` (api.log, mastra.log, vite.log, worker.log).
- Hentikan semua: `./stop.sh`

---

## Konfigurasi Environment

### Root `.env` (untuk Docker Compose)

Disalin dari `.env.example`. Digunakan saat `docker compose up`. Runtime utama memakai Supabase; jangan arahkan `DATABASE_URL` ke Postgres Docker lokal kecuali sedang menjalankan eksperimen isolated dev di `infra/local`. Variabel:

- `DATABASE_URL` — **wajib** Supabase pooled connection string
- `SUPABASE_URL`, `SUPABASE_JWT_SECRET` — konfigurasi Supabase Auth/JWT
- `REDIS_URL` — koneksi Redis
- `API_HOST`, `API_PORT`, `API_ENV` — konfigurasi API
- `WORKER_BASE_URL` — alamat internal worker untuk proxy operasi import/preview
- `WORKER_API_TOKEN` — bearer token internal API ↔ Worker, minimal 32 karakter
- `MASTRA_BASE_URL`, `MASTRA_API_TOKEN` — alamat dan bearer token internal Mastra
- `LLM_BASE_URL`, `LLM_TIMEOUT`, `LLM_MODEL` — integrasi llama.cpp (opsional)
- `VITE_API_BASE_URL` — base URL API untuk Vite (default: `/api/v1`)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — delivery alert Telegram (opsional)
- `CONNECTOR_BMKG_CAP_ENABLED` — ingest peringatan dini cuaca CAP BMKG; aktifkan setelah migration 019 dan 021
- `CONNECTOR_INATEWS_ENABLED`, `INATEWS_FEED_URL` — bulletin InaTEWS yang telah diizinkan
- `CONNECTOR_PVMBG_ENABLED`, `PVMBG_FEED_URL` — advisory PVMBG/MAGMA yang telah diizinkan
- `CONNECTOR_BNPB_ENABLED`, `BNPB_FEED_URL` — situation report BNPB yang telah diizinkan
- `CONNECTOR_INARISK_ENABLED`, `INARISK_FEED_URL` — enrichment InaRISK yang telah diizinkan
- `OFFICIAL_SOURCE_SETTINGS_KEY` — kunci enkripsi token sumber resmi di database
- `EVIDENCE_CORRELATION_ENABLED` — shadow-mode correlation; aktifkan setelah migration 022
- `AISSTREAM_API_KEY`, `VESSELFINDER_API_KEY`, `OPENSKY_*` — tracking maritim & penerbangan (opsional)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` — email SMTP (opsional)
- `EWS_DELIVERY_ENABLED`, `EWS_LIFECYCLE_DELIVERY_ENABLED` — queue delivery dan lifecycle EWS

Panduan hardening deployment tersedia di
[`docs/production-security-deployment.md`](docs/production-security-deployment.md).

### Root `.env.local` (untuk pengembangan lokal, gitignored)

Dibaca oleh `start.sh`. Variabel kunci:

```env
# Database — gunakan Supabase pooled connection string
DATABASE_URL=postgresql://postgres.<project-ref>:***@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres

# Supabase Auth (opsional, jika menggunakan Supabase)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_JWT_SECRET=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Supabase JWKS endpoint (opsional, diturunkan otomatis dari SUPABASE_URL)
# SUPABASE_JWKS_URL=https://your-project.supabase.co/auth/v1/.well-known/jwks.json

# Mode community untuk development/self-hosted
DEPLOYMENT_MODE=community
PERSONAL_ASSET_LIMIT=20
RISK_FREE_LIMIT=0

# (Opsional) Override default API configuration
# API_PORT=8001
# API_ENV=local
# MASTRA_BASE_URL=http://127.0.0.1:4111
# WORKER_BASE_URL=http://127.0.0.1:8002
```

### `apps/web/.env.local` (untuk frontend, gitignored)

Disalin dari `apps/web/.env.example`. Variabel:

```env
# Supabase Auth
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# (Opsional) API base URL — default: /api/v1
# VITE_API_BASE_URL=/api/v1
```

### Default Values (jika env tidak diset)

Jika environment variable tidak ada, API menggunakan nilai default:

```
API_PORT=8001
API_ENV=local
MASTRA_BASE_URL=http://127.0.0.1:4111
DEPLOYMENT_MODE=community
PERSONAL_ASSET_LIMIT=20
RISK_FREE_LIMIT=0
DATABASE_URL=postgresql://postgres.<project-ref>:***@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres
```

---

## Setup Supabase Auth

Jika menggunakan Supabase untuk autentikasi (recommended untuk production):

1. **Buat project di Supabase:**
   - Buka https://supabase.com
   - Buat project baru, catat **Project URL** dan **anon key** (Settings → API)

2. **Konfigurasi frontend** (`apps/web/.env.local`):
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

3. **Konfigurasi backend** (root `.env.local`):
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_JWT_SECRET=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

4. **Verifikasi koneksi:**
   - API secara otomatis mengambil JWKS dari Supabase dan memverifikasi token user (ES256).
   - Frontend dapat login/signup melalui Supabase Auth UI.

---

## Sumber Data

### Sumber publik default

Instalasi dapat menggunakan sumber yang tidak membutuhkan kredensial khusus:

- BMKG Open Data untuk gempa Indonesia;
- USGS sebagai cakupan/fallback gempa global;
- GDACS untuk alert bencana global;
- NASA FIRMS untuk hotspot;
- Smithsonian GVP untuk aktivitas gunung api;
- PetaBencana untuk laporan banjir;
- RSS berita sebagai evidence pendukung, bukan sumber tunggal alert kritis.

Selalu tampilkan attribution dan URL sumber. Ketersediaan endpoint publik dapat
berubah; source-health akan menandai sumber stale/error tanpa mengubah berita
menjadi peringatan resmi.

### Feed resmi yang memerlukan izin atau konfigurasi

InaTEWS, PVMBG/MAGMA, BNPB, dan InaRISK **default disabled**. Jangan mengaktifkan
connector dengan endpoint hasil scraping atau endpoint yang belum diizinkan.
Setelah memperoleh izin:

1. login sebagai admin dan buka **Sumber Resmi**;
2. pilih adapter version dan masukkan endpoint/token;
3. jalankan Preview;
4. simpan konfigurasi sebagai dry-run/shadow;
5. aktifkan hanya jika contract test dan dry-run pada config version yang sama
   berhasil.

Token dienkripsi menggunakan `OFFICIAL_SOURCE_SETTINGS_KEY`. Preview tidak
menyimpan payload. Perubahan konfigurasi, aktivasi, dan rollback dicatat dengan
identitas administrator.

BMKG Data Online saat ini digunakan sebagai sumber unduhan historis XLSX, bukan
sebagai API credential. Preview XLSX tersedia di halaman **Sumber Resmi**.
Impor final baru dapat dilakukan setelah titik gempa dipetakan ke administrative
boundary resmi dan terversi.

Lihat [Pengaturan Sumber Resmi](docs/official-source-settings.md),
[Onboarding Sumber Resmi](docs/official-source-onboarding.md), dan
[Impor BMKG Data Online](docs/bmkg-data-online-import.md).

---

## Migrasi Database

File migrasi SQL tersimpan di `db/schema/` (`001_init.sql` sampai
`033_bmkg_data_online_import.sql`). Terapkan **berurutan** menurut nomor.

### Untuk Docker Compose

Root Docker Compose tidak lagi menjalankan PostgreSQL lokal. Migrasi schema harus diterapkan ke Supabase/Postgres target menggunakan `DATABASE_URL`.

### Untuk pengembangan lokal (manual)

Terapkan migrasi langsung ke database Supabase/Postgres target:

```bash
# Untuk setiap file migrasi (001_init.sql, 002_*, etc.) jalankan ke Supabase:
psql "$DATABASE_URL" -f db/schema/001_init.sql
psql "$DATABASE_URL" -f db/schema/002_briefings.sql
# ... lanjutkan untuk semua file
```

Atau, jika menggunakan Supabase:

- Buka **SQL Editor** di dashboard Supabase
- Copy-paste isi tiap file `db/schema/00*.sql` dan jalankan secara berurutan

### Verifikasi migrasi

```bash
# Cek tabel di Supabase/Postgres target
psql "$DATABASE_URL" -c '\dt'
```

---

## Verifikasi Instalasi

Setelah menjalankan installer, pastikan semua service sehat:

### Health check

```bash
# API health endpoint
curl http://localhost:8001/health
# Expected: 200 OK

# API metadata
curl http://localhost:8001/api/v1/meta
# Expected: JSON metadata

# Frontend
curl http://localhost:3001
# Expected: HTML dashboard (atau redirect ke login)

# (Opsional) Cek struktur repo
bash scripts/verify-structure.sh
# Expected: "✅ All checks passed"
```

### Log untuk troubleshooting

- **Docker Compose:**
  ```bash
  docker compose logs -f api      # tail API logs
  docker compose logs -f worker   # tail Worker logs
  # Database logs ada di Supabase Dashboard, bukan container lokal root compose.
  ```

- **Pengembangan lokal:**
  ```bash
  tail -f .logs/api.log
  tail -f .logs/vite.log
  tail -f .logs/mastra.log
  tail -f .logs/worker.log
  ```

---

## Dokumentasi Lanjutan

Untuk informasi lebih detail tentang arsitektur, deployment, dan fitur:

- **[Daftar Risiko Deployment](docs/daftar-risiko-deployment.md)** — mode community/hosted, aset personal, dan token organisasi
- **[EWS Setup](docs/ews-setup.md)** — konfigurasi Early Warning System
- **[Official Alert Lifecycle](docs/official-alert-lifecycle.md)** — revision, expiry, update, dan cancellation alert resmi
- **[BMKG CAP Nowcast](docs/bmkg-cap-nowcast.md)** — konfigurasi, attribution, normalisasi, dan lifecycle peringatan BMKG
- **[Source Evidence Model](docs/source-evidence-model.md)** — provenance, confidence, laporan dampak, dan konteks risiko
- **[Evidence Correlation](docs/evidence-correlation.md)** — korelasi lintas sumber, review queue, serta audit merge/split
- **[Risk Scoring v2](docs/risk-scoring-v2.md)** — formula peril-aware, exposure, vulnerability, confidence, dan fallback
- **[Alert Confidence Policy](docs/alert-confidence-policy.md)** — confidence class, lifecycle action, stale behavior, dan override audit
- **[EWS Lifecycle Delivery](docs/ews-lifecycle-delivery.md)** — revision dedup, cancellation delivery, retry, dead-letter, dan latency
- **[EWS Action Cards](docs/ews-action-cards.md)** — panduan keselamatan lokal, terkurasi, versioned, dan aksesibel
- **[EWS Map Overlays](docs/ews-map-risk-overlays.md)** — official polygon, static risk, watch zone, legend, dan time slider
- **[Disaster Replay Harness](docs/disaster-replay-harness.md)** — precision, recall, lifecycle, latency, dan golden regression gates
- **[Disaster Observability](docs/disaster-observability-slo.md)** — telemetry, correlation ID, alert volume, dan operational SLO
- **[Disaster Operations Runbook](docs/disaster-operations-runbook.md)** — outage, false alert, correction, cancellation, incident review, dan disclaimer
- **[Historical Disaster Warehouse](docs/historical-disaster-warehouse.md)** — dataset version, administrative boundary, impact revision, dan resumable backfill
- **[Regional History API](docs/regional-history-api.md)** — timeline, seasonality, impact, source coverage, dan freshness berbasis kode wilayah
- **[Historical Risk Analytics](docs/historical-risk-analytics.md)** — tren, seasonality, impact rate, anomaly, confidence, dan missing data
- **[AI Regional Analyst](docs/ai-regional-risk-analyst.md)** — grounded snapshot, citations, audit, limitations, dan refusal policy
- **[Remaining Official Sources](docs/remaining-official-sources.md)** — approved-feed contract InaTEWS, PVMBG, BNPB, dan InaRISK
- **[AI Analysis Evaluation](docs/ai-analysis-evaluation.md)** — numerical consistency, citation coverage, refusal, dan human rubric
- **[Official Source Settings](docs/official-source-settings.md)** — mode Auto/default/custom, encrypted token, admin access, dan URL allowlist
- **[Official Source Onboarding](docs/official-source-onboarding.md)** — adapter version, configurable mapping, preview, dry-run, activation, rollback, dan audit
- **[Historical Backfill Runner](docs/historical-backfill-runner.md)** — JSON/CSV resmi, checkpoint, idempotency, dan rejection queue
- **[BMKG Data Online Import](docs/bmkg-data-online-import.md)** — preview XLSX historis, staging unresolved, boundary mapping, dan audit
- **[Dependency Risk Register](docs/security/dependency-risk-register.md)** — advisory dependency yang diterima sementara beserta kontrol dan jadwal review
- **[Architecture](docs/architecture/2026-06-21-technical-architecture.md)** — arsitektur teknis sistem
- **[Disaster Intelligence Roadmap](docs/roadmap/2026-06-29-disaster-intelligence-improvement-roadmap.md)** — tahapan source resmi, historical intelligence, dan AI analyst

---

## Pengembangan

### Menjalankan test

```bash
# Frontend (React) — type-check via build (belum ada test runner terpasang)
npm run build --workspace apps/web

# API (Go)
cd apps/api && go test ./...

# Worker (Python)
cd apps/worker && pytest
```

### Build untuk production

```bash
# Frontend
npm run build --workspace apps/web
# Output: apps/web/dist/

# API (Go)
cd apps/api && go build -o sadar-api ./cmd/server

# Worker (Python)
cd apps/worker && pip install -r requirements.txt
# Siap deploy container
```

### Code organization

- `apps/web/` — React components, pages, hooks, utils
- `apps/api/` — Go handlers, models, middleware, integration dengan eksternal data
- `apps/worker/` — Python ingestion tasks, scoring, AI briefing
- `apps/mastra/` — TypeScript AI assistant backend
- `packages/` — shared domain models, types, utilities
- `db/schema/` — SQL migrations dan init scripts
- `docs/` — dokumentasi teknis, blueprint, ADR
- `infra/local/` — catatan local deployment

---

## Lisensi

Proyek ini dirilis di bawah lisensi **[Apache License 2.0](LICENSE)** — lisensi permisif dengan klausul hibah paten eksplisit. Anda bebas menggunakan, memodifikasi, dan menjalankan instance self-hosted Anda sendiri. Informasi atribusi tersedia pada [NOTICE](NOTICE).

---

## Support & Kontribusi

Untuk pertanyaan, issue, atau kontribusi:

- Baca **[CONTRIBUTING.md](CONTRIBUTING.md)** sebelum mengirim Pull Request
- Baca **[SUPPORT.md](SUPPORT.md)** untuk memilih kanal bantuan yang tepat
- Laporkan kerentanan secara privat sesuai **[SECURITY.md](SECURITY.md)**
- Patuhi **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** dalam seluruh ruang komunitas
- Lihat **[CHANGELOG.md](CHANGELOG.md)** untuk perubahan penting antarversi
- Laporkan bug atau usulkan fitur lewat **[GitHub Issues](../../issues)** (tersedia template Laporan Bug & Usulan Fitur)
- Pertanyaan umum & ide: gunakan **GitHub Discussions**

---

**Dibuat dengan ❤️ oleh tim Setiya Dinamika Integrasi Project**
