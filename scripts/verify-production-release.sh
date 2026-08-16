#!/usr/bin/env bash
# Verifikasi pasca-deploy sadarbencana.id untuk release b60677f
# (peta operasional MapLibre opt-in + runbook OpenClaw).
# Jalankan dari mana saja: bash scripts/verify-production-release.sh
set -u

BASE="https://sadarbencana.id"
FAIL=0

check() { # name expected actual
  if [ "$2" = "$3" ]; then
    printf 'PASS  %s (%s)\n' "$1" "$3"
  else
    printf 'FAIL  %s: expected %s got %s\n' "$1" "$2" "$3"
    FAIL=1
  fi
}

# 1. Halaman utama & bundle baru (hash lama CA8WvLN4 harus hilang)
check "root HTTP" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")"
BUNDLE="$(curl -s "$BASE/" | grep -oE 'assets/index-[^"]+\.js' | head -1)"
if [ -n "$BUNDLE" ] && [ "$BUNDLE" != "assets/index-CA8WvLN4.js" ]; then
  printf 'PASS  bundle berubah: %s\n' "$BUNDLE"
else
  printf 'FAIL  bundle masih lama/kosong: %s\n' "$BUNDLE"
  FAIL=1
fi

# 2. Bundle memuat kode peta operasional (marker baru rilis ini)
MARKERS="$(curl -s "$BASE/$BUNDLE" | grep -c 'maplibre\|map/operations')"
if [ "${MARKERS:-0}" -gt 0 ]; then
  printf 'PASS  bundle memuat %s marker peta operasional\n' "$MARKERS"
else
  printf 'FAIL  bundle tidak memuat kode peta operasional\n'
  FAIL=1
fi

# 3. API meta masih sehat
check "api meta" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/meta")"

BBOX="106.7,-6.4,107.1,-6.0" # area Jakarta, extent < 20 derajat (batas API)

# 4. Endpoint peta operasional baru (publik) — bbox wajib
for EP in events alerts air-quality evacuations; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/map/operations/$EP?bbox=$BBOX&zoom=8")"
  case "$CODE" in
    200) printf 'PASS  map endpoint %s (200)\n' "$EP" ;;
    *)   printf 'FAIL  map endpoint %s: %s\n' "$EP" "$CODE"; FAIL=1 ;;
  esac
done

# 5. Endpoint privat harus menolak tanpa auth
PRIV="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/me/map/watch-zones?bbox=$BBOX")"
case "$PRIV" in
  401|403) printf 'PASS  map privat watch-zones ditolak tanpa auth (%s)\n' "$PRIV" ;;
  *)       printf 'FAIL  map privat watch-zones: %s (harusnya 401/403)\n' "$PRIV"; FAIL=1 ;;
esac

echo '---'
if [ "$FAIL" -eq 0 ]; then
  echo 'SEMUA VERIFIKASI PASS — release b60677f live di produksi.'
else
  echo 'ADA VERIFIKASI GAGAL — lihat baris FAIL di atas.'
fi
exit "$FAIL"
