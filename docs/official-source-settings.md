# Official Source Settings

Page **Sumber Resmi** hanya dapat dibuka oleh pengguna terautentikasi yang
terdaftar sebagai `ews_subscribers.role=admin`.

Mode runtime:

1. `Auto`: Custom API → environment variable → endpoint publik bawaan.
2. `Default Public`: hanya endpoint bawaan yang telah direview.
3. `Custom API`: endpoint resmi yang dimasukkan administrator.

Custom URL wajib HTTPS dan hostname dibatasi ke domain lembaga terkait. Token
disimpan dengan `pgcrypto`, tidak pernah dikirim kembali ke browser, dan
memerlukan `OFFICIAL_SOURCE_SETTINGS_KEY` yang sama pada API serta worker.

Migration:

```bash
psql "$DATABASE_URL" -f db/schema/030_official_source_settings.sql
```

BMKG Open Data gempa aktif secara default. BMKG CAP, InaTEWS, PVMBG, BNPB, dan
InaRISK tetap nonaktif sampai feed machine-readable dan ketentuan integrasinya
dikonfirmasi. UI web publik tidak pernah di-scrape.
