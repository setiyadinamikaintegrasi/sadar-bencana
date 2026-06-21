# Reinsurance Risk Monitor — Product Blueprint

## 1. Product vision
Platform internal Tugure untuk mengubah data risiko eksternal dan internal menjadi **situational awareness** yang relevan untuk underwriting, claims, actuarial, investment, dan manajemen.

## 2. Problem statement
Saat ini sinyal risiko tersebar di banyak sumber: event bencana, berita, data exposure, register klaim, dan laporan operasional. Akibatnya:
- early warning lambat,
- akumulasi risiko sulit divisualkan,
- triase klaim besar cenderung manual,
- executive insight belum real-time.

## 3. Target users & user roles
| Role | Tujuan utama | Akses utama |
|---|---|---|
| Executive / Direksi | melihat ringkasan risk posture | dashboard agregat, watchlist, briefing |
| Underwriting | monitor akumulasi exposure & treaty impact | exposure map, cedant risk score, peril watch |
| Claims | early warning dan triase klaim | claim alert board, event-to-claim correlation |
| Actuarial / Pricing | analisis trend dan severity | event timeline, portfolio analytics |
| Investment / Finance | pantau dampak makro & market ke aset | market watch, macro indicators |
| Risk Management / Compliance | kontrol governance & audit | audit trail, source traceability, policy alerts |
| IT Admin | kelola user, integrasi, job | admin, connector status, health monitor |

## 4. Core product modules
### A. Risk Event Monitor
- peta event bencana dan disruption
- layer gempa, banjir, cuaca ekstrem, kebakaran, geopolitik, pelabuhan/bandara
- severity scoring per event

### B. Exposure Intelligence
- overlay exposure per wilayah
- akumulasi per line of business, treaty, cedant, broker
- top concentration analysis

### C. Claims Early Warning
- deteksi event yang berpotensi memicu klaim
- watchlist klaim besar
- triase berdasarkan probable impacted treaties

### D. Executive Briefing
- daily/weekly AI summary
- top 10 risk movers
- recommended follow-up actions

### E. Portfolio & Treaty Analytics
- loss trend
- reserve movement
- treaty utilization
- renewal hotspot

### F. Source & Governance Console
- daftar data source
- freshness / latency / failed connectors
- audit source per insight

## 5. Main entities
| Entity | Deskripsi |
|---|---|
| Event | kejadian eksternal: gempa, banjir, market shock, outage |
| EventSource | asal data event |
| ExposureSnapshot | snapshot exposure per area/cedant/treaty |
| Cedant | perusahaan cedant |
| Broker | broker terkait |
| Treaty | kontrak treaty / facultative grouping |
| ClaimCase | klaim aktual / potensial |
| RiskScore | skor hasil engine penilaian |
| Alert | alert yang dikirim sistem |
| User | pengguna sistem |
| Role | role/RBAC |
| Briefing | hasil ringkasan AI |
| AuditLog | jejak tindakan dan source usage |

## 6. Key dashboards
### Dashboard 1 — Executive Overview
- total active alerts
- top exposed regions
- top loss-driving events
- cedant watchlist
- daily executive summary

### Dashboard 2 — Catastrophe & Event Map
- peta layer event
- filter waktu: 1h / 6h / 24h / 7d / 30d
- filter peril, region, severity

### Dashboard 3 — Exposure Accumulation
- heatmap exposure
- top accumulation by province/country
- treaty and line-of-business drilldown

### Dashboard 4 — Claims Early Warning
- probable claim triggers
- event-to-claim correlation
- aging watchlist
- status triase

### Dashboard 5 — Portfolio Risk Analytics
- trend severity
- reserve movement
- utilization dan renewal flags

### Dashboard 6 — Source Health & Governance
- connector health
- freshness SLA
- auditability and explainability panel

## 7. MVP scope
### In scope
- event ingestion: BMKG, USGS, GDACS, curated news feeds
- synthetic/internal mock exposure dataset
- executive overview
- event map
- exposure accumulation dashboard
- claims early warning mock workflow
- local AI summarization untuk briefing
- RBAC dasar: admin, executive, underwriting, claims

### Out of scope (MVP)
- integrasi langsung ke BLIPS production
- auto-booking claim reserve
- OCR dokumen klaim
- full mobile app
- complex actuarial models

## 8. MVP roadmap
| Phase | Fokus | Output |
|---|---|---|
| M0 | Bootstrap | repo, shell app, schema, health endpoints |
| M1 | External event intelligence | ingestion BMKG/USGS/GDACS + event map |
| M2 | Exposure intelligence | mock exposure overlay + risk scoring |
| M3 | Claims early warning | event correlation + alert board |
| M4 | Executive AI briefing | local LLM summary + source citations |
| M5 | Hardening | RBAC, audit log, connector health, UAT |

## 9. Success metrics
- alert freshness < 15 menit untuk external feeds utama
- executive daily briefing terbit otomatis setiap pagi
- top exposure region bisa diakses < 3 klik
- setiap insight punya source traceability
- false-positive alert rate dipantau sejak M2

## 10. Product principle
- explainable by default
- source-linked, not black-box
- sensitive data stays local
- dashboard first, action second
