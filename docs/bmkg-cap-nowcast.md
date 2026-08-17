# BMKG CAP Nowcast Connector

Connector ini membaca daftar peringatan dini cuaca dan dokumen Common Alerting
Protocol (CAP) BMKG. Setiap perubahan disimpan sebagai revision immutable pada
`official_alerts`; payload mentah tetap untuk audit dan tidak dikirim ke browser.

## Prasyarat

Terapkan migration secara berurutan, termasuk `019`, `021`, `025`, `030`,
`032`, `037`, dan `040`.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema/040_bmkg_warning_and_air_quality.sql
```

Pastikan URL indeks dan setiap redirect tetap memakai HTTPS pada `bmkg.go.id`
atau subdomain resminya. Konfirmasi ketentuan penggunaan dan kapasitas request
sebelum mengaktifkan `bmkg_cap` dari halaman **Sumber Resmi**.

`run_mode=dry_run` mengambil dan memvalidasi CAP lalu memperbarui Source Health
dengan jumlah alert dan detail error. Mode ini tidak menulis source record,
evidence observation, official alert, atau antrean delivery. `run_mode=active`
tetap menjalankan persistence dan delivery normal.

Fallback environment `CONNECTOR_BMKG_CAP_ENABLED=true` hanya dipakai untuk
deployment legacy yang belum memiliki tabel control-plane
`official_source_settings`. Setelah tabel tersebut tersedia, row `bmkg_cap`
yang hilang, kegagalan query, atau kegagalan dekripsi credential selalu gagal
tertutup: worker tidak melakukan request maupun persistence. Row disabled juga
tidak pernah memakai fallback. Perbaiki control-plane dan audit konfigurasi
sebelum polling diaktifkan kembali; jangan mengandalkan flag environment untuk
melewati kegagalan settings.

## Urutan aktivasi terkontrol

Preview, API Dry-run, dan worker shadow poll adalah tiga pemeriksaan terpisah;
semuanya wajib berhasil dan diamati sebelum **Activate**:

1. Jalankan **Preview** pada draft endpoint/mapping. Preview hanya mengambil,
   memvalidasi, dan memetakan sample. Preview tidak memperbarui connector
   health atau `last_dry_run_*`, dan tidak menulis row domain. Audit `preview`
   bukan bukti aktivasi.
2. Simpan konfigurasi dengan `run_mode=dry_run` sebagai version **N**. Simpan
   nomor N dan snapshot count `source_records`,
   `disaster_observability_events`, `official_alerts`, dan
   `ews_notification_log` untuk `bmkg_cap`.
3. Jalankan **API Dry-run** dan pastikan validasi sukses tepat untuk N. API ini
   mencatat audit serta `last_dry_run_valid=true` dengan
   `last_dry_run_config_version=N`, tetapi tidak memperbarui worker connector
   health dan tidak menulis row domain.
4. Tunggu scheduled worker shadow poll saat config masih N dan
   `run_mode=dry_run`. Pastikan Source Health menunjukkan `last_polled_at` baru,
   jumlah item/error yang benar, dan tidak ada perubahan pada seluruh snapshot
   count. Hanya poll worker ini yang membuktikan jalur scheduler/connector untuk
   config N tanpa persistence.
5. Konfirmasi config masih version N dan seluruh count tetap nol perubahan,
   lalu jalankan **Activate**. Aktivasi membuat version N+1 dengan
   `run_mode=active`.

Jika config berubah saat API Dry-run berjalan, hasil ditolak dengan
`stale_config_version` dan tidak boleh menjadi bukti aktivasi. Bukti sukses dari
version lama juga ditolak oleh Activate dengan
`successful_current_dry_run_required`. Kembali ke Preview dan ulangi seluruh
urutan untuk version current; jangan melewati gate melalui SQL.

## Sumber dan atribusi

- Indeks: `https://www.bmkg.go.id/alerts/nowcast/id`
- Detail: URL CAP HTTPS BMKG yang tercantum pada indeks
- Atribusi: `BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)`
- Ketentuan: `https://www.bmkg.go.id/ketentuan-penggunaan`

Maksimal 50 dokumen CAP diproses per siklus. Redirect divalidasi kembali dan
kegagalan satu detail tidak membatalkan detail lain.

## Metadata terstruktur

Normalizer memilih blok `info` bahasa Indonesia dan mengisi field berikut agar
API dan UI tidak perlu membaca `raw_payload`:

| Field | Isi |
| --- | --- |
| `peril_type` | Selalu `weather` |
| `severity` | `Minor/Moderate` menjadi `Moderate`, `Severe` menjadi `High`, `Extreme` menjadi `Critical` |
| `area_name` | Nama wilayah CAP, dideduplikasi dalam urutan sumber |
| `area_geojson` | Polygon CAP dalam urutan GeoJSON `longitude,latitude` |
| `source_url` | URL detail CAP HTTPS BMKG setelah redirect |
| `message_type`, `status`, `revision`, `is_current` | Lifecycle alert, update, cancel, dan revision aktif |

`effective` dan `expires` disimpan tanpa inferensi. `Update` dan `Cancel`
memakai identifier alert awal dari `references`. Severity atau geometri yang
tidak tersedia tidak boleh menghasilkan delivery otomatis.

## Delivery watch zone

Delivery awal hanya dibuat ketika seluruh syarat berikut cocok:

- polygon atau titik peringatan beririsan/berjarak dalam radius watch zone;
- `peril_type=weather` diizinkan oleh watch zone dan `alert_types` subscriber;
- severity memenuhi `min_severity`;
- kanal email atau Telegram aktif; dan
- revision tersebut belum pernah diantrikan untuk subscriber dan kanal yang sama.

Watch zone di luar geometri tidak menghasilkan delivery pending. Bila beberapa
zone cocok, delivery menyimpan `matched_watch_zone_id` yang dipilih secara
deterministik. Update, cancel, dan expiry diteruskan kepada penerima revision
sebelumnya dengan watch zone yang sama, walaupun preferensi atau geometri zone
kemudian berubah. Deduplication tetap berlaku per subscriber, kanal, source,
identifier, revision, dan lifecycle action.

## Pemeriksaan operasi

Pantau **Source Health** atau `GET /api/v1/health/connectors`; `bmkg_cap` menjadi
`stale` setelah 600 detik tanpa poll berhasil. Periksa peringatan terstruktur
dengan:

```http
GET /api/v1/official-alerts?source=bmkg_cap&status=active&limit=20
```

Untuk menghentikan ingest, set sumber ke `disabled`. Catat alasan perubahan,
pastikan tidak ada delivery baru, dan pertahankan revision lama untuk audit.

Rollback ke version historical selalu membuat config version baru dan
menghapus bukti dry-run lama. Target yang dahulu active/dry-run dipulihkan
sebagai `enabled=true, run_mode=dry_run`; target coherent disabled tetap
disabled. Rollback tidak pernah mengaktifkan ingest langsung. Untuk hasil
dry-run, wajib ulangi Preview -> API Dry-run current version -> worker shadow
poll sehat -> nol persistence -> Activate.
