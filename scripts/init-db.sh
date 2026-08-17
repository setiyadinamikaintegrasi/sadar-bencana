#!/usr/bin/env bash
# =============================================================================
# init-db.sh — bootstrap the local dev database (wrapper, kept for convention)
# Usage   : bash scripts/init-db.sh
# Delegates to infra/local/init-db.sh — the dev stack now mirrors production
# (PostgreSQL 17 + PostGIS 3.5, container `sadar-postgres`, network `sadar-net`).
# =============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "${SCRIPT_DIR}/infra/local/init-db.sh" "$@"
