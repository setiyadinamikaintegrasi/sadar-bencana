# Historical Backfill Runner

Backfill runner membaca resource JSON/CSV resmi maksimum 50MB, memetakan field
melalui dataset manifest, dan menyimpan checkpoint offset per batch. URL wajib
HTTPS pada domain BNPB, BMKG, ESDM, atau USGS; redirect dimatikan.

Record identik idempotent. Record invalid atau administrative boundary yang
belum tersedia masuk `historical_backfill_rejections` tanpa menghentikan batch.

```http
POST /api/v1/worker/historical/backfill/{job_uuid}
```

Migration `031_historical_backfill_runner.sql` harus diterapkan terlebih dahulu.
