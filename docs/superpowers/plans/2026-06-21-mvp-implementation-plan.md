# Reinsurance Risk Monitor MVP Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Menyediakan bootstrap runnable pertama untuk Reinsurance Risk Monitor dengan shell dashboard, API health, skema awal, dan satu alur ingestion event publik.

**Architecture:** Monorepo sederhana dengan tiga executable utama: `apps/web`, `apps/api`, `apps/worker`. API domain utama di Go, ingestion/AI di Python, dan frontend dashboard di React + Vite.

**Tech Stack:** React, TypeScript, Vite, Tailwind, Go, Gin, Python, FastAPI, PostgreSQL, Redis, Docker Compose.

---

### Task 1: Bootstrap workspace manifest
**Objective:** Menyiapkan struktur monorepo runnable minimum.

**Files:**
- Create: `package.json`
- Create: `apps/web/package.json`
- Create: `apps/api/README.md`
- Create: `apps/worker/README.md`

**Step 1:** Tulis root `package.json` dengan workspace `apps/*` dan script `dev:web`, `verify`.

**Step 2:** Buat `apps/web/package.json` dengan Vite + React + TypeScript.

**Step 3:** Jalankan `npm install` di root.
Expected: dependency tree terpasang tanpa error.

**Step 4:** Commit.

### Task 2: Build web shell dashboard
**Objective:** Menyediakan dashboard placeholder yang bisa dibuka di browser.

**Files:**
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/features/executive/ExecutiveOverview.tsx`

**Step 1:** Tampilkan 4 KPI cards, watchlist, dan event map placeholder.

**Step 2:** Jalankan `npm run dev:web`.
Expected: halaman terbuka di `http://localhost:3001`.

**Step 3:** Verifikasi visual via browser.

**Step 4:** Commit.

### Task 3: Build API shell
**Objective:** Menyediakan service backend dasar dengan endpoint health.

**Files:**
- Create: `apps/api/go.mod`
- Create: `apps/api/cmd/server/main.go`
- Create: `apps/api/internal/http/health.go`

**Step 1:** Buat route `GET /health` dan `GET /api/v1/meta`.

**Step 2:** Jalankan `go run ./cmd/server`.
Expected: server listen di `:8001`.

**Step 3:** Verifikasi dengan `curl http://localhost:8001/health`.
Expected: `{"status":"ok"}`.

**Step 4:** Commit.

### Task 4: Create database baseline
**Objective:** Menyediakan schema awal domain inti.

**Files:**
- Create: `db/schema/001_init.sql`
- Create: `infra/local/docker-compose.yml`

**Step 1:** Tambahkan tabel `events`, `event_sources`, `alerts`, `risk_scores`.

**Step 2:** Jalankan compose untuk postgres dan redis.

**Step 3:** Apply schema.

**Step 4:** Commit.

### Task 5: Build worker ingestion skeleton
**Objective:** Menyediakan worker yang bisa mengambil satu feed publik dan menormalkan hasilnya.

**Files:**
- Create: `apps/worker/requirements.txt`
- Create: `apps/worker/main.py`
- Create: `apps/worker/connectors/usgs.py`
- Create: `apps/worker/normalizers/events.py`

**Step 1:** Ambil sample USGS earthquake feed.

**Step 2:** Normalisasi ke canonical event schema.

**Step 3:** Simpan ke database atau file mock.

**Step 4:** Commit.

### Task 6: Hook dashboard ke API
**Objective:** Menyambungkan web shell ke endpoint live.

**Files:**
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/lib/api/client.ts`

**Step 1:** fetch `/api/v1/meta`.

**Step 2:** Tampilkan status API, event count, last connector run.

**Step 3:** Verifikasi end-to-end dari browser.

**Step 4:** Commit.

### Task 7: Add source traceability UI
**Objective:** Menjamin setiap data bisa dilacak asalnya.

**Files:**
- Create: `apps/web/src/components/SourceBadge.tsx`
- Modify: `apps/web/src/features/executive/ExecutiveOverview.tsx`

**Step 1:** Tampilkan source badge di setiap alert/event.

**Step 2:** Verifikasi source timestamp dan source name tampil.

**Step 3:** Commit.

### Task 8: Add local AI briefing stub
**Objective:** Menyediakan jalur integrasi LLM lokal tanpa data sensitif.

**Files:**
- Create: `apps/worker/ai/briefing.py`
- Create: `apps/api/internal/http/briefings.go`

**Step 1:** Kirim 3 event publik ke local LLM.

**Step 2:** Simpan summary + source ids.

**Step 3:** Expose via `/api/v1/briefings/today`.

**Step 4:** Commit.

### Task 9: Verification pass
**Objective:** Membuktikan bootstrap runnable benar-benar jalan.

**Files:**
- Create: `scripts/smoke-test.sh`
- Update: `README.md`

**Step 1:** Jalankan web, api, worker, postgres, redis.

**Step 2:** Verifikasi `/health`, dashboard load, sample event tampil.

**Step 3:** Simpan hasil verifikasi di README.

**Step 4:** Commit.
