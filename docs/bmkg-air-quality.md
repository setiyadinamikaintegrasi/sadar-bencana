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
| `category`, `area_name`, `area_geojson` | `latitude`, `longitude` |
| `headline`, `description`, `source_url` | `pollutant`, `value`, `unit`, `category`, `source_url` |

Kategori peringatan dipetakan menjadi `Tidak Sehat=Moderate`, `Sangat Tidak
Sehat=High`, dan `Berbahaya=Critical`. `source_url` wajib HTTPS BMKG. Record
tanpa identitas atau waktu yang valid ditolak; credential dan `raw_payload`
tidak pernah dikirim ke browser.

## Custom API sampai aktivasi

1. Pilih **Custom API**, masukkan endpoint canonical yang telah disetujui,
   adapter version `v1`, field mapping, interval, dan token bila diperlukan.
2. Jalankan **Preview**. Preview dibatasi 1 MiB dan tiga sample, meredaksi
   credential, serta tidak menyimpan payload, source record, warning, atau
   observation.
3. Simpan konfigurasi sebagai **Dry-run**, lalu jalankan dry-run. Hasil harus
   melaporkan jumlah warning/observation valid dan memperbarui health saja;
   jumlah `official_alerts` dan `air_quality_observations` tidak boleh berubah.
4. Jalankan **Activate** hanya jika dry-run terakhir valid untuk
   `config_version` yang sedang aktif. Perubahan URL, mapping, adapter, token,
   atau interval membuat bukti dry-run lama tidak berlaku dan harus kembali ke
   langkah 2.

Aktivasi yang memakai dry-run version lama ditolak dengan
`successful_current_dry_run_required`. Jangan mengaktifkan langsung melalui SQL
atau menambahkan default URL melalui migration lokal.

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
  `ok/stale/error` setelah preview, dry-run, dan aktivasi.
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
   memulihkan token terenkripsi, dan menghapus bukti dry-run sebelumnya.
3. Bila hasil rollback bukan `disabled`, simpan sebagai dry-run dan ulangi
   Preview -> Dry-run sebelum aktivasi kembali.
4. Verifikasi health, jumlah warning/observation, audit action, serta tidak ada
   delivery observasi PM2.5. Jangan menghapus observation atau revision lama;
   data tersebut diperlukan untuk audit.

Gunakan atribusi `BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)` dan
tautan ketentuan `https://www.bmkg.go.id/ketentuan-penggunaan`. Operasi ini tidak
menggantikan informasi dan arahan resmi BMKG.
