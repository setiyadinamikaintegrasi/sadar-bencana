#!/usr/bin/env bash
set -euo pipefail

container_name="sadar-operation-map-postgis-$$"
image="postgis/postgis:16-3.4"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --detach --rm --name "$container_name" \
  -e POSTGRES_USER=sadar \
  -e POSTGRES_PASSWORD=sadar \
  -e POSTGRES_DB=sadar \
  -p 127.0.0.1::5432 \
  "$image" >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$container_name" psql -U sadar -d sadar -Atqc 'SELECT PostGIS_Version()' >/dev/null 2>&1; then
    port="$(docker port "$container_name" 5432/tcp | sed 's/.*://')"
    TEST_DATABASE_URL="postgres://sadar:sadar@127.0.0.1:${port}/sadar?sslmode=disable" \
      go test ./internal/http -run 'TestOperationMap.*PostGIS' -count=1
    exit 0
  fi
  sleep 1
done

echo "PostGIS test container did not become ready" >&2
exit 1
