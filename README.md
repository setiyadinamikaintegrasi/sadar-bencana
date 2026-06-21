# Reinsurance Risk Monitor

Greenfield starter untuk **dashboard intelligence risiko reasuransi** Tugure, terinspirasi dari konsep monitoring visual seperti WorldMonitor **tanpa** memakai kode AGPL-nya.

## Tujuan
Menyediakan platform internal untuk:
- memonitor event risiko yang berdampak ke portofolio reasuransi,
- menggabungkan data eksternal (BMKG, USGS, GDACS, berita) dan data internal (klaim, exposure, treaty),
- menghasilkan early warning, risk scoring, dan executive dashboard yang dapat diaudit.

## Prinsip desain
- **Greenfield, not fork** — tidak membawa codebase AGPL ke produk Tugure.
- **Enterprise-first** — RBAC, audit trail, explainability, source traceability.
- **Data-sensitive** — AI lokal untuk data sensitif, integrasi eksternal dipisah.
- **Modular** — ingestion, scoring, dashboard, dan assistant dipisah per layanan.

## Deliverables awal
- Blueprint produk: `docs/blueprint/2026-06-21-product-blueprint.md`
- Proposal arsitektur: `docs/architecture/2026-06-21-technical-architecture.md`
- Implementation plan MVP: `docs/superpowers/plans/2026-06-21-mvp-implementation-plan.md`
- ADR greenfield decision: `docs/adr/ADR-001-greenfield-not-fork-worldmonitor.md`

## Struktur awal
- `apps/web/` — calon frontend dashboard
- `apps/api/` — calon business API
- `apps/worker/` — ingestion, scoring, summarization worker
- `packages/domain/` — definisi domain, schema contract, kamus istilah
- `db/schema/` — skema data & migrasi awal
- `infra/local/` — catatan local deployment
- `scripts/` — utilitas bootstrap/verification

## Verifikasi starter
```bash
cd /Users/pandawa-project/projects/tugure/reinsurance-risk-monitor
bash scripts/verify-structure.sh
```

## Next build recommendation
Milestone berikutnya adalah **M0 Bootstrap Runnable**:
1. React + Vite dashboard shell
2. FastAPI API shell (`/health`, `/api/v1/meta`)
3. PostgreSQL local compose
4. contoh ingestion BMKG/GDACS
5. risk heatmap mock dengan dataset sintetis
