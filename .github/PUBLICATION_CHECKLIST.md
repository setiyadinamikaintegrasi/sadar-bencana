# Checklist Publikasi Repository

Jalankan checklist ini saat mengubah visibility repository menjadi public.

## Sebelum mengubah visibility

- [ ] `main` bersih dan sinkron dengan `origin/main`.
- [ ] Workflow **CI** dan **Security** pada commit terbaru berhasil.
- [ ] Tidak ada secret pada working tree maupun riwayat Git.
- [ ] Semua URL, screenshot, seed data, dan dokumen telah diperiksa agar tidak
      memuat data pribadi atau infrastruktur internal.
- [ ] Apache License 2.0 tetap konsisten pada `LICENSE`, README, dan panduan
      kontribusi.

## Pengaturan GitHub setelah public

- [ ] Aktifkan **Private vulnerability reporting**.
- [ ] Aktifkan **Secret scanning** dan **Push protection**.
- [ ] Aktifkan **Dependency graph**, **Dependabot alerts**, dan security updates.
- [ ] Aktifkan **Discussions** atau hapus seluruh tautan Discussions bila fitur
      tersebut tidak akan digunakan.
- [ ] Lindungi branch `main`: wajib Pull Request, wajib review, wajib status
      checks **CI** dan **Security**, blok force-push serta deletion.
- [ ] Pastikan Ruleset/branch protection juga berlaku kepada administrator.

## Verifikasi publik

- [ ] GitHub mengenali `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, dan
      `CODE_OF_CONDUCT.md` pada Community Standards.
- [ ] Formulir private vulnerability reporting dapat dibuka dari
      `SECURITY.md`.
- [ ] Issue template, Pull Request template, CODEOWNERS, dan Dependabot
      berfungsi.
- [ ] Clone baru dapat mengikuti instalasi README tanpa file lokal maintainer.
