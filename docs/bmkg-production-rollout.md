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
porcelain="$(git status --porcelain=v1 --untracked-files=all)"
if [[ -n "$porcelain" ]]; then
  printf '%s\n' "$porcelain" >&2
  printf '%s\n' 'production checkout must have no tracked, staged, or untracked changes' >&2
  exit 1
fi
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
for command in git docker curl psql pg_dump pg_restore awk df jq rg ss getent caddy python3; do
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

(
  compose_config_json="$(mktemp)"
  trap 'rm -f "$compose_config_json"' EXIT
  chmod 600 "$compose_config_json"
  docker compose config --format json > "$compose_config_json"
  python3 - "$compose_config_json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    compose = json.load(source)

services = compose.get("services", {})
api_key = services.get("api", {}).get("environment", {}).get(
    "OFFICIAL_SOURCE_SETTINGS_KEY", ""
)
worker_key = services.get("worker", {}).get("environment", {}).get(
    "OFFICIAL_SOURCE_SETTINGS_KEY", ""
)
if not isinstance(api_key, str) or not api_key:
    raise SystemExit("rendered API OFFICIAL_SOURCE_SETTINGS_KEY is empty")
if not isinstance(worker_key, str) or not worker_key:
    raise SystemExit("rendered Worker OFFICIAL_SOURCE_SETTINGS_KEY is empty")
if api_key != worker_key:
    raise SystemExit("rendered API and Worker source-settings keys differ")
print("rendered API and Worker source-settings keys are present and identical")
PY
)

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
The rendered Compose check must confirm that API and Worker receive the same
non-empty `OFFICIAL_SOURCE_SETTINGS_KEY`; it deletes the protected rendered
configuration on every success or failure path and never prints the key.
Keep Redis running throughout the rollout. Before continuing, inspect the
actual reverse-proxy configuration and every hostname that has ever publicly
addressed Worker or Mastra. Supply the real production values; this runbook
does not invent example hostnames or proxy paths.

```bash
: "${REVERSE_PROXY_CONFIG:?set the readable active reverse-proxy configuration path}"
[[ -r "$REVERSE_PROXY_CONFIG" ]]
if [[ "${RETIRED_WORKER_HOSTS+x}" != x || "${RETIRED_MASTRA_HOSTS+x}" != x ]]; then
  printf '%s\n' 'set both retired-host inventories, using an explicit empty value when applicable' >&2
  exit 1
fi

normalize_and_reject_private_upstreams() {
  local config_path="$1"
  local normalized_path="$2"
  local config_dir config_name

  config_dir="$(cd "$(dirname "$config_path")" && pwd)"
  config_name="$(basename "$config_path")"
  (
    cd "$config_dir"
    caddy adapt --config "$config_name" --adapter caddyfile --pretty
  ) > "$normalized_path"

  python3 - "$normalized_path" <<'PY'
import json
import re
import sys

MAX_DEPTH = 64
MAX_NODES = 100000
UPSTREAM_PORT = re.compile(r"(?:^|[/:\\[])(8002|4111)(?=$|[/?\\],\s])")

with open(sys.argv[1], encoding="utf-8") as source:
    config = json.load(source)

nodes_seen = 0
bad_upstreams = []

def fail_if_unbounded(depth):
    global nodes_seen
    nodes_seen += 1
    if depth > MAX_DEPTH or nodes_seen > MAX_NODES:
        raise RuntimeError("normalized Caddy configuration exceeds inspection bounds")

def strings_below(node, path, depth):
    fail_if_unbounded(depth)
    if isinstance(node, dict):
        for key, value in node.items():
            yield from strings_below(value, path + (str(key),), depth + 1)
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from strings_below(value, path + (str(index),), depth + 1)
    elif isinstance(node, str):
        yield path, node

def inspect(node, path=(), depth=0):
    fail_if_unbounded(depth)
    if isinstance(node, dict):
        if node.get("handler") == "reverse_proxy":
            for value_path, value in strings_below(node, path, depth + 1):
                for match in UPSTREAM_PORT.finditer(value):
                    bad_upstreams.append((".".join(value_path), value, match.group(1)))
        for key, value in node.items():
            inspect(value, path + (str(key),), depth + 1)
    elif isinstance(node, list):
        for index, value in enumerate(node):
            inspect(value, path + (str(index),), depth + 1)

inspect(config)
if bad_upstreams:
    for path, value, port in bad_upstreams:
        print("forbidden normalized reverse_proxy upstream port " + port + " at " + path + ": " + value, file=sys.stderr)
    raise SystemExit(1)

print("normalized Caddy proxy inspection: no Worker/Mastra upstreams")
PY
}

SYNTHETIC_PROXY_DIR="$(mktemp -d "$BACKUP_DIR/caddy-private-route-gate.XXXXXX")"
cat > "$SYNTHETIC_PROXY_DIR/bad.Caddyfile" <<'CADDY'
:443 {
  reverse_proxy {
    to 127.0.0.1:8002
  }
}
CADDY
cat > "$SYNTHETIC_PROXY_DIR/bad-mastra.Caddyfile" <<'CADDY'
:443 {
  reverse_proxy {
    to 127.0.0.1:4111
  }
}
CADDY
cat > "$SYNTHETIC_PROXY_DIR/web-only.Caddyfile" <<'CADDY'
:443 {
  reverse_proxy 127.0.0.1:3001
}
CADDY

if normalize_and_reject_private_upstreams \
  "$SYNTHETIC_PROXY_DIR/bad.Caddyfile" "$SYNTHETIC_PROXY_DIR/bad.json"; then
  printf '%s\n' 'synthetic multiline Worker proxy unexpectedly passed' >&2
  rm -rf "$SYNTHETIC_PROXY_DIR"
  exit 1
fi
if normalize_and_reject_private_upstreams \
  "$SYNTHETIC_PROXY_DIR/bad-mastra.Caddyfile" "$SYNTHETIC_PROXY_DIR/bad-mastra.json"; then
  printf '%s\n' 'synthetic multiline Mastra proxy unexpectedly passed' >&2
  rm -rf "$SYNTHETIC_PROXY_DIR"
  exit 1
fi
normalize_and_reject_private_upstreams \
  "$SYNTHETIC_PROXY_DIR/web-only.Caddyfile" "$SYNTHETIC_PROXY_DIR/web-only.json"
rm -rf "$SYNTHETIC_PROXY_DIR"

NORMALIZED_PROXY_CONFIG="$BACKUP_DIR/reverse-proxy-adapted.json"
normalize_and_reject_private_upstreams "$REVERSE_PROXY_CONFIG" "$NORMALIZED_PROXY_CONFIG"
```

`REVERSE_PROXY_CONFIG` must name the active Caddyfile, including its active
imports. The command runs `caddy adapt` from that file's directory so Caddy
normalizes multiline blocks and imports before inspection. The bounded Python
check examines every string under each normalized `reverse_proxy` handler and
fails on an upstream endpoint using Worker port `8002` or Mastra port `4111`.
It retains the adapted JSON in `BACKUP_DIR` for the deployment record. The
synthetic multiline Worker and Mastra blocks must fail, while the web-only
block must pass. Existing hostname blocks may respond only with `404`. Set
`RETIRED_WORKER_HOSTS` and `RETIRED_MASTRA_HOSTS` to space-separated, actual
hostnames from the production DNS and proxy history; explicitly set either to
an empty string only when that service has never had a public hostname.

```bash
check_retired_host() {
  local host="$1"
  local path="$2"
  local status

  if ! getent hosts "$host" >/dev/null 2>&1; then
    printf 'retired hostname absent from DNS: %s\n' "$host"
    return 0
  fi

  status="$(curl --connect-timeout 5 --max-time 15 -sS -o /dev/null \
    -w '%{http_code}' "https://$host$path")"
  test "$status" = 404
  printf 'retired hostname returned 404: %s%s\n' "$host" "$path"
}

for host in $RETIRED_WORKER_HOSTS; do
  check_retired_host "$host" /api/v1/worker/events
done
for host in $RETIRED_MASTRA_HOSTS; do
  check_retired_host "$host" /api/agents
done
```

An absent DNS name or an HTTP `404` is accepted for every supplied retired
hostname. A resolvable hostname that returns any other status, including a
redirect or successful response, fails the rollout. The loopback/private
listener check above remains mandatory.

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

Before migration or application rollout, reject every event whose normalized
`source` or `event_id` contains a standalone `seed`, `demo`, `synthetic`,
`mock`, `fixture`, or `test` marker. Apply the same boundary to every
`risk_scores.entity_id`, including orphan scores with no matching event. This
gate covers every event category and exports evidence for both tables.

```bash
synthetic_event_count="$(
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -At <<'SQL'
WITH normalized_events AS (
  SELECT
    lower(regexp_replace(btrim(COALESCE(source, '')), '[^a-zA-Z0-9]+', '-', 'g'))
      AS normalized_source,
    lower(regexp_replace(btrim(COALESCE(event_id, '')), '[^a-zA-Z0-9]+', '-', 'g'))
      AS normalized_event_id
  FROM events
)
SELECT count(*)
FROM normalized_events
WHERE normalized_source ~ '(^|-)(seed|demo|synthetic|mock|fixture|test)(-|$)'
   OR normalized_event_id ~ '(^|-)(seed|demo|synthetic|mock|fixture|test)(-|$)';
SQL
)"
[[ "$synthetic_event_count" =~ ^[0-9]+$ ]]

synthetic_risk_score_count="$(
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -At <<'SQL'
WITH normalized_risk_scores AS (
  SELECT
    lower(regexp_replace(btrim(COALESCE(entity_id, '')), '[^a-zA-Z0-9]+', '-', 'g'))
      AS normalized_entity_id
  FROM risk_scores
)
SELECT count(*)
FROM normalized_risk_scores
WHERE normalized_entity_id ~ '(^|-)(seed|demo|synthetic|mock|fixture|test)(-|$)';
SQL
)"
[[ "$synthetic_risk_score_count" =~ ^[0-9]+$ ]]

psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --csv <<'SQL' \
  > "$BACKUP_DIR/suspected-synthetic-events.csv"
WITH normalized_events AS (
  SELECT
    id, event_type, source, event_id, event_time,
    lower(regexp_replace(btrim(COALESCE(source, '')), '[^a-zA-Z0-9]+', '-', 'g'))
      AS normalized_source,
    lower(regexp_replace(btrim(COALESCE(event_id, '')), '[^a-zA-Z0-9]+', '-', 'g'))
      AS normalized_event_id
  FROM events
)
SELECT
  id, event_type, source, event_id, event_time,
  normalized_source ~ '(^|-)(seed|demo|synthetic|mock|fixture|test)(-|$)'
    AS source_marker,
  normalized_event_id ~ '(^|-)(seed|demo|synthetic|mock|fixture|test)(-|$)'
    AS event_id_marker
FROM normalized_events
WHERE normalized_source ~ '(^|-)(seed|demo|synthetic|mock|fixture|test)(-|$)'
   OR normalized_event_id ~ '(^|-)(seed|demo|synthetic|mock|fixture|test)(-|$)'
ORDER BY event_time DESC NULLS LAST, id;
SQL

psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --csv <<'SQL' \
  > "$BACKUP_DIR/suspected-synthetic-risk-scores.csv"
WITH normalized_risk_scores AS (
  SELECT
    id, entity_type, entity_id, score, calculated_at,
    lower(regexp_replace(btrim(COALESCE(entity_id, '')), '[^a-zA-Z0-9]+', '-', 'g'))
      AS normalized_entity_id
  FROM risk_scores
)
SELECT
  id, entity_type, entity_id, score, calculated_at,
  normalized_entity_id ~ '(^|-)(seed|demo|synthetic|mock|fixture|test)(-|$)'
    AS entity_id_marker
FROM normalized_risk_scores
WHERE normalized_entity_id ~ '(^|-)(seed|demo|synthetic|mock|fixture|test)(-|$)'
ORDER BY calculated_at DESC NULLS LAST, id;
SQL

{
  printf 'relation\tmatching_rows\n'
  printf 'events\t%s\n' "$synthetic_event_count"
  printf 'risk_scores\t%s\n' "$synthetic_risk_score_count"
} | tee "$BACKUP_DIR/suspected-synthetic-counts.tsv"
chmod 600 \
  "$BACKUP_DIR/suspected-synthetic-events.csv" \
  "$BACKUP_DIR/suspected-synthetic-risk-scores.csv" \
  "$BACKUP_DIR/suspected-synthetic-counts.tsv"
test -s "$BACKUP_DIR/suspected-synthetic-events.csv"
test -s "$BACKUP_DIR/suspected-synthetic-risk-scores.csv"
test -s "$BACKUP_DIR/suspected-synthetic-counts.tsv"

if (( synthetic_event_count > 0 || synthetic_risk_score_count > 0 )); then
  printf 'synthetic/demo rows require remediation: events=%s risk_scores=%s\n' \
    "$synthetic_event_count" "$synthetic_risk_score_count" >&2
  exit 1
fi
printf '%s\n' 'synthetic event/risk-score preflight passed: 0 matching rows'
```

If the gate finds rows in either table, stop the rollout. The database owner
must use the backup, both CSV exports, and the counts file to propose whether
each exact event or risk score must be moved to a restricted quarantine table
for audit retention or deleted because it has no production record value. Get
that remediation approved before executing it, and record the approver, exact
event row IDs, exact risk-score row IDs and entity IDs, and before/after
counts. Do not rename markers to bypass the gate and do not delete rows in
migration `040`. After approved remediation, rerun the entire gate, attach the
new exports and counts to the deployment record, and do not continue until
both event and risk-score counts are zero.

## 3. Migration Preflight

Do not run the historical migration directory. There is no migration ledger,
and older migrations can contain transformations unsafe to replay. Confirm
PostGIS and the pre-`040` relation and column markers:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  missing_relations TEXT;
  missing_columns TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    RAISE EXCEPTION 'missing required extension: postgis';
  END IF;

  SELECT string_agg(relation_name, ', ' ORDER BY relation_name)
  INTO missing_relations
  FROM (VALUES
    ('official_alerts'),
    ('ews_notification_log'),
    ('official_source_settings'),
    ('official_source_setting_versions'),
    ('ews_safety_guidance'),
    ('evacuation_locations'),
    ('learning_user_stats'),
    ('learning_module_progress'),
    ('learning_badges'),
    ('learning_user_badges')
  ) AS required_relations(relation_name)
  WHERE to_regclass(format('public.%I', relation_name)) IS NULL;

  IF missing_relations IS NOT NULL THEN
    RAISE EXCEPTION 'missing required pre-040 relations: %', missing_relations;
  END IF;

  SELECT string_agg(table_name || '.' || column_name, ', ' ORDER BY table_name, column_name)
  INTO missing_columns
  FROM (VALUES
    ('official_alerts', 'area_geojson'),
    ('official_alerts', 'source'),
    ('official_alerts', 'status'),
    ('official_source_settings', 'enabled'),
    ('official_source_settings', 'run_mode'),
    ('ews_notification_log', 'id')
  ) AS required_columns(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = required_columns.table_name
      AND c.column_name = required_columns.column_name
  );

  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'missing required pre-040 columns: %', missing_columns;
  END IF;
END $$;

SELECT extname, extversion
FROM pg_extension
WHERE extname = 'postgis';

SELECT relation_name, to_regclass('public.' || relation_name) AS relation
FROM (VALUES
  ('official_alerts'),
  ('ews_notification_log'),
  ('official_source_settings'),
  ('official_source_setting_versions'),
  ('ews_safety_guidance'),
  ('evacuation_locations'),
  ('learning_user_stats'),
  ('learning_module_progress'),
  ('learning_badges'),
  ('learning_user_badges')
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

SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'official_source_settings'
  AND column_name = 'expected_interval_seconds';

SELECT conname, convalidated, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.official_source_settings'::regclass
  AND conname = 'official_source_settings_expected_interval_seconds_check';

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'ews_notification_log'
  AND column_name = 'matched_watch_zone_id';

SELECT c.conname, c.conrelid::regclass AS table_name,
       source_column.attname AS column_name,
       c.confrelid::regclass AS foreign_table_name,
       target_column.attname AS foreign_column_name,
       CASE c.confdeltype WHEN 'n' THEN 'SET NULL' ELSE c.confdeltype::text END
         AS on_delete
FROM pg_constraint c
JOIN pg_attribute source_column
  ON source_column.attrelid = c.conrelid
 AND source_column.attnum = ANY (c.conkey)
JOIN pg_attribute target_column
  ON target_column.attrelid = c.confrelid
 AND target_column.attnum = ANY (c.confkey)
WHERE c.contype = 'f'
  AND c.conrelid = 'public.ews_notification_log'::regclass
  AND source_column.attname = 'matched_watch_zone_id';

SELECT tgname, tgrelid::regclass AS table_name, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'public.official_alerts'::regclass
  AND tgname = 'official_alerts_area_geojson_validation'
  AND NOT tgisinternal;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute column_attribute
    JOIN pg_attrdef column_default
      ON column_default.adrelid = column_attribute.attrelid
     AND column_default.adnum = column_attribute.attnum
    WHERE column_attribute.attrelid = 'public.official_source_settings'::regclass
      AND column_attribute.attname = 'expected_interval_seconds'
      AND column_attribute.attnotnull
      AND pg_get_expr(column_default.adbin, column_default.adrelid) = '600'
  ) THEN
    RAISE EXCEPTION 'expected_interval_seconds must be NOT NULL with default 600';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.official_source_settings'::regclass
      AND conname = 'official_source_settings_expected_interval_seconds_check'
      AND contype = 'c'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'missing validated expected_interval_seconds range check';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM official_source_settings
    WHERE expected_interval_seconds NOT BETWEEN 60 AND 86400
  ) THEN
    RAISE EXCEPTION 'expected_interval_seconds contains an out-of-range value';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ews_notification_log'
      AND column_name = 'matched_watch_zone_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'missing ews_notification_log.matched_watch_zone_id UUID column';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute source_column
      ON source_column.attrelid = c.conrelid
     AND source_column.attnum = ANY (c.conkey)
    JOIN pg_attribute target_column
      ON target_column.attrelid = c.confrelid
     AND target_column.attnum = ANY (c.confkey)
    WHERE c.contype = 'f'
      AND c.conrelid = 'public.ews_notification_log'::regclass
      AND source_column.attname = 'matched_watch_zone_id'
      AND c.confrelid = 'public.ews_watch_zones'::regclass
      AND target_column.attname = 'id'
      AND c.confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION 'missing matched_watch_zone_id foreign key to ews_watch_zones(id) ON DELETE SET NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.official_alerts'::regclass
      AND tgname = 'official_alerts_area_geojson_validation'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'missing official_alerts_area_geojson_validation trigger';
  END IF;
END $$;
SQL
```

Both relation names must be present; the column query must return seven rows;
and the safety query must return both rows. Both source settings must show
`enabled = false` and `run_mode = disabled`. For air quality,
`default_api_url` must be null. The notification-log column must be a UUID, its
single foreign key must target `ews_watch_zones(id)` with `ON DELETE SET NULL`,
`expected_interval_seconds` must be `NOT NULL` with default `600` and its named
range check must be validated, and the trigger query must return
`official_alerts_area_geojson_validation` on `official_alerts`. Stop if any
result differs. Migration `040` fills only null interval values. An existing
out-of-range interval or an orphaned `matched_watch_zone_id` makes validation
roll back the migration; after backup, the database owner must investigate and
repair or quarantine the specific rows, record approval, and rerun the
migration rather than disabling either constraint.

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

for private_path in /api/v1/worker/events /api/agents; do
  status="$(curl -sS -o /dev/null -w '%{http_code}' "$PUBLIC_BASE_URL$private_path")"
  test "$status" = 404
done
```

The CAP response can validly be an empty list when no warning is active. Air
quality must return `source_active=false` and can be empty. The event queries
prove existing earthquake and wildfire data remains available. The
comprehensive pre-rollout database gate already covers normalized `source` and
`event_id` markers across all event categories; inspect the saved response as
an additional defense before approval.
The map-overlay endpoint must stay valid so dashboard risk overlays render.
Worker and Mastra paths must remain private and return `404` publicly.

## 7. Post-Rollout Preservation Gate

Before activating any source, repeat the full preservation capture after the
container rollout and smoke tests. Compare it directly with the original
pre-migration baseline, not the post-migration capture.

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -F $'\t' <<'SQL' \
  | tee "$BACKUP_DIR/row-counts-after-rollout-smoke.tsv"
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
' "$BACKUP_DIR/row-counts-before.tsv" \
  "$BACKUP_DIR/row-counts-after-rollout-smoke.tsv"
```

Investigate any decrease before source activation. A concurrent increase must
be explained in the deployment record; no activation can proceed until the
original baseline comparison succeeds.

## 8. Staged Source And Delivery Activation

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

## 9. Application Rollback

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

## 10. Emergency Database Recovery

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
