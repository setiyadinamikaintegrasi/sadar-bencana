# Dependency Risk Register

Dokumen ini mencatat advisory dependency yang belum dapat diperbaiki tanpa
dukungan upstream. Ini bukan daftar kerentanan yang telah dieksploitasi.

## GHSA-866g-f22w-33x8 — AI SDK provider utilities

| Field | Nilai |
|---|---|
| Severity | Low |
| Dependency | `@ai-sdk/provider-utils` jalur kompatibilitas AI SDK v5 |
| Introduced by | `@mastra/core` |
| Directly imported | Tidak |
| Status | Diterima sementara |
| Review cadence | Mingguan melalui Dependabot dan workflow Security |

Versi aman belum tersedia pada jalur compatibility alias yang dipakai rilis
Mastra saat ini. Aplikasi sudah menggunakan AI SDK v6 untuk jalur utama, tetapi
Mastra masih membawa utility v5 untuk kompatibilitas internal.

Kontrol sementara:

- CI gagal untuk advisory npm berlevel high atau critical.
- Dependabot memeriksa rilis Mastra dan AI SDK setiap minggu.
- Input AI tetap melewati validasi, timeout, dan batas payload aplikasi.
- Upgrade dilakukan segera setelah Mastra merilis dependency compatibility
  yang tidak terdampak.

Risiko ini harus ditinjau kembali paling lambat **4 Agustus 2026**, atau lebih
awal ketika pembaruan upstream tersedia.

## GHSA-frvp-7c67-39w9 — Hono Node server path traversal

| Field | Nilai |
|---|---|
| Severity | Moderate |
| Dependency | `@hono/node-server` |
| Introduced by | Mastra melalui `@mastra/deployer` dan `@modelcontextprotocol/sdk` |
| Directly imported | Tidak |
| Status | Diterima sementara |
| Review cadence | Mingguan melalui Dependabot dan workflow Security |

Advisory ini berdampak pada host Windows yang menggunakan `serve-static`
dengan encoded backslash. Deployment produksi Sadar Bencana berjalan di
Linux, dan aplikasi tidak mengimpor adapter tersebut secara langsung.

Kontrol sementara:

- CI tetap gagal untuk advisory npm berlevel high atau critical.
- Mastra hanya mendengarkan pada bridge Docker internal, bukan alamat publik.
- Upgrade dilakukan setelah Mastra mendukung `@hono/node-server >= 2.0.5`
  tanpa memerlukan penurunan atau perubahan mayor yang tidak teruji.

Risiko ini harus ditinjau kembali paling lambat **12 Agustus 2026**, atau lebih
awal ketika pembaruan upstream tersedia.
