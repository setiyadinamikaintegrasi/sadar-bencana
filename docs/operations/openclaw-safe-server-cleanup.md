# Instruksi OpenClaw: Cleanup Aman Server Sadar Bencana

Salin seluruh instruksi di bawah ini dan berikan kepada agent OpenClaw yang
berjalan pada server produksi.

## Tujuan

- Membebaskan minimal 12-15 GB.
- Tidak menghentikan atau me-restart layanan.
- Tidak menghapus image rollback, container, volume, source code,
  konfigurasi, database, atau data OpenClaw.

## Aturan keras

Hanya tindakan pembersihan berikut yang diizinkan:

```bash
npm cache clean --force
docker builder prune -f
```

Perintah dan tindakan berikut dilarang:

```text
docker system prune
docker system prune -a
docker image prune
docker volume prune
docker container prune
docker builder prune -a
rm -rf /var/lib/containerd
```

Jangan menghapus atau mengubah lokasi berikut:

```text
/root/.nvm
/root/sadar-bencana
/root/.openclaw
/root/.cloakbrowser
/root/.local
/var/lib/containerd
```

Ketentuan tambahan:

- Jangan membuka, mencetak, atau mengubah `.env` maupun file token.
- Jangan menghapus backup OpenClaw.
- Jangan menjalankan `docker compose down`.
- Jika ada build atau deployment aktif, hentikan cleanup dan laporkan.
- Jangan menjalankan cleanup tambahan walaupun target belum tercapai.

## Tahap 1 - Preflight

```bash
cd /root/sadar-bencana

printf '\n=== IDENTITAS SERVER ===\n'
hostname
date -u
id

printf '\n=== PROSES BUILD AKTIF ===\n'
ps -eo pid,etimes,cmd \
  | grep -E 'docker (compose )?build|docker buildx|npm (ci|install)|mastra build' \
  | grep -v grep || true

printf '\n=== DISK SEBELUM ===\n'
df -h /
df -B1 --output=size,used,avail,pcent /

printf '\n=== CACHE SEBELUM ===\n'
npm config get cache
du -sh /root/.npm 2>/dev/null || true
docker system df

printf '\n=== LAYANAN SEBELUM ===\n'
docker compose ps
systemctl is-active sadar-mastra.service
curl -fsS http://127.0.0.1:8001/health
curl -fsS http://127.0.0.1:8002/health
curl -fsS http://172.19.0.1:4111/health
curl -fsSI http://127.0.0.1:3001/ | head -1
curl -fsSI https://sadarbencana.id/ | head -1
```

Lanjutkan hanya jika:

- Tidak ada build atau instalasi dependency aktif.
- API, Worker, Mastra, dan Web sehat.
- Container produksi tetap berjalan.

## Tahap 2 - Catat baseline

```bash
DISK_USED_BEFORE="$(df -B1 --output=used / | tail -1 | xargs)"
DISK_AVAIL_BEFORE="$(df -B1 --output=avail / | tail -1 | xargs)"

echo "Used before : $DISK_USED_BEFORE bytes"
echo "Avail before: $DISK_AVAIL_BEFORE bytes"
```

## Tahap 3 - Cleanup yang diizinkan

```bash
npm cache clean --force
docker builder prune -f
```

Jangan menjalankan perintah cleanup tambahan walaupun target belum tercapai.

## Tahap 4 - Verifikasi

```bash
DISK_USED_AFTER="$(df -B1 --output=used / | tail -1 | xargs)"
DISK_AVAIL_AFTER="$(df -B1 --output=avail / | tail -1 | xargs)"
RECLAIMED="$((DISK_USED_BEFORE - DISK_USED_AFTER))"

printf '\n=== HASIL CLEANUP ===\n'
echo "Used before : $DISK_USED_BEFORE bytes"
echo "Used after  : $DISK_USED_AFTER bytes"
echo "Avail before: $DISK_AVAIL_BEFORE bytes"
echo "Avail after : $DISK_AVAIL_AFTER bytes"
echo "Reclaimed   : $RECLAIMED bytes"

df -h /
du -sh /root/.npm 2>/dev/null || true
docker system df

printf '\n=== LAYANAN SESUDAH ===\n'
docker compose ps
systemctl is-active sadar-mastra.service
curl -fsS http://127.0.0.1:8001/health
curl -fsS http://127.0.0.1:8002/health
curl -fsS http://172.19.0.1:4111/health
curl -fsSI http://127.0.0.1:3001/ | head -1
curl -fsSI https://sadarbencana.id/ | head -1
```

## Tahap 5 - Laporan

Laporkan:

- Kapasitas disk sebelum dan sesudah.
- Total ruang yang dibebaskan.
- Status setiap container.
- Status API, Worker, Mastra, Web lokal, dan domain publik.
- Perintah yang gagal, jika ada.

Jika ruang kosong masih kurang dari 15 GB, hanya laporkan kandidat cleanup
berikutnya beserta ukuran dan risikonya. Jangan menghapus kandidat tersebut
tanpa persetujuan baru.
