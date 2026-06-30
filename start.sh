#!/usr/bin/env bash
# Sadar Bencana Startup Script — jalankan semua service sekaligus
# Usage: ./start.sh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$PROJECT_DIR/.logs"
mkdir -p "$LOG_DIR"

# --- Load local environment (Supabase DB credentials, etc.) ---
# .env.local is gitignored; it must set DATABASE_URL to the Supabase pooled
# connection string. Services now fail fast when DATABASE_URL is missing instead
# of falling back to a local PostgreSQL database.
if [ -f "$PROJECT_DIR/.env.local" ]; then
  set -a
  . "$PROJECT_DIR/.env.local"
  set +a
  echo "🔑 Loaded .env.local"
fi

echo "🚀 Starting Sadar Bencana services..."
echo "   Project: $PROJECT_DIR"
echo ""

source_hash() {
  local directory="$1"
  local pattern="$2"
  find "$directory" -type f -name "$pattern" -exec shasum {} + \
    | sort \
    | shasum \
    | awk '{print $1}'
}

stop_listening_port() {
  local port="$1"
  local pids
  pids=$( (lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true) | awk 'NR>1{print $2}' | sort -u)
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill 2>/dev/null || true
    sleep 1
  fi
}

# --- 1. Go API Backend (:8001) ---
API_SOURCE_HASH=$(source_hash "$PROJECT_DIR/apps/api" '*.go')
API_BINARY="$PROJECT_DIR/apps/api/sadar-api"
if lsof -nP -iTCP:8001 -sTCP:LISTEN >/dev/null 2>&1; then
  API_RUNNING_HASH=$(cat "$LOG_DIR/api.source-hash" 2>/dev/null || true)
  if [ "$API_RUNNING_HASH" != "$API_SOURCE_HASH" ]; then
    echo "↻  API source changed — restarting :8001"
    stop_listening_port 8001
  else
    echo "✅ API (:8001) — already running and current"
  fi
fi
if ! lsof -nP -iTCP:8001 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "▶  Building Go API..."
  cd "$PROJECT_DIR/apps/api"
  go build -o "$API_BINARY" ./cmd/server
  echo "▶  Starting Go API binary (:8001)..."
  nohup "$API_BINARY" > "$LOG_DIR/api.log" 2>&1 </dev/null &
  echo $! > "$LOG_DIR/api.pid"
  echo "$API_SOURCE_HASH" > "$LOG_DIR/api.source-hash"
  sleep 3
  if curl -sSo /dev/null --max-time 3 http://127.0.0.1:8001/health 2>/dev/null; then
    echo "✅ API (:8001) — started (PID $(cat "$LOG_DIR/api.pid"))"
  else
    echo "❌ API (:8001) — failed to start. Check $LOG_DIR/api.log"
  fi
fi

# --- 2. Mastra AI (:4111) ---
if lsof -nP -iTCP:4111 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✅ Mastra (:4111) — already running"
else
  echo "▶  Starting Mastra AI (:4111)..."
  cd "$PROJECT_DIR/apps/mastra"
  nohup npx mastra dev > "$LOG_DIR/mastra.log" 2>&1 &
  echo $! > "$LOG_DIR/mastra.pid"
  sleep 5
  if curl -sSo /dev/null --max-time 3 http://127.0.0.1:4111/health 2>/dev/null; then
    echo "✅ Mastra (:4111) — started (PID $(cat "$LOG_DIR/mastra.pid"))"
  else
    echo "❌ Mastra (:4111) — failed to start. Check $LOG_DIR/mastra.log"
  fi
fi

# --- 3. Worker FastAPI (:8002) ---
WORKER_SOURCE_HASH=$(source_hash "$PROJECT_DIR/apps/worker" '*.py')
if lsof -nP -iTCP:8002 -sTCP:LISTEN >/dev/null 2>&1; then
  WORKER_RUNNING_HASH=$(cat "$LOG_DIR/worker.source-hash" 2>/dev/null || true)
  if [ "$WORKER_RUNNING_HASH" != "$WORKER_SOURCE_HASH" ]; then
    echo "↻  Worker source changed — restarting :8002"
    stop_listening_port 8002
  else
    echo "✅ Worker (:8002) — already running and current"
  fi
fi
if ! lsof -nP -iTCP:8002 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "▶  Starting Worker FastAPI (:8002)..."
  cd "$PROJECT_DIR/apps/worker"
  nohup .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8002 > "$LOG_DIR/worker.log" 2>&1 &
  echo $! > "$LOG_DIR/worker.pid"
  echo "$WORKER_SOURCE_HASH" > "$LOG_DIR/worker.source-hash"
  sleep 3
  if curl -sSo /dev/null --max-time 3 http://127.0.0.1:8002/health 2>/dev/null; then
    echo "✅ Worker (:8002) — started (PID $(cat "$LOG_DIR/worker.pid"))"
  else
    echo "❌ Worker (:8002) — failed to start. Check $LOG_DIR/worker.log"
  fi
fi

# --- 4. Vite Frontend (:3001) ---
if lsof -nP -iTCP:3001 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✅ Vite (:3001) — already running"
else
  echo "▶  Starting Vite Frontend (:3001)..."
  cd "$PROJECT_DIR"
  nohup npm run dev --workspace apps/web > "$LOG_DIR/vite.log" 2>&1 &
  echo $! > "$LOG_DIR/vite.pid"
  sleep 3
  if curl -sSo /dev/null --max-time 3 'http://[::1]:3001/' 2>/dev/null; then
    echo "✅ Vite (:3001) — started (PID $(cat "$LOG_DIR/vite.pid"))"
  else
    echo "❌ Vite (:3001) — failed to start. Check $LOG_DIR/vite.log"
  fi
fi

echo ""
echo "📊 Dashboard: http://localhost:3001"
echo "📝 Logs: $LOG_DIR/"
echo ""
echo "To stop all: ./stop.sh"
