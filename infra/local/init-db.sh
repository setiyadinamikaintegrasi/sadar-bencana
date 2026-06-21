#!/usr/bin/env bash
# =============================================================================
# init-db.sh — bootstrap local PostgreSQL + Redis and apply baseline schema
# Project : Reinsurance Risk Monitor (PT Tugure)
# Usage   : bash infra/local/init-db.sh
# Requires: Docker Desktop (or colima) running. Start it from the UI first.
# =============================================================================
set -euo pipefail

# --- Locate this script's directory (works from any CWD) ---------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
SCHEMA_FILE="${SCRIPT_DIR}/../../db/schema/001_init.sql"

# --- Load local env (POSTGRES_USER / DB) -------------------------------------
if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  # shellcheck disable=SC1091
  set -a; . "${SCRIPT_DIR}/.env"; set +a
fi

PG_USER="${POSTGRES_USER:-rrm}"
PG_DB="${POSTGRES_DB:-reinsurance_risk_monitor}"

# --- Validate schema file exists ---------------------------------------------
if [[ ! -f "${SCHEMA_FILE}" ]]; then
  echo "ERROR: schema file not found: ${SCHEMA_FILE}" >&2
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

echo "==> Starting postgres + redis (docker compose up -d)"
docker compose -f "${COMPOSE_FILE}" up -d postgres redis

# --- Wait for postgres health ------------------------------------------------
wait_healthy postgres 60

echo "==> Applying schema: ${SCHEMA_FILE##*/}"
docker compose -f "${COMPOSE_FILE}" exec -T \
    -e PGOPTIONS="--client-min-messages=warning" \
    postgres psql -v ON_ERROR_STOP=1 -U "${PG_USER}" -d "${PG_DB}" \
    < "${SCHEMA_FILE}"

echo ""
echo "==> Schema applied successfully."
echo "Tables in database '${PG_DB}':"
docker compose -f "${COMPOSE_FILE}" exec -T postgres \
    psql -U "${PG_USER}" -d "${PG_DB}" -c "\dt"

echo ""
echo "Done. Connection string for host-native apps:"
echo "  DATABASE_URL=postgres://${PG_USER}@localhost:5432/${PG_DB}"
echo "  REDIS_URL=redis://localhost:6379"
