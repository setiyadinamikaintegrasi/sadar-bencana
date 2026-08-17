#!/usr/bin/env bash
# =============================================================================
# backup-db.sh — Daily PostgreSQL backup with 7-day rotation
# Project : Sadar Bencana (production)
# Usage   : bash infra/production/scripts/backup-db.sh
# Cron    : 0 2 * * * /bin/bash /root/sadar-bencana/infra/production/scripts/backup-db.sh
# =============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/root/backups/db-daily}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="${BACKUP_DIR}/sadarbencana-${STAMP}.dump.gz"

# Load DB password from infra secrets (never hardcode in repo)
if [[ -f /root/infra/.pgpass.txt ]]; then
  export PGPASSWORD="$(cat /root/infra/.pgpass.txt)"
else
  echo "ERROR: /root/infra/.pgpass.txt not found" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

echo "==> Backing up sadar-bencana database to ${FILE}"
docker exec sadar-postgres pg_dump \
  -U postgres \
  -d postgres \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  -f - \
| gzip > "${FILE}"

SIZE=$(du -h "${FILE}" | cut -f1)
echo "==> Backup OK: ${FILE} (${SIZE})"

# Rotation: hapus backup lebih lama dari RETENTION_DAYS
echo "==> Pruning backups older than ${RETENTION_DAYS} days"
find "${BACKUP_DIR}" -name "sadarbencana-*.dump.gz" -mtime "+${RETENTION_DAYS}" -delete

echo "==> Done."
