# Alert Confidence Policy

`alert-policy-v1` memisahkan severity dampak dari confidence informasi.
Severity `Critical` tidak menaikkan confidence secara otomatis.

Confidence class:

- `official_warning` — wording sumber wajib dipertahankan;
- `confirmed_event` — event terstruktur dari sumber tepercaya;
- `corroborated_signal` — minimal dua independence group;
- `unverified_signal` — belum cukup bukti independen.

Policy menyimpan class, verification status, lifecycle action, reasons, jumlah
sumber independen, dan versi policy pada setiap alert. Lifecycle action dapat
berupa create, escalate, deescalate, maintain, suppress, atau review. Sumber
stale non-official disuppress; warning resmi stale masuk review tanpa mengubah
wording sumber.

Manual override mensyaratkan confidence class, actor, dan reason secara
bersamaan. Migration menyediakan kolom audit dan tidak mengizinkan override
anonim:

```bash
psql "$DATABASE_URL" -f db/schema/024_alert_confidence_policy.sql
```
