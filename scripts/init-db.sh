#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "docker-compose.yml not found at ${COMPOSE_FILE}" >&2
  exit 1
fi

echo "Starting PostgreSQL and Redis..."
docker compose -f "${COMPOSE_FILE}" up -d postgres redis

echo "Waiting for PostgreSQL to become healthy..."
until docker compose -f "${COMPOSE_FILE}" ps postgres --format json | grep -q '"Health":"healthy"'; do
  sleep 2
done

echo "PostgreSQL is healthy. Schema files under db/schema/ are mounted into /docker-entrypoint-initdb.d and applied automatically on first initialization."
