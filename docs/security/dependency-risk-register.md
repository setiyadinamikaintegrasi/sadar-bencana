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
