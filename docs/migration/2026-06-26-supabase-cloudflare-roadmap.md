# Roadmap Migrasi — Sadar Bencana ke Supabase + Cloudflare Workers

## Context

Pemicu awal: halaman EWS harus **hanya bisa diakses setelah subscribe** (kontrol akses).
Saat menggali, ternyata aplikasi **belum punya autentikasi sama sekali** (hanya CORS),
dan user memutuskan dalam waktu dekat akan **pindah ke Cloudflare Workers** dengan
**Supabase** sebagai DB + Auth.

Konsekuensi kunci: Cloudflare Workers (serverless edge, V8 isolates, tanpa proses
long-lived) **tidak bisa menjalankan Go Gin maupun Python FastAPI apa adanya**. Jadi ini
bukan lagi "fitur kecil" melainkan **migrasi platform multi-fase**. Dokumen ini adalah
PETA migrasi — bukan implementasi. Tiap fase nanti punya brainstorm → spec → plan sendiri.

Hasil yang diinginkan: migrasi **bertahap & rendah risiko (strangler-fig)** yang
mengantarkan **gate EWS sebagai pilot slice**, berakhir di stack Cloudflare-native
(Pages + Workers) di atas Supabase, dengan Python ingest sebagai bagian tersulit (long pole).

### Model akses (3 tier) — bukan seluruh aplikasi yang dikunci

Hanya 3 halaman yang butuh login; sisanya tetap publik.

| Tier | Halaman | Syarat |
|------|---------|--------|
| **Publik** (tanpa login) | Executive Overview, Events, Alerts, Briefing, AI Copilot, Source Health | — |
| **Authenticated / free** | **EWS** (`EwsPage`) | Cukup login (subscribe) |
| **Paid / Pro** | **Kontrak / Risiko** (`ContractsPage`), **Claim** (belum dibangun, kini "coming soon") | Login **+ entitlement berbayar** (perusahaan berlangganan) |

Implikasi: butuh **role/entitlement** di atas auth dasar — sebuah kolom `plan`/`entitlement`
(atau tabel `companies`/`subscriptions`) yang dicek per halaman berbayar. Penegakan harus
di **backend** (Worker memeriksa JWT + entitlement), bukan sekadar sembunyikan menu di frontend.

---

## Kondisi saat ini (hasil eksplorasi)

| Komponen | Fakta | Kesiapan Cloudflare |
|----------|-------|---------------------|
| `apps/web` | React 18 + Vite, navigasi berbasis `useState` (tanpa router), Supabase Auth via `@supabase/supabase-js` | **Mudah** → Cloudflare Pages apa adanya |
| `apps/api` | Go/Gin, pgx stdlib, raw SQL; `DATABASE_URL` wajib diarahkan ke Supabase pooled connection string; :8001 | **Rewrite bertahap** → Hono di Workers (logika SQL portabel) |
| `apps/worker` | Python FastAPI + asyncpg, :8002; scheduler (ingest 5m, news, briefing, assets); connectors BMKG/USGS/NASA FIRMS/GVP/PetaBencana/GDACS; dispatcher EWS | **Tersulit (long pole)** — proses long-lived + scheduler |
| `apps/mastra` | TS; `@mastra/core`; model `@ai-sdk/openai` (lokal llama `:8080` + DeepSeek HTTP) di `src/mastra/shared/model.ts`; storage `@mastra/libsql` file lokal di `src/mastra/index.ts`; tools panggil API/worker via HTTP | **Mudah** → Mastra Cloudflare deployer; ganti model + storage |
| DB | Docker Postgres `:5433`, schema `db/schema/001–013` (termasuk EWS) | Pindah ke **Supabase Postgres** |
| LLM | `llama-server :8080` (lokal) | Diganti hosted (DeepSeek/Workers AI/Claude) |

Pola besar: **web, Go API, Mastra relatif gampang**; **Python worker** yang berat.

---

## Arsitektur target

- **Supabase**: Postgres terkelola + **Auth (GoTrue/JWT)** + opsional RLS/Realtime.
- **Cloudflare**: **Pages** (web), **Workers** (API berbasis Hono), **Cron Triggers/Queues**
  untuk job terjadwal, **Hyperdrive** untuk pooling Postgres dari edge, opsional **Workers AI**.
- **Mastra**: di Workers (Cloudflare deployer); model → hosted; storage → Supabase/Turso/D1.
- **Python worker**: jangka pendek tetap di **container** (Fly/Railway) menunjuk Supabase;
  jangka panjang rewrite bertahap ke Workers Cron Triggers.

**Strategi: strangler-fig (bertahap)** — jalankan lama & baru berdampingan, pindah per slice,
hapus yang lama saat selesai. Alternatif big-bang lebih cepat selesai tapi jauh lebih berisiko.

---

## Fase (tiap fase = sub-proyek dengan spec sendiri)

**Fase 0 — Fondasi Supabase.** Project Supabase menjadi source of truth; jalankan `db/schema/001–013`
(perhatikan extension `uuid-ossp`) langsung ke Supabase bila schema belum lengkap; pastikan
**DATABASE_URL** Go API (`config.go`), worker (`db/pool.py`), dan Mastra mengarah ke Supabase.
Tanpa perubahan fitur. *Tujuan: semua yang ada tetap jalan di DB cloud dan tidak fallback ke DB lokal.*

**Fase 1 — Auth + Gate EWS (PILOT).** Supabase Auth signup/login di web (`supabase-js`);
kaitkan auth user ↔ baris `ews_subscriber`; bangun endpoint EWS sebagai **Worker Hono
pertama**; verifikasi **JWT Supabase** di Worker; route guard di frontend (EWS terkunci
sampai login); opsional RLS agar tiap subscriber hanya lihat datanya. *Memenuhi kebutuhan
awal (EWS = login/free) + membuktikan stack baru di permukaan kecil.*

**Fase 1b — Entitlement & fitur berbayar (Claim, Kontrak/Risiko).** Tambahkan konsep
**plan/entitlement** (kolom `plan` pada profil user, atau tabel `companies`/`subscriptions`);
kunci `ContractsPage` + (nanti) Claim di frontend **dan** di backend (Worker cek
entitlement, bukan hanya sembunyikan menu). Penagihan: mulai dari **entitlement manual**
(flag di-set admin) lalu opsional integrasi **Stripe** belakangan. *Bisa setelah Fase 1
atau setelah API dipindah (Fase 2), tergantung kapan Claim/Kontrak dipindah ke Workers.*

**Fase 2 — Migrasi API Go → Hono Workers.** Pindahkan endpoint tersisa slice demi slice
(events, news, risk-scores, alerts, contracts, accumulation, assets, connector health) ke
Workers (akses DB via Hyperdrive atau `supabase-js`). Decommission Go saat semua pindah.

**Fase 3 — Mastra → Workers.** Deploy via Cloudflare deployer; ganti default model dari
llama lokal ke **hosted** (DeepSeek sudah ada / Workers AI / Claude) di `shared/model.ts`;
pindah storage dari LibSQL file ke **Supabase/Turso/D1** di `index.ts`; repoint env URL tools.
Frontend panggil Mastra Worker langsung (dengan JWT) atau lewat gateway Hono.

**Fase 4 — Python worker (long pole).** Opsi A (cepat): tetap di **container** menunjuk
Supabase. Opsi B (akhir): rewrite connectors + scheduler ke **Workers Cron Triggers + Queues**
secara bertahap. Rekomendasi: A dulu, B menyusul per connector.

**Fase 5 — Cutover & cleanup.** DNS/domain, env produksi, hapus Docker + LLM lokal, CI
berbasis `wrangler`, hapus kode mati Go/Python.

---

## Concern lintas-fase

- **Pooling dari edge**: Supabase pooler (Supavisor) / Cloudflare Hyperdrive — Workers tak
  cocok dengan koneksi TCP Postgres tradisional.
- **Secrets**: `wrangler secret` + env Supabase (jangan hardcode).
- **Biaya/limit**: free tier Supabase (≈500MB, batas koneksi) & limit Workers — cek lebih awal.
- **Migrasi data**: `pg_dump`/restore bila masih ada data historis lokal; verifikasi FK & extension;
  runtime utama sudah diarahkan ke Supabase melalui `DATABASE_URL`.

---

## Open decisions (diputuskan di fase terkait, tidak memblok roadmap)

1. **Lingkup gate**: ✅ **TERPUTUS** — hanya **EWS** (login/free) + **Claim** & **Kontrak/Risiko** (berbayar); sisanya publik.
2. **Arti "subscribe" EWS**: self-signup terbuka vs persetujuan admin vs access code → memengaruhi Fase 1.
3. **Mekanisme berbayar (Claim/Kontrak)**: entitlement manual (flag admin) vs **Stripe**/payment gateway → memengaruhi Fase 1b (bisa menambah sub-proyek billing).
4. **Unit langganan**: per-user vs per-perusahaan (banyak user dalam satu langganan) → memengaruhi skema data (`companies`/`subscriptions`).
5. **Python worker**: tetap container vs rewrite Workers → Fase 4.
6. **Provider model Mastra**: DeepSeek vs Workers AI vs Claude → Fase 3.
7. **Storage Mastra**: Supabase vs Turso vs D1 → Fase 3.
8. **Tier/region Supabase & akun Cloudflare**.
9. **Strategi**: konfirmasi strangler-fig (rekomendasi) vs big-bang.

---

## Verifikasi (per fase, ringkas)

- **Fase 0**: semua endpoint existing mengembalikan data sama terhadap Supabase; satu siklus
  `POST /api/v1/worker/ingest` sukses; briefing Mastra jalan.
- **Fase 1**: signup → login → halaman EWS muncul; akses tanpa login ditolak (401 dari Worker);
  baris `ews_subscriber` terkait dengan auth user.
- **Fase 2**: tiap endpoint yang dipindah paritas respons dengan versi Go sebelum Go dimatikan.
- **Fase 3**: executive briefing + copilot chat jalan dari Mastra Worker dengan model hosted.
- **Fase 4**: siklus ingest menghasilkan event baru di Supabase dari host baru.
- **Fase 5**: produksi jalan penuh di Cloudflare; tidak ada dependensi Docker/LLM lokal tersisa.

---

## Langkah berikutnya

1. Mulai **Fase 0** (atau Fase 1 jika ingin langsung pilot) lewat siklus brainstorm → spec → plan tersendiri.
