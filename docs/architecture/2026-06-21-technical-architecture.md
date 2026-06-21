# Reinsurance Risk Monitor — Technical Architecture Proposal

## 1. Architecture goals
- aman untuk data sensitif Tugure
- modular dan mudah diadopsi bertahap
- dapat berjalan lokal di Mac Mini untuk pengembangan
- siap dipisah menjadi service bila kebutuhan meningkat
- AI tetap bisa dipakai tanpa mengirim data sensitif ke cloud

## 2. Recommended stack
| Layer | Pilihan | Alasan |
|---|---|---|
| Frontend | React + TypeScript + Vite + Tailwind | cepat, ringan, cocok dashboard interaktif |
| Mapping | MapLibre GL + deck.gl | kuat untuk heatmap, layer, clustering |
| Core API | Go + Gin | performa baik, cocok service enterprise |
| Analytics/AI sidecar | FastAPI | fleksibel untuk scoring dan LLM orchestration |
| Database | PostgreSQL | relational kuat untuk domain reasuransi |
| Cache / queue ringan | Redis | caching, job coordination, transient state |
| Background jobs | worker Python / Go | ingestion, scoring, summarization |
| Auth | internal JWT + SSO-ready boundary | mudah bootstrap, bisa ditingkatkan |
| Observability | Grafana + Loki/Promtail + metrics | operasional dan audit |

## 3. Proposed logical architecture
### A. apps/web
Tanggung jawab:
- dashboard executive
- event map
- exposure analytics
- claims early warning board
- governance dashboard

### B. apps/api (Go)
Tanggung jawab:
- auth & RBAC
- API domain utama
- query read-model dashboard
- treaty / claim / exposure service boundary
- audit log write

### C. apps/worker (Python/FastAPI + jobs)
Tanggung jawab:
- konektor BMKG, USGS, GDACS, news feeds
- normalization pipeline
- risk scoring engine
- AI summarization / briefing
- alert generation

### D. database
Schema utama:
- master entities
- normalized event store
- exposure snapshots
- claims watch records
- alert history
- audit logs

## 4. Frontend proposal
### Main features
- multi-dashboard layout
- layer control & time filter
- drill-down region -> cedant -> treaty -> claim watch
- source citation drawer
- AI summary panel with references

### Suggested frontend structure
- `apps/web/src/pages/`
- `apps/web/src/features/events/`
- `apps/web/src/features/exposures/`
- `apps/web/src/features/claims/`
- `apps/web/src/features/briefing/`
- `apps/web/src/features/admin/`
- `apps/web/src/lib/api/`
- `apps/web/src/lib/map/`

## 5. Backend proposal
### Core domains
- identity & access
- event intelligence
- exposure management
- claims watch
- risk scoring
- briefing
- governance / audit

### API style
- REST untuk operasional utama
- optional SSE/WebSocket untuk live alerts
- OpenAPI sebagai kontrak awal

### Endpoint groups (draft)
- `/api/v1/auth/*`
- `/api/v1/events/*`
- `/api/v1/exposures/*`
- `/api/v1/claims-watch/*`
- `/api/v1/risk-scores/*`
- `/api/v1/briefings/*`
- `/api/v1/admin/*`
- `/api/v1/health/*`

## 6. Database proposal
### Core tables
- `users`
- `roles`
- `user_roles`
- `events`
- `event_sources`
- `event_impacts`
- `cedants`
- `brokers`
- `treaties`
- `exposure_snapshots`
- `exposure_items`
- `claim_cases`
- `claim_event_links`
- `risk_scores`
- `alerts`
- `briefings`
- `audit_logs`
- `connector_runs`

### Data design notes
- event dan source dipisah agar traceability kuat
- exposure snapshot immutable per batch/tanggal
- score disimpan bersama `score_version`
- alert tidak overwrite, append-only history

## 7. Integration proposal
### External
- BMKG
- USGS earthquake feed
- GDACS disaster feed
- curated news/RSS
- opsional market data feed

### Internal (tahap lanjut)
- BLIPS export/API read-only
- claims register read-only
- exposure bordereaux upload
- underwriting register

### Integration pattern
- connector -> raw landing -> normalizer -> canonical event -> scoring -> alert

## 8. AI proposal
### Use cases
- executive daily briefing
- event summary per region
- alert explanation
- probable impact narrative

### AI operating model
- **default:** local LLM (`localhost:8080`) untuk data sensitif
- cloud model hanya untuk data publik/non-rahasia bila diizinkan
- semua output AI wajib menyimpan citation/source ids

### Guardrails
- no direct claim PII to external LLM
- every summary shows source count and timestamps
- AI output marked as assistive, not final authority

## 9. Local deployment on Mac Mini
### Dev profile
- web: port 3001
- go api: port 8001
- python worker api: port 8002
- postgres: 5432
- redis: 6379
- local LLM: 8080

### Bring-up order
1. postgres + redis
2. api core
3. worker/connector service
4. web app
5. scheduler / cron jobs

### Tooling
- Docker Compose untuk postgres/redis/grafana
- host-native untuk Go/React/Python saat dev
- Tailscale untuk remote internal access terbatas

## 10. Security & compliance notes
- least privilege RBAC
- immutable audit log untuk insight penting
- masking field sensitif di UI dan log
- connector credentials di `.env.local`, bukan repo
- read-only integration dahulu untuk sistem internal
- AI summary bukan source of record

## 11. Recommended implementation sequencing
1. M0 shell apps + schema + health
2. M1 event ingestion eksternal
3. M2 event map + exposure overlay mock
4. M3 alert engine + claim watch board
5. M4 AI executive briefing
6. M5 internal integration & hardening

## 12. Recommendation
Untuk fase awal, **hindari microservices berlebihan**. Pakai pendekatan modular monorepo dengan 3 executable utama:
- web
- api
- worker

Ini cukup rapi untuk Tugure, mudah dideploy lokal, dan masih bisa dipecah nanti bila traffic/organisasi membutuhkannya.
