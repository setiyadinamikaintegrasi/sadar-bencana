#!/usr/bin/env bash
set -u

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$PROJECT_DIR/.logs"
API_BINARY="$PROJECT_DIR/apps/api/sadar-api"
API_PID=""
WORKER_PID=""

mkdir -p "$LOG_DIR"
if [ -f "$PROJECT_DIR/.env.local" ]; then
  set -a
  . "$PROJECT_DIR/.env.local"
  set +a
fi

port_is_listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

start_api() {
  if port_is_listening 8001; then
    return
  fi
  (
    cd "$PROJECT_DIR/apps/api" || exit 1
    go build -o "$API_BINARY" ./cmd/server
  ) >>"$LOG_DIR/api-supervisor.log" 2>&1 || return
  "$API_BINARY" >>"$LOG_DIR/api.log" 2>&1 &
  API_PID=$!
  echo "$API_PID" >"$LOG_DIR/api.pid"
}

start_worker() {
  if port_is_listening 8002; then
    return
  fi
  (
    cd "$PROJECT_DIR/apps/worker" || exit 1
    exec .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8002
  ) >>"$LOG_DIR/worker.log" 2>&1 &
  WORKER_PID=$!
  echo "$WORKER_PID" >"$LOG_DIR/worker.pid"
}

cleanup() {
  if [ -n "$API_PID" ]; then
    kill "$API_PID" 2>/dev/null || true
  fi
  if [ -n "$WORKER_PID" ]; then
    kill "$WORKER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

while true; do
  if ! port_is_listening 8001; then
    start_api
  fi
  if ! port_is_listening 8002; then
    start_worker
  fi
  sleep 2
done
