# Panduan Kontribusi

Terima kasih atas minat Anda berkontribusi ke **Risk Monitor (RM)**. Dokumen ini menjelaskan cara menyiapkan lingkungan, gaya kode, dan alur kerja kontribusi.

Proyek ini berlisensi [Apache-2.0](LICENSE). Dengan mengirim kontribusi, Anda setuju kontribusi tersebut dilisensikan di bawah lisensi yang sama.

---

## Sebelum mulai

- **Diskusikan dulu untuk perubahan besar.** Untuk fitur baru atau perubahan arsitektur, buka [Issue](../../issues) lebih dulu agar arah desain selaras sebelum Anda menulis kode.
- **Perbaikan kecil** (typo, bug jelas, dokumentasi) boleh langsung dibuatkan Pull Request.
- Baca [README](README.md) untuk gambaran arsitektur dan model open-core.

---

## Menyiapkan lingkungan pengembangan

Instruksi lengkap ada di [README — Instalasi](README.md#instalasi). Ringkasnya untuk dev lokal:

```bash
npm install                          # dependency JS (monorepo)
docker compose up -d postgres redis  # database + cache
cp .env.example .env                 # dan buat .env.local (lihat README)
./start.sh                           # API :8001, Mastra :4111, Web :3001
```

Prasyarat: Node.js 20+, Go 1.25, Python 3.11+, Docker.

---

## Alur kerja kontribusi

1. **Fork** repository (kontributor eksternal) atau buat **branch** dari `main`.
2. Beri nama branch sesuai jenis perubahan:
   - `feat/<ringkas>` — fitur baru
   - `fix/<ringkas>` — perbaikan bug
   - `docs/<ringkas>` — dokumentasi
   - `refactor/<ringkas>` — penataan ulang tanpa ubah perilaku
3. Lakukan perubahan, jaga commit tetap fokus dan kecil.
4. Pastikan **build & test lulus** (lihat di bawah).
5. Buka **Pull Request** ke `main`, isi sesuai template PR.
6. Tanggapi review; PR di-merge setelah disetujui.

> Jangan menjalankan `git add -A` membabi buta — stage hanya berkas yang relevan dengan perubahan Anda.

---

## Konvensi commit

Gunakan **[Conventional Commits](https://www.conventionalcommits.org/)** dalam Bahasa Indonesia, sesuai gaya yang sudah dipakai di repo:

```
feat: tambah filter peril pada Daftar Risiko
fix: auto-refresh token Supabase saat 401 lalu retry sekali
docs: perbarui panduan instalasi
refactor: pisahkan helper format ke lib/
```

Format: `<tipe>: <deskripsi ringkas, huruf kecil di awal>`. Tipe umum: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.

---

## Gaya kode

Ikuti gaya kode yang sudah ada di sekitar berkas yang Anda ubah (penamaan, indentasi, idiom). Secara umum:

- **TypeScript / React** (`apps/web`, `apps/mastra`): 2 spasi indentasi, single quotes, tanpa semicolon di akhir statement (mengikuti gaya berkas yang ada). Semua React hooks dideklarasikan sebelum early return.
- **Go** (`apps/api`): jalankan `gofmt`/`go vet`. Patuhi pola handler & error envelope yang ada.
- **Python** (`apps/worker`): ikuti PEP 8; gunakan type hint bila memungkinkan.
- **SQL** (`db/schema`): migrasi baru sebagai berkas bernomor berikutnya (mis. `017_*.sql`), idempoten bila memungkinkan, dan jangan mengubah migrasi lama yang sudah dirilis.

Jangan menambahkan dependency baru tanpa alasan yang jelas dan, untuk perubahan besar, tanpa diskusi di Issue.

---

## Build & test sebelum PR

Pastikan perintah berikut lulus untuk area yang Anda sentuh:

```bash
# Frontend (type-check via build)
npm run build --workspace apps/web

# API (Go)
cd apps/api && go test ./... && go vet ./...

# Worker (Python)
cd apps/worker && pytest
```

Sebutkan di deskripsi PR perintah verifikasi mana yang sudah Anda jalankan dan hasilnya.

---

## Keamanan

Jangan pernah commit secret (token Supabase, kredensial DB, API key). Berkas `.env`, `.env.local`, dan turunannya sudah di-`.gitignore` — jaga tetap demikian. Jika menemukan kerentanan keamanan, jangan buka Issue publik; hubungi pemilik proyek secara privat.

---

## Pertanyaan

Buka [Issue](../../issues) dengan label `question` atau mulai diskusi. Terima kasih sudah berkontribusi! ❤️
