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

### Security

- Pembaruan dependency Go, Vite, dan rantai AI SDK.
- Penguatan pola ignore untuk seluruh variasi file environment.
- Jalur privat untuk pelaporan vulnerability dan pelanggaran kode etik.

## [0.1.0] - 2026-06-27

### Added

- Rilis awal SadarBencana.

[Unreleased]: https://github.com/setiyadinamikaintegrasi/sadar-bencana/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/setiyadinamikaintegrasi/sadar-bencana/releases/tag/v0.1.0
