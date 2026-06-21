# ADR-001 — Greenfield, Not Forking WorldMonitor

## Status
Accepted

## Context
Pak Joko tertarik pada konsep visual dan interaction pattern dari WorldMonitor, tetapi repo sumber berlisensi **AGPL-3.0-only**. Untuk konteks Tugure sebagai perusahaan reasuransi dengan kebutuhan proprietary logic, data sensitif, dan compliance, penggunaan fork langsung berisiko menimbulkan kewajiban lisensi yang tidak diinginkan.

## Decision
Project `reinsurance-risk-monitor` dibangun sebagai **greenfield implementation**. Referensi yang boleh diambil:
- ide dashboard
- pola interaksi layer/time-range/filter
- gagasan executive briefing dan event intelligence

Yang **tidak** diambil:
- source code
- asset code turunan
- struktur codebase yang menyalin langsung file atau modul AGPL

## Consequences
### Positive
- aman secara lisensi
- arsitektur dapat disesuaikan penuh ke domain reasuransi
- lebih mudah diintegrasikan ke data internal Tugure
- lebih aman untuk data dan audit

### Negative
- waktu bangun awal lebih lama dibanding fork
- beberapa UX pattern harus dibuat ulang

## Follow-up
- buat blueprint produk sendiri
- buat arsitektur teknis enterprise-friendly
- bangun starter repo baru sebagai baseline implementasi
