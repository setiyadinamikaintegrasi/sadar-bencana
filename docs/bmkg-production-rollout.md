# BMKG Production Rollout

This runbook deploys the BMKG dashboard and EWS release to
`https://sadarbencana.id`. Run it from the root Docker Compose checkout on the
Mac Mini against the existing Supabase production database. It is for the
release operator, application administrator, notification administrator, and
database owner.

Do not copy a local test database, development data, or demo fixtures to
production. Do not print, commit, or paste production credentials into the
repository, terminal history, tickets, or chat. This is an additive release:
it preserves existing earthquake and wildfire data and applies only migration
`040` after the gates below pass.

## 1. Release Gate And Preflight

Deploy only a reviewed, merged release from `origin/main`. Start from a shell
where the protected production environment is already loaded; do not source a
repository example environment file. These commands verify only presence of
protected values and never print them.

```bash
set -Eeuo pipefail

cd /opt/sadar-bencana
test -f docker-compose.yml
test -f db/schema/040_bmkg_warning_and_air_quality.sql
git rev-parse --show-toplevel
git status --short
git diff --quiet
git diff --cached --quiet
git fetch origin main

export PREVIOUS_COMMIT="$(git rev-parse HEAD)"
export RELEASE_COMMIT="$(git rev-parse origin/main)"
export BACKUP_DIR="/var/backups/sadarbencana/bmkg-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

: "${PREVIOUS_COMMIT:?previous production commit is required}"
: "${RELEASE_COMMIT:?merged release commit is required}"
: "${BACKUP_DIR:?timestamped backup directory is required}"
printf 'previous=%s\nrelease=%s\nbackup_dir=%s\n' \
  "$PREVIOUS_COMMIT" "$RELEASE_COMMIT" "$BACKUP_DIR"

git merge-base --is-ancestor "$PREVIOUS_COMMIT" "$RELEASE_COMMIT"
git checkout --detach "$RELEASE_COMMIT"
test "$(git rev-parse HEAD)" = "$RELEASE_COMMIT"
```

The checkout must be clean, the release must be the reviewed merged commit,
and the current production commit must be its ancestor. Resolve any failure
before touching the database.

Verify tools, environment, hosted-mode baseline, Compose interpolation, service
health, disk space, current commit, and the production URL:

```bash
for command in git docker curl psql pg_dump pg_restore awk df jq ss; do
  command -v "$command" >/dev/null
done
docker compose version

required_vars=(
  DATABASE_URL SUPABASE_URL SUPABASE_JWT_SECRET MASTRA_API_TOKEN
  WORKER_API_TOKEN OFFICIAL_SOURCE_SETTINGS_KEY
)
for variable in "${required_vars[@]}"; do
  if [[ -z "${!variable:-}" ]]; then
    printf 'missing required production variable: %s\n' "$variable" >&2
    exit 1
  fi
done

[[ "${API_ENV:-}" == "hosted" ]]
[[ "${DEPLOYMENT_MODE:-}" == "hosted" ]]
[[ "${EWS_DELIVERY_ENABLED:-}" == "false" ]]
[[ "${EWS_LIFECYCLE_DELIVERY_ENABLED:-}" == "false" ]]
[[ "${CORS_ALLOWED_ORIGINS:-}" == "https://sadarbencana.id,https://www.sadarbencana.id" ]]
[[ "${EWS_PUBLIC_BASE_URL:-}" == "https://sadarbencana.id" ]]
printf '%s\n' 'required environment values are present; protected values were not printed'

docker compose config --quiet
docker compose ps
curl -fsS http://127.0.0.1:8001/health
curl -fsS https://sadarbencana.id/api/v1/meta >/dev/null
curl -fsSI https://sadarbencana.id/ >/dev/null
df -h /opt/sadar-bencana "$BACKUP_DIR"
ss -ltnp | grep -E ':3001|:4111|:6379|:8001|:8002'
```

All Compose services must be healthy where they define a health check. Listed
application services must bind only to loopback or private Docker networks.
Keep Redis running throughout the rollout.

## 2. Backup And Preservation Baseline

Create a full logical backup in custom format and a separate schema-only
backup. The custom dump is the recovery artifact; the schema-only dump is an
additional inspection record.

```bash
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges \
  --file "$BACKUP_DIR/production-before-040.dump"
pg_dump "$DATABASE_URL" --schema-only --no-owner --no-privileges \
  --file "$BACKUP_DIR/production-before-040-schema.sql"
pg_restore --list "$BACKUP_DIR/production-before-040.dump" \
  | tee "$BACKUP_DIR/production-before-040.dump.list" >/dev/null
test -s "$BACKUP_DIR/production-before-040.dump.list"
sha256sum "$BACKUP_DIR/production-before-040.dump" \
  "$BACKUP_DIR/production-before-040-schema.sql" \
  | tee "$BACKUP_DIR/SHA256SUMS"
```

Capture the full preservation baseline once before migration:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -F $'\t' <<'SQL' \
  | tee "$BACKUP_DIR/row-counts-before.tsv"
SELECT 'events', count(*) FROM events
UNION ALL SELECT 'alerts', count(*) FROM alerts
UNION ALL SELECT 'risk_scores', count(*) FROM risk_scores
UNION ALL SELECT 'news_items', count(*) FROM news_items
UNION ALL SELECT 'official_alerts', count(*) FROM official_alerts
UNION ALL SELECT 'acceptance_contracts', count(*) FROM acceptance_contracts
UNION ALL SELECT 'ews_subscribers', count(*) FROM ews_subscribers
UNION ALL SELECT 'ews_watch_zones', count(*) FROM ews_watch_zones
UNION ALL SELECT 'ews_notification_log', count(*) FROM ews_notification_log
ORDER BY 1;
SQL
```

Record the release commit, UTC timestamp, backup path, dump checksums, and
count file in the deployment record. Do not proceed without a readable,
non-empty `pg_restore --list` result.

## 3. Migration Preflight

Do not run the historical migration directory. There is no migration ledger,
and older migrations can contain transformations unsafe to replay. Confirm
PostGIS and the pre-`040` relation and column markers:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
SELECT extname, extversion
FROM pg_extension
WHERE extname = 'postgis';

SELECT relation_name, to_regclass('public.' || relation_name) AS relation
FROM (VALUES
  ('official_alerts'),
  ('ews_notification_log'),
  ('official_source_settings'),
  ('official_source_setting_versions'),
  ('ews_safety_guidance')
) AS required_relations(relation_name)
ORDER BY relation_name;

SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (
    ('official_alerts', 'area_geojson'),
    ('official_alerts', 'source'),
    ('official_alerts', 'status'),
    ('official_source_settings', 'enabled'),
    ('official_source_settings', 'run_mode'),
    ('ews_notification_log', 'id')
  )
ORDER BY table_name, column_name;
SQL
```

PostGIS must return one row, and every listed relation and column must exist.
They are the minimum schema markers that migrations through `039` are already
represented in production. Escalate missing markers to the database owner.

## 4. Apply And Verify Migration 040

Apply only this migration, once, in a transaction:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f db/schema/040_bmkg_warning_and_air_quality.sql
```

Verify the new table and index, added `official_alerts` columns, safety
guidance, source settings, and disabled baseline:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
SELECT to_regclass('public.air_quality_observations') AS air_quality_table,
       to_regclass('public.idx_air_quality_latest') AS latest_index;

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'official_alerts'
  AND column_name IN (
    'peril_type', 'severity', 'category', 'area_name', 'latitude',
    'longitude', 'source_url'
  )
ORDER BY column_name;

SELECT peril_type, language_code, content_version, source_url
FROM ews_safety_guidance
WHERE (peril_type, language_code, content_version) IN (
  ('weather', 'id', 'id-v1'),
  ('air_quality', 'id', 'id-v1')
)
ORDER BY peril_type;

SELECT source_name, enabled, run_mode, mode, default_api_url,
       expected_interval_seconds
FROM official_source_settings
WHERE source_name IN ('bmkg_cap', 'bmkg_air_quality')
ORDER BY source_name;
SQL
```

Both relation names must be present; the column query must return seven rows;
and the safety query must return both rows. Both source settings must show
`enabled = false` and `run_mode = disabled`. For air quality,
`default_api_url` must be null. Stop if any result differs.

Re-run the count capture after migration and reject decreases in existing
tables:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -F $'\t' <<'SQL' \
  | tee "$BACKUP_DIR/row-counts-after-040.tsv"
SELECT 'events', count(*) FROM events
UNION ALL SELECT 'alerts', count(*) FROM alerts
UNION ALL SELECT 'risk_scores', count(*) FROM risk_scores
UNION ALL SELECT 'news_items', count(*) FROM news_items
UNION ALL SELECT 'official_alerts', count(*) FROM official_alerts
UNION ALL SELECT 'acceptance_contracts', count(*) FROM acceptance_contracts
UNION ALL SELECT 'ews_subscribers', count(*) FROM ews_subscribers
UNION ALL SELECT 'ews_watch_zones', count(*) FROM ews_watch_zones
UNION ALL SELECT 'ews_notification_log', count(*) FROM ews_notification_log
ORDER BY 1;
SQL

awk -F $'\t' '
  NR == FNR { before[$1] = $2; next }
  $1 in before && $2 < before[$1] {
    printf "count decreased: %s before=%s after=%s\n", $1, before[$1], $2 > "/dev/stderr"
    failed = 1
  }
  END { exit failed }
' "$BACKUP_DIR/row-counts-before.tsv" "$BACKUP_DIR/row-counts-after-040.tsv"
```

Investigate before continuing if any count falls. A concurrent increase is
acceptable only when it is explained in the deployment record.

## 5. Build And Roll Out Containers

Build changed services before switching containers. Redis is deliberately not a
target of either command and its volume stays intact.

```bash
docker compose build api worker web
docker compose up -d --build api worker web
docker compose ps

for service in api worker web; do
  printf '\n===== %s (last 100 lines) =====\n' "$service"
  docker compose logs --tail=100 "$service"
done
```

`api`, `worker`, and `web` must run, and `api` must become healthy. Treat a
crash loop, failed health check, migration error, or unexpected connector
attempt as a rollback decision, not a source activation signal.

## 6. Production Smoke Tests

Run the external checks through the deployed domain and retain output with the
release record. They require valid JSON and fail on a non-2xx status.

```bash
export PUBLIC_BASE_URL=https://sadarbencana.id

curl -fsS "$PUBLIC_BASE_URL/api/v1/meta" | jq -e . >/dev/null
curl -fsS "$PUBLIC_BASE_URL/api/v1/events" \
  | tee "$BACKUP_DIR/events-smoke.json" \
  | jq -e '[.data[] | select(.event_type == "earthquake")] | length > 0' >/dev/null
jq -e '[.data[] | select(.event_type == "wildfire")] | length > 0' \
  "$BACKUP_DIR/events-smoke.json" >/dev/null
curl -fsS "$PUBLIC_BASE_URL/api/v1/risk-scores" | jq -e . >/dev/null
curl -fsS "$PUBLIC_BASE_URL/api/v1/health/connectors" | jq -e . >/dev/null
curl -fsS "$PUBLIC_BASE_URL/api/v1/map/overlays" | jq -e . >/dev/null
curl -fsS "$PUBLIC_BASE_URL/api/v1/official-alerts?source=bmkg_cap&status=active&limit=20" \
  | jq -e '.data | type == "array"' >/dev/null
curl -fsS "$PUBLIC_BASE_URL/api/v1/air-quality/observations?source=bmkg&latest=true&limit=50" \
  | tee "$BACKUP_DIR/air-quality-smoke.json" \
  | jq -e '.meta.source_active == false and (.data | type == "array")' >/dev/null

psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atc \
  "SELECT count(*) FROM events WHERE event_id LIKE ('seed' || '-id:%');" \
  | grep -qx '0'

for private_path in /api/v1/worker/events /api/agents; do
  status="$(curl -sS -o /dev/null -w '%{http_code}' "$PUBLIC_BASE_URL$private_path")"
  test "$status" = 404
done
```

The CAP response can validly be an empty list when no warning is active. Air
quality must return `source_active=false` and can be empty. The event queries
prove existing earthquake and wildfire data remains available; inspect the
saved response before approval to confirm it contains no synthetic identifiers.
The map-overlay endpoint must stay valid so dashboard risk overlays render.
Worker and Mastra paths must remain private and return `404` publicly.

## 7. Staged Source And Delivery Activation

Keep `EWS_DELIVERY_ENABLED=false` and
`EWS_LIFECYCLE_DELIVERY_ENABLED=false` throughout the initial observation
window. The application administrator uses **Sumber Resmi** while authenticated
as an EWS administrator. Never change source state directly through SQL.

For **BMKG CAP**, retain audit evidence for this sequence:

1. Use **Test** to confirm the approved CAP endpoint and credentials are
   reachable without enabling the source.
2. Run **Preview** and review the sanitized mapping, official HTTPS BMKG URLs,
   attribution, and samples.
3. Save the configuration as **Dry-run**, record its configuration version
   `N`, and capture relevant `official_alerts` and delivery counts.
4. Run API **Dry-run** and confirm it succeeds for exactly version `N`.
5. Wait for a scheduled worker shadow poll while `N` remains in dry-run.
   Verify fresh Source Health and no persisted official alerts or deliveries.
6. Reconfirm the current configuration is still `N`, then use **Activate** with
   the required approval reference.
7. Observe Source Health, active-warning output, worker logs, and delivery
   counts before testing notification channels.

Do not enable **BMKG Kualitas Udara**. It stays disabled until an explicit
machine-readable endpoint, terms, field mapping, and polling cadence are
approved. Its activation is separate from CAP.

The notification administrator next uses **Admin EWS** to send one Telegram
and one email channel test and records successful evidence. Only after the
source observation and both channel tests succeed may the protected host
environment be changed:

```dotenv
EWS_DELIVERY_ENABLED=true
EWS_LIFECYCLE_DELIVERY_ENABLED=true
```

Recreate only the worker, then monitor pending, failed, and dead-letter
delivery counts for 24 hours:

```bash
docker compose up -d --no-deps --force-recreate worker
docker compose logs --tail=100 worker
```

Any unexpected delivery, bad CAP mapping, missing attribution, or connector
error requires disabling the source and both delivery flags before investigation.

## 8. Application Rollback

Use application rollback for container failures, smoke-test failures, or
source and delivery problems that do not indicate database corruption.
Migration `040` stays in place because it is additive and older applications
ignore its objects.

1. In **Sumber Resmi**, disable `bmkg_cap` and `bmkg_air_quality`, record the
   reason, and verify no new source poll or delivery is created.
2. In the protected host environment, set both EWS delivery flags to `false`.
3. Recreate the worker so disabled delivery takes effect.
4. Check out the recorded previous commit, rebuild API, Worker, and Web, then
   review their status and bounded logs.

```bash
git checkout --detach "$PREVIOUS_COMMIT"
test "$(git rev-parse HEAD)" = "$PREVIOUS_COMMIT"
docker compose build api worker web
docker compose up -d --build api worker web
docker compose ps
for service in api worker web; do
  docker compose logs --tail=100 "$service"
done
```

Do not drop `040` tables, columns, indexes, guidance, or source settings during
routine application rollback.

## 9. Emergency Database Recovery

Reserve database recovery for confirmed corruption or destructive count
changes. Stop application writes first, restore only to a controlled database,
validate it, and switch only with database-owner approval. Never restore a dump
destructively over the live Supabase database.

```bash
# Stop writers while the database owner prepares a controlled restore target.
docker compose stop api worker

# RESTORE_DATABASE_URL must point to an isolated, controlled database.
: "${RESTORE_DATABASE_URL:?controlled restore database is required}"
pg_restore --exit-on-error --no-owner --no-privileges \
  --dbname="$RESTORE_DATABASE_URL" \
  "$BACKUP_DIR/production-before-040.dump"

psql "$RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -F $'\t' <<'SQL'
SELECT 'events', count(*) FROM events
UNION ALL SELECT 'alerts', count(*) FROM alerts
UNION ALL SELECT 'risk_scores', count(*) FROM risk_scores
UNION ALL SELECT 'news_items', count(*) FROM news_items
UNION ALL SELECT 'official_alerts', count(*) FROM official_alerts
UNION ALL SELECT 'acceptance_contracts', count(*) FROM acceptance_contracts
UNION ALL SELECT 'ews_subscribers', count(*) FROM ews_subscribers
UNION ALL SELECT 'ews_watch_zones', count(*) FROM ews_watch_zones
UNION ALL SELECT 'ews_notification_log', count(*) FROM ews_notification_log
ORDER BY 1;
SQL
```

Compare the controlled-database counts and integrity with the backup baseline.
The database owner can instead use Supabase point-in-time recovery, with the
same validation before changing the production connection. Only after approval
may the protected production `DATABASE_URL` point to the validated database,
`api` and `worker` restart, and the smoke tests run again. Keep production
traffic away from a restore candidate until then.
