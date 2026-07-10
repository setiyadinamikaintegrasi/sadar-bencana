# Lokasi Evakuasi — Design Spec

Status: **Draft, disetujui untuk masuk tahap perencanaan implementasi.**
Tanggal: 2026-07-11

## 1. Ringkasan

Fitur baru untuk menampilkan lokasi evakuasi (shelter, TES, TEA, posko
BNPB/BPBD, rumah sakit, puskesmas, kantor polisi, damkar, titik kumpul, pos
SAR, gudang logistik) di peta, membantu pengguna menemukan tempat aman
terdekat, memberi rekomendasi lokasi berbasis jenis bencana yang sedang
aktif, dan menyediakan navigasi ke lokasi terpilih.

Halaman baru `/lokasi-evakuasi`, **publik tanpa login** — konsisten dengan
prinsip bahwa informasi keselamatan harus bisa diakses siapa saja saat
darurat, termasuk pengunjung tanpa akun.

## 2. Batasan Keselamatan (penting)

Kebijakan AI yang sudah berlaku di produk ini (`docs/ai-regional-risk-analyst.md`)
menolak instruksi evakuasi spekulatif dari model bahasa. Fitur ini **tidak**
memakai AI generatif untuk memutuskan lokasi mana yang direkomendasikan —
seluruh logika rekomendasi bersifat **rule-based/deterministik** (lihat
bagian 5). Ini konsisten dengan disclaimer README: *"SadarBencana adalah
alat monitoring dan pendukung keputusan, bukan pengganti peringatan atau
arahan evakuasi dari BMKG, BNPB, PVMBG, BPBD, dan instansi berwenang
lainnya."*

Mapping bencana → jenis lokasi (bagian 5) hanya berdasarkan **kategori
tipe lokasi**, bukan verifikasi topografi/elevasi otomatis. Sistem tidak
menilai apakah suatu lokasi benar-benar di dataran tinggi atau jauh dari
lereng — ini bergantung pada kurasi manual admin saat menandai
tipe lokasi (TEA resmi BNPB, misalnya, sudah melalui kajian bahaya saat
ditetapkan).

## 3. Sumber Data

Dua sumber, dibedakan lewat kolom `source_type`:

- **OpenStreetMap (Overpass API)** — otomatis, untuk fasilitas umum yang
  sudah bertag di OSM: rumah sakit, puskesmas/klinik, kantor polisi, damkar.
  Disinkronkan berkala (connector worker, lihat bagian 6), bukan sekali
  jalan — fasilitas publik jarang berubah tapi tetap perlu refresh.
- **Manual (admin CRUD + import CSV)** — untuk kategori yang tidak punya
  sumber terbuka reliable di Indonesia: shelter, TES, TEA, posko BNPB/BPBD,
  titik kumpul, pos SAR, gudang logistik.

Tidak ada dedup otomatis lintas sumber di v1 — kalau admin menambahkan
lokasi manual yang kebetulan sudah ada dari OSM, keduanya bisa tampil
dobel. Diterima sebagai limitasi v1, diselesaikan lewat review manual admin
bila terjadi.

## 4. Data Model

Migrasi baru `db/schema/038_evacuation_locations.sql`, tabel
`evacuation_locations`:

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | uuid | PK |
| `name` | text | |
| `location_type` | text (CHECK enum) | `shelter`, `tes`, `tea`, `posko_bnpb_bpbd`, `rumah_sakit`, `puskesmas`, `kantor_polisi`, `damkar`, `titik_kumpul`, `pos_sar`, `gudang_logistik` |
| `source_type` | text (CHECK enum) | `osm` \| `manual` |
| `source_ref` | text, nullable | OSM node/way id — kunci dedup saat re-sync connector |
| `latitude`, `longitude` | double precision | |
| `address` | text, nullable | |
| `photo_url` | text, nullable | URL Supabase Storage |
| `capacity` | integer, nullable | |
| `is_open`, `is_full` | boolean, nullable | `null` = tidak diketahui (default untuk entri OSM, yang tidak punya status real-time) |
| `phone`, `person_in_charge` | text, nullable | |
| `facilities` | text[], nullable | |
| `operating_hours` | text, nullable | free text |
| `is_active` | boolean, default true | soft-delete |
| `created_by` | uuid, nullable | admin yang input (entri manual) |
| `created_at`, `updated_at` | timestamptz | |

RLS: `SELECT` publik untuk `is_active = true` saja (baris soft-delete tidak
boleh terlihat publik). `INSERT`/`UPDATE`/`DELETE` cuma admin — pola sama
dengan Sumber Resmi/EWS admin yang sudah ada.

## 5. Backend API

Handler baru `apps/api/internal/http/evacuation_locations.go`. Reuse
langsung `haversineKm` + `boundingBox` dari `geo.go` (tidak ditulis ulang),
dan reuse pola pencarian event terdekat dari titik koordinat yang sudah ada
di `personal_assets.go`.

| Endpoint | Akses | Fungsi |
|---|---|---|
| `GET /api/v1/evacuation-locations` | Publik | List lokasi aktif untuk render peta, filter opsional by bbox viewport |
| `GET /api/v1/evacuation-locations/nearest` | Publik | "Cari Tempat Aman" — param `lat`, `lon`, opsional `disaster_type` (override manual) |
| `POST /api/v1/evacuation-locations` | Admin | Tambah lokasi manual |
| `PATCH /api/v1/evacuation-locations/:id` | Admin | Edit, termasuk toggle `is_open`/`is_full` |
| `DELETE /api/v1/evacuation-locations/:id` | Admin | Soft-delete (`is_active=false`) |
| `POST /api/v1/evacuation-locations/import` | Admin | Import CSV bulk, pola validasi sama dengan `contracts_import.go` |

### Logika `/nearest`

1. Kalau `disaster_type` tidak di-override: query tabel `events` dalam
   radius **25 km** dari `(lat, lon)` — konsisten dengan default
   `alert_radius_km` yang sudah dipakai untuk `personal_assets` (migrasi
   `034`) — ambil jenis bencana dari event aktif terdekat (reuse pola
   korelasi yang sudah ada).
2. Tentukan `location_type` prioritas dari mapping tetap (constant di Go,
   bukan tabel database — daftar berikut sudah stabil, tidak perlu UI admin
   untuk mengubahnya di v1):

   | Jenis bencana | Prioritas lokasi |
   |---|---|
   | Gempa | `titik_kumpul`, `posko_bnpb_bpbd` |
   | Tsunami | `tea`, `posko_bnpb_bpbd` |
   | Banjir | `shelter`, `tes` |
   | Longsor | `tea`, `posko_bnpb_bpbd` |
   | Gunung api | `tea`, `posko_bnpb_bpbd` |
   | Kebakaran | `titik_kumpul` |
   | (tidak ada bencana aktif terdeteksi) | semua tipe, urut jarak murni |

3. Bounding-box prefilter + haversine untuk hitung jarak ke tiap lokasi yang
   cocok filter tipe, urutkan terdekat, kembalikan **10 lokasi teratas**.
4. Tiap hasil menyertakan jarak (km) dan estimasi waktu tempuh dua mode:
   jalan kaki (asumsi ~5 km/jam) dan kendaraan (asumsi ~40 km/jam) — UI yang
   memilih mana yang ditampilkan.

## 6. Worker Connector (OSM)

`apps/worker/connectors/evacuation_osm.py`, mengikuti struktur connector
yang sudah ada (`base.py` + file per-connector, graceful degradation kalau
gagal — log warning, skip cycle, tidak crash ingest lain, sama seperti
pola `aisstream.py` saat API key kosong).

- Query Overpass API untuk tag `amenity=hospital|clinic|police|fire_station`
  dalam bbox Indonesia (reuse pola konstanta bbox seperti di `aisstream.py`)
- User-Agent identifikasi diri, kehati-hatian yang sama dengan
  `GEOCODER_USER_AGENT` yang sudah dipakai untuk Nominatim
- Map tag OSM → `location_type` (`amenity=hospital`→`rumah_sakit`, dst),
  upsert pakai `source_ref` (OSM id) sebagai kunci dedup, `source_type='osm'`
- v1: upsert-only, tidak menghapus otomatis entri yang hilang dari OSM
- Scheduler baru di `apps/worker/schedulers/`, jadwal mingguan

## 7. Frontend

Struktur baru `apps/web/src/features/evacuation/`:

| Komponen | Fungsi |
|---|---|
| `EvacuationPage.tsx` | Halaman utama — peta + tombol CTA "Cari Tempat Aman" + panel hasil |
| `EvacuationMap.tsx` | Peta Leaflet, marker per `location_type` (pola sama filter layer `RiskMap.tsx`). Warna marker dari status: hijau (buka & tidak penuh), kuning (buka & penuh/hampir penuh), abu-abu (tutup/status tidak diketahui) |
| `NearestSafePlacePanel.tsx` | Hasil pencarian — list lokasi terdekat + jarak + estimasi waktu + jenis + kapasitas, badge kalau mode Smart Recommendation aktif |
| `EvacuationLocationDetail.tsx` | Detail lokasi (foto, semua field, PIC, jam operasional) + tombol navigasi |
| `EvacuationAdminPage.tsx` + import modal | Form tambah/edit + CSV import, pola sama `OfficialSourcesSettingsPage`/`EwsAdminSettingsPage` |

### Alur "Cari Tempat Aman"

1. `navigator.geolocation.getCurrentPosition()` minta lokasi user.
2. Kalau ditolak/tidak didukung browser → fallback: user klik manual di
   peta untuk set posisinya sendiri (tidak blocking).
3. Panggil `GET /evacuation-locations/nearest`, tampilkan hasil di panel.

### Navigasi

Setelah pilih lokasi dari panel/detail, tiga opsi:

- **Google Maps** — deep link `google.com/maps/dir/?api=1&destination={lat},{lon}`
- **Waze** — deep link `waze.com/ul?ll={lat},{lon}&navigate=yes`
- **Navigasi Internal** — garis lurus di peta yang sama dari posisi user ke
  tujuan + jarak/estimasi (reuse hasil `/nearest`, atau hitung ulang di
  client kalau user pilih lokasi di luar hasil nearest). **Bukan**
  turn-by-turn routing jalan sungguhan (di luar scope v1 — lihat bagian 9).

### Upload Foto

Langsung dari browser ke Supabase Storage lewat `supabase-js` client yang
sudah ada di `lib/supabase.ts` (sama pola dengan auth — tidak proxy binary
lewat Go API). URL hasil upload disimpan ke `photo_url` saat submit form.
Upload gagal tidak boleh memblokir penyimpanan lokasi — field foto opsional,
admin bisa retry lewat edit.

### Empty State

Kalau tidak ada lokasi ditemukan dalam radius pencarian, tampilkan pesan
jelas + saran perluas radius — bukan silent kosong.

## 8. Error Handling

| Skenario | Penanganan |
|---|---|
| Overpass API timeout/rate-limit/error | Connector log warning & skip cycle |
| Geolocation ditolak/tidak didukung | Fallback pin manual di peta |
| Tidak ada lokasi dalam radius | Empty state + saran perluas radius |
| Auto-detect bencana tidak nemu event aktif | Fallback nearest semua tipe, urut jarak |
| Upload foto gagal | Lokasi tetap tersimpan tanpa foto, retry via edit |
| Baris CSV import tidak valid | Validasi + laporan error per-baris |
| RLS | `SELECT` publik cuma untuk `is_active = true` |

## 9. Testing

- **Go** (`apps/api`): unit test logika nearest-search (bbox + haversine +
  rule-based filter), handler CRUD admin (termasuk cek 401/403 tanpa auth),
  validasi CSV import — file `evacuation_locations_test.go`.
- **Python** (`apps/worker`): test mapping tag OSM → `location_type`,
  parsing response Overpass yang di-mock — konvensi `apps/worker/tests/`.
- **Frontend**: belum ada test runner terpasang (README: `npm run build`
  jadi gate type-check). QA manual: render peta, alur geolocation
  (izinkan/tolak), nearest search + smart recommendation dengan event aktif
  ter-mock, deep link Google Maps/Waze, CRUD admin + CSV import, upload
  foto.

## 10. Di Luar Scope v1

- Role petugas lokasi untuk update status sendiri (baru admin yang bisa
  edit) — bisa jadi fase berikutnya.
- Turn-by-turn routing jalan sungguhan (OSRM/API pihak ketiga) — v1 pakai
  garis lurus + estimasi.
- Tabel mapping bencana→lokasi yang bisa diedit admin lewat UI — v1
  hardcoded di kode.
- Dedup otomatis lintas sumber (OSM vs manual).
- Verifikasi topografi/elevasi otomatis untuk kesesuaian lokasi terhadap
  jenis bencana (lihat bagian 2).
