# Desain Peringatan BMKG pada Dashboard dan Early Warning

Tanggal: 15 Juli 2026

Status: Disetujui secara konseptual, menunggu tinjauan spesifikasi

Pemilik fitur: SadarBencana

## Ringkasan

SadarBencana akan menampilkan peringatan dini cuaca BMKG dan informasi kualitas
udara BMKG pada dashboard utama. Peringatan resmi yang relevan dengan watch zone
pengguna juga akan muncul di halaman Early Warning System (EWS) dan dapat dikirim
melalui kanal notifikasi yang telah diaktifkan pengguna.

Implementasi membedakan dengan tegas:

1. **Peringatan resmi** yang diterbitkan BMKG, memiliki periode berlaku, wilayah,
   lifecycle pembaruan/pembatalan, dan dapat memicu EWS.
2. **Observasi kualitas udara** berupa pengukuran PM2.5 terkini, yang ditampilkan
   sebagai kondisi terukur tetapi tidak dipromosikan menjadi peringatan resmi.

Peringatan cuaca memakai jalur BMKG CAP yang sudah tersedia di repository.
Peringatan kualitas udara memakai sumber resmi machine-readable yang didaftarkan
melalui pengaturan sumber resmi. SadarBencana tidak mengambil data dengan
scraping halaman publik BMKG.

## Tujuan

- Menampilkan peringatan dini cuaca BMKG yang aktif pada dashboard utama.
- Menampilkan peringatan dini kualitas udara ekstrem BMKG yang aktif pada
  dashboard utama.
- Menampilkan pengukuran PM2.5 terkini beserta kategori, lokasi, dan waktu
  observasi ketika feed resmi machine-readable tersedia.
- Menampilkan peringatan BMKG yang relevan dengan watch zone pada EWS.
- Mengirim notifikasi hanya kepada pengguna yang watch zone dan preferensinya
  cocok dengan peringatan.
- Mempertahankan atribusi, tautan sumber, waktu berlaku, revision history, dan
  status kesehatan konektor.

## Bukan Tujuan

- Menggantikan aplikasi, situs, atau arahan resmi BMKG.
- Membuat prediksi kualitas udara sendiri.
- Menyebut pengukuran PM2.5 sebagai peringatan resmi bila BMKG tidak
  menerbitkan peringatannya.
- Scraping HTML halaman publik BMKG atau memakai endpoint internal yang tidak
  didokumentasikan tanpa persetujuan integrasi.
- Menambah kanal notifikasi baru di luar email dan Telegram pada tahap ini.

## Fakta dan Batasan Sumber

- Repository sudah memiliki konektor `bmkg_cap`, penyimpanan lifecycle pada
  `official_alerts`, endpoint `/api/v1/official-alerts`, dan polygon peringatan
  resmi pada peta.
- Pengaturan sumber `bmkg_cap` saat ini nonaktif secara default sampai ketentuan
  integrasi dikonfirmasi administrator.
- BMKG menerbitkan kategori PM2.5: Baik, Sedang, Tidak Sehat, Sangat Tidak
  Sehat, dan Berbahaya.
- Peraturan BMKG Nomor 6 Tahun 2023 menyatakan peringatan dini kualitas udara
  ekstrem mencakup kategori Tidak Sehat, Sangat Tidak Sehat, dan Berbahaya,
  berdasarkan prediksi rata-rata PM2.5 24 jam sampai tiga hari ke depan.
- Saat spesifikasi ini ditulis, portal data terbuka BMKG belum
  mendokumentasikan API publik kualitas udara yang setara dengan API prakiraan
  cuaca. Karena itu, sumber `bmkg_air_quality` dibuat nonaktif secara default dan
  baru dapat diaktifkan setelah URL resmi machine-readable, format, batas akses,
  dan izin pemanfaatannya dikonfirmasi.

## Keputusan Arsitektur

### 1. Peringatan resmi memakai satu lifecycle

Peringatan cuaca dan kualitas udara disimpan di `official_alerts`. Model ini
tetap menjadi sumber kebenaran untuk alert, update, cancel, expiry, revision,
deduplikasi, dan delivery EWS.

Kolom berikut ditambahkan agar konsumen tidak perlu menafsirkan `raw_payload`:

| Kolom | Isi |
| --- | --- |
| `peril_type` | `weather` atau `air_quality` |
| `severity` | `Moderate`, `High`, atau `Critical` |
| `category` | Kategori asli sumber, misalnya `Tidak Sehat` |
| `area_name` | Nama wilayah yang diterbitkan sumber |
| `latitude`, `longitude` | Titik representatif bila sumber tidak memberi polygon |
| `source_url` | Tautan langsung ke informasi BMKG |

Semua kolom baru nullable agar revision lama tetap valid. Record baru dari
`bmkg_cap` dan `bmkg_air_quality` wajib mengisinya sejauh tersedia pada sumber.

### 2. Pengukuran PM2.5 memakai model observasi terpisah

Tabel `air_quality_observations` menyimpan pengukuran, bukan alert:

| Kolom | Isi |
| --- | --- |
| `source` | `bmkg` |
| `station_id` | Identitas stabil stasiun dari sumber |
| `station_name` | Nama stasiun/lokasi |
| `latitude`, `longitude` | Koordinat stasiun bila tersedia |
| `pollutant` | `pm25` pada tahap pertama |
| `value` | Konsentrasi dalam mikrogram per meter kubik |
| `unit` | `ug/m3`, dinormalisasi dari satuan sumber |
| `category` | Kategori resmi BMKG |
| `observed_at` | Waktu observasi dengan timezone |
| `source_url` | Tautan informasi BMKG |
| `raw_payload` | Payload asli untuk audit |
| `ingested_at` | Waktu data diterima SadarBencana |

Kunci unik `source + station_id + pollutant + observed_at` mencegah duplikasi.
Data dashboard memakai observasi terbaru per stasiun. Retensi awal adalah 30
hari; penghapusan data lama dilakukan oleh job terjadwal.

### 3. Adapter sumber terisolasi

- `bmkg_cap` tetap menangani RSS dan dokumen CAP cuaca.
- `bmkg_air_quality` menangani dua koleksi dari satu integrasi resmi:
  `warnings` untuk peringatan prediksi dan `observations` untuk PM2.5 terukur.
- Adapter hanya menerima HTTPS pada host `bmkg.go.id` atau subdomain resminya.
- Sumber dikonfigurasi melalui `official_source_settings`, mendukung preview,
  dry-run, aktivasi, rollback, audit, batas request, dan timeout.
- Pengaturan sumber menyimpan `expected_interval_seconds`; nilai awal PM2.5
  adalah 3600 detik dan harus disesuaikan bila kontrak resmi menetapkan interval
  lain.
- Parser menolak payload yang tidak memiliki identitas, waktu produksi, periode
  berlaku/observasi, atau wilayah/stasiun yang dapat dikenali.

Kontrak normalisasi adapter kualitas udara:

```text
AirQualityWarningInput
  source_alert_id, revision, message_type, status
  sent_at, effective_at, expires_at
  severity, category, area_name, area_geojson
  headline, description, source_url, raw_payload

AirQualityObservationInput
  station_id, station_name, latitude, longitude
  pollutant, value, unit, category, observed_at
  source_url, raw_payload
```

Format payload eksternal boleh berubah tanpa mengubah API web selama adapter
tetap menghasilkan kedua kontrak internal tersebut.

Jika sumber tidak memberi nomor revision, adapter membuat revision berikutnya
ketika checksum payload untuk `source_alert_id` berubah. Payload identik tidak
membuat revision atau delivery baru.

## Pemetaan Severity

Pemetaan kualitas udara mengikuti kategori resmi BMKG:

| Kategori BMKG | Status dashboard | Severity EWS |
| --- | --- | --- |
| Baik | Kondisi terukur | Bukan alert |
| Sedang | Kondisi terukur | Bukan alert |
| Tidak Sehat | Peringatan aktif jika diterbitkan BMKG | Moderate |
| Sangat Tidak Sehat | Peringatan aktif jika diterbitkan BMKG | High |
| Berbahaya | Peringatan aktif jika diterbitkan BMKG | Critical |

Untuk CAP cuaca, `severity` dari dokumen sumber dinormalisasi ke skala EWS:
`Minor` menjadi `Moderate`, `Moderate` menjadi `Moderate`, `Severe` menjadi
`High`, dan `Extreme` menjadi `Critical`. Nilai yang hilang tidak boleh memicu
notifikasi sampai ditinjau; alert tetap dapat tampil dengan label
"Severity belum tersedia".

## API

### Peringatan resmi

Endpoint `GET /api/v1/official-alerts` diperluas dengan filter opsional
`peril_type` dan field baru `peril_type`, `severity`, `area_name`, serta
`category`, `latitude`, `longitude`, dan `source_url`. Filter lama tetap
kompatibel.

Dashboard mengambil dua sumber secara paralel:

```http
GET /api/v1/official-alerts?source=bmkg_cap&status=active&limit=20
GET /api/v1/official-alerts?source=bmkg_air_quality&status=active&limit=20
```

### Observasi kualitas udara

Endpoint publik baru:

```http
GET /api/v1/air-quality/observations?source=bmkg&latest=true&limit=50
```

Respons hanya berisi field yang sudah dinormalisasi; `raw_payload` tidak pernah
dikirim ke browser.

### Peringatan personal EWS

Endpoint terautentikasi baru:

```http
GET /api/v1/ews/me/active-warnings?limit=50
```

Endpoint mengembalikan peringatan aktif yang beririsan dengan minimal satu
watch zone milik pengguna. Setiap item memuat `matched_watch_zone_ids` dan
`matched_watch_zone_labels` agar alasan relevansinya terlihat di UI.

## Pencocokan Watch Zone

- Migrasi mengaktifkan ekstensi PostGIS dan membangun ekspresi geografi dari
  `area_geojson`. Polygon peringatan cocok bila `ST_Intersects` bernilai benar
  terhadap buffer lingkaran watch zone dalam meter.
- Peringatan berbasis titik cocok bila jarak titik sumber ke pusat watch zone
  yang dihitung dengan `ST_DWithin` tidak melebihi `radius_km`.
- Peringatan tanpa polygon maupun titik tidak dikirim otomatis. Alert tersebut
  hanya tampil pada dashboard nasional dengan label "Wilayah belum terpetakan".
- Watch zone dengan `peril_types` kosong menerima semua jenis peringatan.
- Watch zone yang diisi eksplisit harus memuat `weather` atau `air_quality` agar
  jenis tersebut cocok.
- Preferensi `alert_types` juga mendukung `weather` dan `air_quality`.
- Delivery hanya dibuat bila severity memenuhi `min_severity`, geometri cocok,
  jenis alert diizinkan, kanal aktif, dan revision belum pernah dikirim.
- Update, cancel, dan expiry dikirim kepada penerima revision sebelumnya agar
  lifecycle tidak terputus.

## Dashboard Utama

Dashboard mendapat panel unframed **Peringatan Resmi BMKG** di dekat peta dan
daftar kejadian terbaru. Panel memiliki segmented tabs:

### Tab Cuaca Ekstrem

- Menampilkan jumlah peringatan aktif.
- Mengurutkan severity tertinggi, lalu `effective_at` terbaru.
- Setiap baris memuat headline, wilayah, severity, waktu berlaku, status, dan
  atribusi BMKG.
- Klik baris memfokuskan polygon terkait pada peta dan membuka detail.
- Peringatan yang segera kedaluwarsa tetap tampil dengan waktu tersisa.

### Tab Kualitas Udara

- Bagian atas menampilkan peringatan kualitas udara ekstrem aktif dari BMKG.
- Bagian bawah menampilkan observasi PM2.5 terbaru, diurutkan kategori terburuk
  lalu waktu terbaru.
- Setiap observasi memuat nama stasiun, nilai PM2.5, satuan, kategori, dan waktu
  pembaruan.
- Observasi dianggap terlambat bila umurnya melebihi dua kali
  `expected_interval_seconds` sumber. Data tersebut diberi label
  "Data terlambat" dan tidak dipakai untuk membuat alert.
- Tautan "Sumber BMKG" membuka URL resmi pada tab baru dengan `noopener` dan
  `noreferrer`.

Warna mengikuti kategori BMKG tetapi selalu disertai teks, sehingga makna tidak
bergantung pada warna. Panel memiliki loading skeleton, empty state, stale
state, dan partial-error state per tab. Kegagalan salah satu sumber tidak
memblokir peta atau data dashboard lain.

## Halaman Early Warning System

Tab baru **Peringatan Aktif** menjadi tab pertama setelah pengguna masuk. Tab
ini menampilkan peringatan personal dari `/ews/me/active-warnings`.

Setiap item memuat:

- label "Resmi BMKG";
- jenis `Cuaca` atau `Kualitas Udara`;
- severity dan status lifecycle;
- headline dan ringkasan sumber tanpa parafrasa otomatis;
- wilayah serta watch zone yang cocok;
- waktu diterbitkan, mulai berlaku, dan berakhir;
- tautan ke sumber resmi;
- tindakan untuk melihat wilayah pada peta bila geometri tersedia.

Tab **Watch Zones** menambahkan `weather` dan `air_quality` pada pilihan jenis
bahaya. Tab **Preferences** menambahkan keduanya pada filter jenis alert.
Tab **Notifikasi Saya** menampilkan headline, jenis, lifecycle action, dan
watch zone pemicu agar riwayat dapat diaudit pengguna.

Konten panduan keselamatan memakai action card lokal yang telah dikurasi.
Panduan tidak boleh mengubah atau memperluas instruksi BMKG dan selalu
mengarahkan pengguna untuk mengikuti otoritas setempat.

## Alur Data

```text
BMKG CAP RSS/detail ----> bmkg_cap adapter -----------+
                                                      |
BMKG air quality API --> bmkg_air_quality adapter ----+--> normalize
                                                            |
                         +----------------------------------+
                         |
                         +--> official_alerts --> public dashboard/map
                         |                     --> watch-zone matcher
                         |                     --> EWS delivery
                         |
                         +--> air_quality_observations --> dashboard PM2.5
```

Setiap siklus ingest mencatat source record dan observability event. Checksum
payload mencegah revision palsu. Expiry scheduler menutup warning yang melewati
`expires_at`; adapter memproses update dan cancel dari sumber sebagai revision
baru.

## Penanganan Kegagalan

- Timeout, status non-2xx, payload invalid, atau schema drift dicatat pada
  connector health tanpa menghapus data valid terakhir.
- Halaman kesehatan sumber mencantumkan `bmkg_cap` dan `bmkg_air_quality`
  beserta waktu sukses terakhir, freshness, dan error terakhir.
- Data lama tetap dapat tampil dengan label stale, tetapi tidak memicu delivery
  baru setelah `expires_at` atau batas kesegaran terlewati.
- Satu record rusak tidak menggagalkan seluruh batch; record ditolak dan
  alasannya dicatat tanpa menyimpan data mentah yang mengandung secret.
- Jika feed kualitas udara belum dikonfigurasi, UI menampilkan
  "Integrasi kualitas udara BMKG belum aktif" dan tautan sumber resmi, bukan
  data contoh atau hasil scraping.
- Bila delivery gagal, retry memakai mekanisme exponential backoff dan dead
  letter yang sudah tersedia.
- Cancel dan expiry tetap diprioritaskan kepada penerima revision sebelumnya.

## Keamanan dan Kepatuhan

- Hanya HTTPS dan domain resmi BMKG yang diizinkan.
- Redirect divalidasi ulang agar tidak keluar dari allowlist.
- Token sumber disimpan terenkripsi melalui mekanisme source settings dan tidak
  dikirim ke frontend.
- Atribusi "BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)" tampil pada
  panel, detail, peta, dan notifikasi.
- Aktivasi produksi memerlukan catatan admin tentang URL, format, rate limit,
  ketentuan penggunaan, dan tanggal persetujuan.
- SadarBencana menampilkan waktu data dari sumber dan waktu ingest secara
  terpisah untuk mencegah kesan data lebih baru dari keadaan sebenarnya.

## Pengujian

### Worker

- Fixture CAP untuk alert, update, cancel, polygon, expiry, severity hilang, dan
  payload invalid.
- Fixture kualitas udara untuk tiga kategori warning, dua kategori non-warning,
  koordinat hilang, timezone, revision, dan schema drift.
- Uji deduplikasi observasi dan revision alert.
- Uji bahwa observasi Tidak Sehat tidak otomatis menjadi official alert.
- Uji connector allowlist, redirect, timeout, rate limit, dan partial batch.

### API

- Filter `source`, `status`, `peril_type`, history, dan limit.
- Latest observation per station dan urutan kategori.
- Pencocokan polygon, titik, batas radius, peril filter, severity threshold, dan
  isolasi data antar pengguna.
- API tidak mengembalikan `raw_payload` atau credential.

### Web

- Loading, empty, stale, active, partial error, dan retry states.
- Urutan severity dan waktu, format WIB/WITA/WIT, serta aksesibilitas kategori.
- Klik warning memfokuskan polygon tanpa menggeser layout.
- EWS hanya menampilkan warning yang cocok dengan watch zone pengguna.
- Responsive check pada viewport desktop dan mobile tanpa overlap teks.

### End-to-end

- Alert cuaca baru muncul di dashboard, cocok dengan watch zone, dan membuat
  satu delivery per revision.
- Update/cancel/expiry memperbarui UI dan dikirim ke penerima sebelumnya.
- Warning kualitas udara resmi muncul pada dashboard dan EWS.
- Observasi PM2.5 muncul pada dashboard tetapi tidak membuat delivery.
- Kegagalan feed kualitas udara tidak mengganggu data cuaca atau peta.

## Peluncuran

1. Terapkan migrasi dan API dengan konektor baru tetap nonaktif.
2. Rilis UI yang menangani status belum aktif dan tetap menampilkan CAP cuaca.
3. Aktifkan `bmkg_cap` setelah verifikasi ketentuan sumber.
4. Daftarkan endpoint kualitas udara resmi, lakukan preview dan dry-run.
5. Aktifkan observasi kualitas udara, pantau freshness dan schema drift.
6. Aktifkan delivery warning kualitas udara setelah validasi geometri,
   severity, dan deduplikasi di lingkungan staging.

Rollback dilakukan dengan menonaktifkan sumber melalui source settings.
Revision dan observasi yang sudah tersimpan dipertahankan untuk audit; UI tidak
menawarkan data stale sebagai warning aktif.

## Kriteria Penerimaan

- Dashboard menampilkan peringatan cuaca aktif BMKG dengan wilayah, severity,
  waktu berlaku, atribusi, dan interaksi peta.
- Dashboard menampilkan peringatan kualitas udara resmi dan PM2.5 terukur
  sebagai dua jenis informasi yang berbeda.
- EWS menampilkan hanya warning yang relevan dengan watch zone pengguna.
- Email/Telegram hanya terkirim ketika sumber resmi, geometri, jenis alert,
  severity, preferensi, dan revision cocok.
- Update, cancel, dan expiry mempertahankan lifecycle delivery.
- Sumber gagal atau belum aktif menghasilkan status yang jujur dan tidak
  memblokir dashboard lain.
- Tidak ada HTML scraping dan semua tampilan menyertakan atribusi BMKG.

## Referensi Resmi

- BMKG CAP Nowcast: <https://www.bmkg.go.id/alerts/nowcast/id>
- Konsentrasi PM2.5 BMKG: <https://www.bmkg.go.id/kualitas-udara/pm25>
- Informasi kualitas udara dan peringatan dini ekstrem:
  <https://iklim.bmkg.go.id/en/kualitas-udara-indonesia/>
- Peraturan BMKG Nomor 6 Tahun 2023:
  <https://jdih.bmkg.go.id/dokumen/detail/4369>
- Portal data terbuka BMKG: <https://data.bmkg.go.id/>
- Ketentuan penggunaan BMKG: <https://www.bmkg.go.id/ketentuan-penggunaan>
