# BMKG CAP Nowcast Connector

Connector ini membaca daftar peringatan dini cuaca dan dokumen Common Alerting
Protocol (CAP) BMKG. Setiap perubahan disimpan sebagai revision immutable pada
`official_alerts`; payload mentah tetap untuk audit dan tidak dikirim ke browser.

## Prasyarat dan aktivasi

Terapkan migration secara berurutan, termasuk `019`, `021`, `025`, `030`,
`032`, `037`, dan `040`.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema/040_bmkg_warning_and_air_quality.sql
```

Pastikan URL indeks dan setiap redirect tetap memakai HTTPS pada `bmkg.go.id`
atau subdomain resminya. Konfirmasi ketentuan penggunaan dan kapasitas request
sebelum mengaktifkan `bmkg_cap` dari halaman **Sumber Resmi**. Fallback lama
`CONNECTOR_BMKG_CAP_ENABLED=true` hanya dipakai bila tabel pengaturan belum
tersedia.

> **Batas operasi saat ini:** `run_mode=dry_run` belum menjadi boundary
> non-persisting pada worker `bmkg_cap`. Probe Task 11 menunjukkan mode
> `dry_run` dan `active` sama-sama menulis source record dan official alert.
> Biarkan sumber `disabled` untuk uji non-persisting sampai worker diperbaiki;
> jangan mengandalkan dry-run CAP sebagai kontrol perubahan data.

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
