## Ringkasan
<!-- Apa yang diubah PR ini dan mengapa. -->

## Jenis perubahan
- [ ] `feat` — fitur baru
- [ ] `fix` — perbaikan bug
- [ ] `docs` — dokumentasi
- [ ] `refactor` — penataan ulang tanpa ubah perilaku
- [ ] `chore` / lainnya

## Issue terkait
<!-- mis. Closes #123 -->

## Verifikasi
<!-- Centang yang sudah dijalankan dan sertakan hasilnya bila relevan. -->
- [ ] `npm run build --workspace apps/web`
- [ ] `cd apps/api && go test ./... && go vet ./...`
- [ ] `cd apps/worker && pytest`
- [ ] Diuji manual (jelaskan langkahnya di bawah)

## Catatan untuk reviewer
<!-- Hal yang perlu diperhatikan, trade-off, atau bagian yang masih ragu. -->

## Checklist
- [ ] Commit mengikuti Conventional Commits (Bahasa Indonesia)
- [ ] Tidak ada secret/token yang ter-commit
- [ ] Hanya berkas relevan yang di-stage (bukan `git add -A` membabi buta)
- [ ] Dokumentasi diperbarui bila perlu
