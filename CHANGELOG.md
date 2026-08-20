# Changelog

Semua perubahan penting pada proyek ini didokumentasikan di file ini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) dan
versi mengikuti [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Live Monitoring Desk dengan peta prakiraan Windy dan kanal video terkurasi.
- Pengaturan sumber resmi dengan preview, dry-run, activation gate, rollback,
  serta audit konfigurasi.
- Historical disaster intelligence, regional analytics, dan AI regional
  analyst berbasis snapshot terstruktur.
- Lokasi Evakuasi: peta lokasi evakuasi (sinkron OSM + kurasi admin),
  pencarian tempat aman terdekat berbasis bencana aktif, dan navigasi.
- Peta operasional: unduh cuplikan peta sebagai PNG dengan footer atribusi
  (brand, waktu, sumber data, © OpenStreetMap contributors) dari tombol
  "Unduh peta (PNG)" di panel legenda.
- Peta operasional: overlay satelit inframerah (suhu puncak awan) dari NASA
  GIBS Himawari Band 13 — gratis tanpa API key, granule ±10-15 menit,
  tanggal vintage (UTC) ditampilkan di legenda.
- Peta operasional: badge komposisi klaster — deretan titik berwarna per
  jenis bencana di bawah lingkaran klaster, dibangun dari klaster aktual
  (getClusterLeaves) sehingga komposisi selalu akurat.
- Sprint 5 S1: statistik zonal populasi WorldPop (grid 1km UNadj 2020,
  CC BY 4.0) — endpoint /api/v1/spatial/population-summary untuk poligon
  bebas dengan kuota vertex/luas, vintage & atribusi dataset terlihat.
- Sprint 5 S2: fasilitas kritis dalam radius titik — endpoint
  /api/v1/spatial/critical-facilities (agregat per jenis + daftar
  terdekat, sumber OSM + entri manual) dan panel "Estimasi area 30 km"
  di detail event peta (populasi WorldPop + fasilitas kritis).
- Sprint 5 S3: distribusi tutupan lahan ESA WorldCover 10m 2020 v100 —
  sampel kelas ~1km (4 juta titik) dengan endpoint
  /api/v1/spatial/landcover-summary dan baris "Tutupan lahan" di panel
  dampak (mis. kawasan terbangun 76% Jakarta, hutan 89% Kalimantan).
- Sprint 5 S4: ringkasan medan dari AWS Terrain Tiles (SRTM) — endpoint
  /api/v1/spatial/elevation-summary (min/max/mean, kekasaran, % terjal,
  % perairan; statistik hanya atas daratan) dan baris "Medan" di panel
  dampak (mis. Ruteng 0-1.288 m terjal; Jakarta datar).

### Security

- Pembaruan dependency Go, Vite, dan rantai AI SDK.
- Penguatan pola ignore untuk seluruh variasi file environment.
- Jalur privat untuk pelaporan vulnerability dan pelanggaran kode etik.

## [0.1.0] - 2026-06-27

### Added

- Rilis awal SadarBencana.

[Unreleased]: https://github.com/setiyadinamikaintegrasi/sadar-bencana/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/setiyadinamikaintegrasi/sadar-bencana/releases/tag/v0.1.0
