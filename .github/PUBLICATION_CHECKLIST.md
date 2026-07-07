# Checklist Rilis Community Repository

Gunakan checklist ini untuk menerbitkan snapshot publik bersih ke repository
baru `sadar-bencana-community.git`. Jangan mengubah visibility repository
private/internal ini secara langsung bila riwayat Git lama masih memuat konteks
internal, metadata PR lama, atau branch kerja yang tidak ditujukan untuk publik.

## 1. Siapkan sumber snapshot

- [ ] `main` private/internal bersih dan sinkron dengan `origin/main`.
- [ ] Semua PR public-readiness P0/P1 sudah merge.
- [ ] Workflow **CI** dan **Security** pada commit terbaru berhasil.
- [ ] Tidak ada perubahan lokal yang belum commit kecuali catatan private yang
      di-ignore.
- [ ] Catat commit SHA yang akan menjadi sumber snapshot community.

## 2. Export snapshot tanpa riwayat Git

- [ ] Buat direktori kerja baru di luar repository private.
- [ ] Copy source tree dari commit terpilih tanpa direktori `.git`.
- [ ] Jangan copy file lokal/ignored:
  - `.env*` kecuali `.env.example`
  - `.local-notes/`
  - `.superpowers/`
  - `.impeccable/`
  - `.logs/`, `logs/`
  - virtualenv, `node_modules`, `dist`, build output
  - database lokal, backup, dump, certificate, private key
- [ ] Inisialisasi Git baru di snapshot tersebut.
- [ ] Commit pertama: `chore: initial community release`.

## 3. Scan snapshot sebelum push public

- [ ] `gitleaks detect --source . --redact --no-banner`.
- [ ] Jalankan brand denylist scan dari catatan private maintainer; tidak
      boleh ada nama brand/domain internal lama pada snapshot public.
- [ ] Jalankan credential-pattern scan; hasil hanya boleh berisi placeholder
      aman dan tidak token-shaped.
- [ ] `git ls-files` tidak memuat `.env`, dump, backup, DB lokal, private
      notes, atau artefak build.
- [ ] Screenshot dan seed data telah dicek sebagai synthetic/demo only.
- [ ] README dapat dijalankan dari clone bersih tanpa file lokal maintainer.

## 4. Push ke repository public baru

- [ ] Buat repository GitHub baru `sadar-bencana-community`.
- [ ] Push snapshot sebagai branch `main`.
- [ ] Pastikan repository memiliki `LICENSE`, `SECURITY.md`,
      `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue template, PR template,
      CODEOWNERS, dan Dependabot config.

## 5. Pengaturan GitHub setelah public

- [ ] Aktifkan **Private vulnerability reporting**.
- [ ] Aktifkan **Secret scanning** dan **Push protection**.
- [ ] Aktifkan **Dependency graph**, **Dependabot alerts**, dan security
      updates.
- [ ] Lindungi branch `main`: wajib Pull Request, wajib review, wajib status
      checks **CI** dan **Security**, blok force-push serta deletion.
- [ ] Pastikan Ruleset/branch protection juga berlaku kepada administrator.
- [ ] Restrict GitHub Actions ke action tepercaya, atau pin action ke SHA bila
      diperlukan.

## 6. Verifikasi publik

- [ ] GitHub Community Standards mengenali license, security policy,
      contribution guide, dan code of conduct.
- [ ] Private vulnerability reporting dapat dibuka dari `SECURITY.md`.
- [ ] Issue template, Pull Request template, CODEOWNERS, Dependabot, CI, dan
      Security workflow berfungsi di repository public baru.
- [ ] Clone baru dari `sadar-bencana-community.git` dapat build/test sesuai
      README.
