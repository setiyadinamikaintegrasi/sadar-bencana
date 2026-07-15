# Operasi BMKG Kualitas Udara

Integrasi `bmkg_air_quality` memisahkan peringatan resmi dari observasi PM2.5.
Migration `040_bmkg_warning_and_air_quality.sql` membuat penyimpanan observasi
dan gate sumber dengan nilai awal `enabled=false`, `run_mode=disabled`, serta
`default_api_url=NULL`.

## Gate dan prasyarat

Jangan aktifkan sumber sampai seluruh hal berikut dikonfirmasi:

- endpoint resmi machine-readable, bukan halaman HTML, memakai HTTPS pada
  `bmkg.go.id` atau subdomain resminya;
- format/schema, identitas record, timezone, interval publikasi, batas request,
  timeout, dan perilaku redirect terdokumentasi;
- izin pemanfaatan, atribusi, retensi, dan ketentuan penggunaan telah disetujui;
- migration sampai `040` terpasang, akun administrator tersedia, dan
  `OFFICIAL_SOURCE_SETTINGS_KEY` sama pada API dan worker bila token digunakan.

Belum ada endpoint kualitas udara yang disetujui atau dikonfigurasi secara
default pada repository ini. Jangan mengisi URL dari hasil inspeksi halaman,
endpoint internal yang tidak didokumentasikan, atau scraping HTML publik BMKG.

## Kontrak canonical

Satu payload machine-readable menghasilkan dua koleksi:

| Peringatan resmi | Observasi PM2.5 |
| --- | --- |
| `source_alert_id`, `message_type`, `status` | `station_id`, `station_name` |
| `sent_at`, `effective_at`, `expires_at` | `observed_at` |
| `category`, `area_name`, `area_geojson` | `pollutant`, `value`, `unit`, `category` |
| `latitude`, `longitude` | `latitude`, `longitude` |
| `headline`, `description`, `source_url` | `source_url` |

Kategori peringatan dipetakan menjadi `Tidak Sehat=Moderate`, `Sangat Tidak
Sehat=High`, dan `Berbahaya=Critical`. `source_url` wajib HTTPS BMKG. Record
tanpa identitas atau waktu yang valid ditolak; credential dan `raw_payload`
tidak pernah dikirim ke browser.

## Custom API sampai aktivasi

Tiga pemeriksaan berikut berbeda dan semuanya wajib selesai sebelum aktivasi:

1. **Preview** mengambil draft, memvalidasi, dan menampilkan mapping saja.
   Preview dibatasi 1 MiB dan tiga sample, meredaksi credential, serta tidak
   memperbarui connector health, `last_dry_run_*`, payload, source record,
   warning, atau observation. Audit `preview` bukan bukti aktivasi.
2. **API Dry-run** memvalidasi konfigurasi tersimpan yang saat itu masih current
   dan `run_mode=dry_run`. Keberhasilan mencatat audit serta
   `last_dry_run_valid=true` dan `last_dry_run_config_version=N`; langkah ini
   tidak menjalankan scheduled worker dan tidak memperbarui connector health.
3. **Worker shadow poll** adalah poll scheduler berikutnya saat
   `run_mode=dry_run`. Poll ini memperbarui connector health, tetapi wajib
   menghasilkan nol row domain baru pada `source_records`,
   `disaster_observability_events`, `official_alerts`,
   `air_quality_observations`, dan antrean delivery.

Urutan operasi:

1. Pilih **Custom API**, masukkan endpoint canonical yang telah disetujui,
   adapter version `v1`, field mapping, interval, dan token bila diperlukan.
2. Jalankan **Preview** dan perbaiki seluruh record invalid.
3. Simpan sebagai **Dry-run** dan catat `config_version=N`.
4. Jalankan endpoint **API Dry-run**. Pastikan hasil valid dan bukti dry-run
   menunjuk tepat ke N.
5. Tunggu scheduled worker shadow poll untuk konfigurasi N. Pastikan
   `last_polled_at`, `items_fetched`, dan `error_message` menunjukkan poll baru,
   lalu bandingkan count sebelum/sesudah dan pastikan seluruh row domain tetap
   nol perubahan.
6. Pastikan config masih N, baru jalankan **Activate**.

Jika config berubah selama validasi API, dry-run ditolak dengan
`stale_config_version` dan tidak mencatat bukti aktivasi. **Activate** menolak
bukti version lama dengan `successful_current_dry_run_required`. Perubahan URL,
mapping, adapter, token, atau interval membuat version baru dan mengharuskan
ketiga pemeriksaan diulang. Jangan mengaktifkan langsung melalui SQL atau
menambahkan default URL melalui migration lokal.

## Aturan delivery

Observasi `pm25`, termasuk kategori `Tidak Sehat`, tetap hanya kondisi terukur
di `air_quality_observations` dan tidak pernah memicu EWS. Hanya warning yang
benar-benar diterbitkan BMKG masuk `official_alerts`; warning tersebut baru
diantrikan bila geometri watch zone, `peril_type=air_quality`, severity,
`alert_types`, kanal, dan revision cocok. Update, cancel, dan expiry mengikuti
penerima revision sebelumnya.

## Health check

- Periksa **Source Health** atau `GET /api/v1/health/connectors` dan cari
  `bmkg_air_quality`; threshold stale awal adalah 7200 detik.
- Periksa `last_polled_at`, `items_fetched`, `error_message`, dan status
  `ok/stale/error` setelah worker shadow poll dan poll active. Preview dan API
  Dry-run tidak mengubah health.
- Bandingkan `GET /api/v1/official-alerts?source=bmkg_air_quality` dengan
  `GET /api/v1/air-quality/observations?source=bmkg&latest=true&limit=50`.
- Pastikan dashboard menampilkan atribusi `BMKG (Badan Meteorologi,
  Klimatologi, dan Geofisika)` dan menandai data lebih tua dari dua interval
  sebagai **Data terlambat**.

## Rollback

1. Untuk containment, ubah sumber ke `disabled` dan pastikan poll/delivery baru
   berhenti.
2. Dari history, pilih version terakhir yang diketahui aman dan jalankan
   rollback dengan alasan wajib. Rollback membuat config version baru,
   memulihkan nilai konfigurasi dan token terenkripsi, serta menghapus seluruh
   bukti dry-run sebelumnya. Target yang dahulu active/dry-run dipulihkan sebagai
   `enabled=true, run_mode=dry_run`; target yang coherent disabled tetap
   `enabled=false, run_mode=disabled`. Rollback tidak pernah langsung active.
3. Untuk hasil `dry_run`, ulangi Preview -> API Dry-run current version ->
   worker shadow poll sehat -> konfirmasi nol persistence, baru Activate.
   Aktivasi sebelum API Dry-run baru harus ditolak.
4. Verifikasi health, config/history version baru, audit rollback/dry-run/
   activate, jumlah warning/observation, serta tidak ada delivery observasi
   PM2.5. Jangan menghapus observation atau revision lama; data tersebut
   diperlukan untuk audit.

Gunakan atribusi `BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)` dan
tautan ketentuan `https://www.bmkg.go.id/ketentuan-penggunaan`. Operasi ini tidak
menggantikan informasi dan arahan resmi BMKG.
