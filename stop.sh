#!/usr/bin/env bash
# Sadar Bencana Stop Script — hentikan semua service
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$PROJECT_DIR/.logs"

echo "🛑 Stopping Sadar Bencana services..."

for port in 8001 8002 4111 3001; do
  pids=$( (lsof -nP -iTCP:$port -sTCP:LISTEN 2>/dev/null || true) | awk 'NR>1{print $2}' | sort -u)
  if [ -n "$pids" ]; then
    echo "▶  Killing port :$port (PID: $(echo $pids | tr '\n' ' '))"
    echo "$pids" | xargs kill -9 2>/dev/null || true
  else
    echo "✅ Port :$port — already clear"
  fi
done

echo ""
echo "All services stopped."
