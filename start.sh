#!/usr/bin/env bash
# Sadar Bencana Startup Script — jalankan semua service sekaligus
# Usage: ./start.sh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$PROJECT_DIR/.logs"
mkdir -p "$LOG_DIR"

# --- Load local environment (DB credentials, etc.) ---
# .env.local is gitignored; it sets DATABASE_URL (Supabase) so the Go API below
# inherits it. Without it, services fall back to the local docker-compose DB.
if [ -f "$PROJECT_DIR/.env.local" ]; then
  set -a
  . "$PROJECT_DIR/.env.local"
  set +a
  echo "🔑 Loaded .env.local"
fi

echo "🚀 Starting Sadar Bencana services..."
echo "   Project: $PROJECT_DIR"
echo ""

# --- 1. Go API Backend (:8001) ---
if lsof -nP -iTCP:8001 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✅ API (:8001) — already running"
else
  echo "▶  Starting Go API (:8001)..."
  cd "$PROJECT_DIR/apps/api"
  nohup go run ./cmd/server > "$LOG_DIR/api.log" 2>&1 &
  echo $! > "$LOG_DIR/api.pid"
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

# --- 3. Vite Frontend (:3001) ---
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
