# Exposure-aware Risk Scoring v2

`risk-v2` menghasilkan score 0–100 yang dapat direproduksi dari lima komponen:
hazard intensity (55%), exposure (20%), vulnerability (15%), evidence
confidence (5%), dan freshness (5%).

Hazard dinormalisasi per peril. Gempa menggunakan magnitude, depth, serta
opsional MMI/PGA; flood dan volcano memakai skala upstream 0–4; wildfire
memakai skala 0–10. Karena setiap komponen dinormalisasi ke 0–1, score dapat
ditampilkan pada skala yang sama, tetapi detail peril dan komponennya tetap
wajib ditampilkan ketika membandingkan event.

Jika exposure atau vulnerability tidak tersedia, nilainya nol dan flag
`*_unavailable` disimpan. Sistem tidak mengarang population exposure.
Confidence dan freshness default ke 0,5 serta ditandai sebagai default.

Setiap row menyimpan `formula_version`. Faktor JSON menyimpan weights,
components, input snapshot, fallback flags, peril, severity, dan data vintage.
Worker memuat context yang tertaut langsung ke event atau polygon context yang
mencakup koordinat event. Evidence confidence yang masih fresh ikut digunakan.
Migration:

```bash
psql "$DATABASE_URL" -f db/schema/023_exposure_aware_risk_scoring.sql
```
