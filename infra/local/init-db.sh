#!/usr/bin/env bash
# =============================================================================
# init-db.sh — bootstrap local PostgreSQL (mirrors production) + apply schema
# Project : Sadar Bencana
# Usage   : bash infra/local/init-db.sh
# Requires: Docker Desktop (or colima) running. Start it from the UI first.
# Stack   : infra/local/docker-compose.yml (PostgreSQL 17 + PostGIS 3.5,
#           container `sadar-postgres`, network `sadar-net` — paritas dengan
#           infra/production/docker-compose.db.yml).
# =============================================================================
set -euo pipefail

# --- Locate this script's directory (works from any CWD) ---------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
SCHEMA_DIR="${SCRIPT_DIR}/../../db/schema"

# --- Load local env (POSTGRES_USER / DB) -------------------------------------
if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  # shellcheck disable=SC1091
  set -a; . "${SCRIPT_DIR}/.env"; set +a
fi

PG_USER="${POSTGRES_USER:-sadar}"
PG_DB="${POSTGRES_DB:-sadar_bencana}"

# --- Validate schema dir exists ----------------------------------------------
if [[ ! -d "${SCHEMA_DIR}" ]]; then
  echo "ERROR: schema dir not found: ${SCHEMA_DIR}" >&2
  exit 1
fi

# --- Healthcheck helper ------------------------------------------------------
wait_healthy() {
  local svc="$1" max="${2:-60}" i=0
  echo "Waiting for ${svc} to become healthy..."
  while ! docker compose -f "${COMPOSE_FILE}" ps "${svc}" \
            --format json 2>/dev/null \
            | grep -q '"Health":"healthy"'; do
    i=$((i+1))
    if (( i >= max )); then
      echo "ERROR: ${svc} did not become healthy within ${max} polls." >&2
      docker compose -f "${COMPOSE_FILE}" logs --tail=30 "${svc}" || true
      exit 1
    fi
    printf "."
    sleep 2
  done
  echo " OK (${svc} healthy)"
}

echo "==> Starting postgres (docker compose up -d)"
docker compose -f "${COMPOSE_FILE}" up -d postgres

# --- Wait for postgres health ------------------------------------------------
wait_healthy postgres 60

# --- Skip if schema already applied ------------------------------------------
ALREADY=$(docker compose -f "${COMPOSE_FILE}" exec -T postgres \
  psql -U "${PG_USER}" -d "${PG_DB}" -tAc \
  "SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='local_users')")
if [[ "${ALREADY}" == "t" ]]; then
  echo "==> Schema already applied (local_users exists) — skipping migrations."
  echo "    Untuk DB bersih: docker compose -f ${COMPOSE_FILE} down -v"
else
  echo "==> Applying schema files from ${SCHEMA_DIR##*/}/ (in order)"
  for sql in "${SCHEMA_DIR}"/*.sql; do
    echo "    -> ${sql##*/}"
    docker compose -f "${COMPOSE_FILE}" exec -T \
        -e PGOPTIONS="--client-min-messages=warning" \
        postgres psql -v ON_ERROR_STOP=1 -U "${PG_USER}" -d "${PG_DB}" \
        < "${sql}"
  done
fi

echo ""
echo "==> Ready. Tables in database '${PG_DB}':"
docker compose -f "${COMPOSE_FILE}" exec -T postgres \
    psql -U "${PG_USER}" -d "${PG_DB}" -c "\dt"

echo ""
echo "Done. Connection string for host-native apps:"
echo "  DATABASE_URL=postgresql://${PG_USER}:${POSTGRES_PASSWORD:-sadar_dev_password}@127.0.0.1:5432/${PG_DB}"
echo "  (redis dev tetap native di redis://localhost:6379)"
