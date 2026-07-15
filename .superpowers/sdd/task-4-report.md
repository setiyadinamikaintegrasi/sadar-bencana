# Task 4 Report: Restrict Official Lifecycle Delivery to Matching Watch Zones

## Status

Implemented and verified in the `feat/bmkg-dashboard-ews` worktree based on
`ca15565`.

## Behavior Delivered

- Initial `alert` actions now load the persisted official alert and enqueue only
  active subscribers with enabled channel preferences, enabled channel settings,
  a severity-compatible preference, a peril-compatible preference, and one
  active matching watch zone.
- Watch-zone matching covers both official polygon metadata with
  `ST_Intersects` and official point metadata with `ST_DWithin`.
- Zone peril filtering allows an empty zone peril list as a wildcard and
  otherwise requires the official `peril_type`.
- A lateral query chooses one deterministic matching zone by `created_at, id`
  and stores it in `matched_watch_zone_id`.
- `update`, `cancellation`, and `expiry` actions do not re-evaluate geography or
  notification preferences. They select the most recent successful prior row
  per subscriber/channel and carry forward its `matched_watch_zone_id`.
- Prior-recipient delivery still requires the channel to be globally enabled.
- Existing email/Telegram channel constraints and revision/action dedup through
  `ON CONFLICT DO NOTHING` remain unchanged.
- Claimed official deliveries now prefer `official_alerts.severity` and
  `official_alerts.peril_type` for notification content.

## Files

- `apps/worker/alerts/lifecycle_delivery.py`
  - Replaced the initial enqueue SQL with persisted official-alert matching.
  - Added deterministic matched-zone persistence.
  - Added latest-successful prior-recipient selection and zone retention.
  - Routed updates through the prior-recipient path.
  - Preferred official severity and peril metadata when claiming deliveries.
- `apps/worker/tests/alerts/test_lifecycle_delivery.py`
  - Added enqueue pool fixtures and official-alert inputs.
  - Added polygon, point, peril, severity, preference, deterministic-zone,
    lifecycle-action, prior-recipient, recency, dedup, and bind-order coverage.
  - Added official claim metadata coverage.
- `.superpowers/sdd/task-4-report.md`
  - Captures implementation, TDD evidence, verification, review, and concerns.

## TDD Evidence

### Baseline

Command:

```bash
apps/worker/.venv/bin/python -m pytest \
  apps/worker/tests/alerts/test_lifecycle_delivery.py \
  apps/worker/tests/integration/test_ews_dispatch.py -q
```

Result before Task 4 test edits: `12 passed in 0.14s`.

### RED

Production code was unchanged when the new tests were first run.

Command:

```bash
apps/worker/.venv/bin/python -m pytest \
  apps/worker/tests/alerts/test_lifecycle_delivery.py -q
```

Result: `5 failed, 4 passed in 0.11s`.

Expected failures demonstrated:

1. Initial alerts still used the old six-parameter query and did not expose the
   required matching semantics.
2. Updates incorrectly selected the initial geo/preference query.
3. Cancellations did not retain `matched_watch_zone_id` or select the latest
   successful recipient row.
4. Expiries did not retain `matched_watch_zone_id` or select the latest
   successful recipient row.
5. Claimed official delivery content did not prefer official severity/peril.

### GREEN

After the minimal production edit:

```bash
apps/worker/.venv/bin/python -m pytest \
  apps/worker/tests/alerts/test_lifecycle_delivery.py -q
```

Result: `9 passed in 0.08s`.

## Verification

Focused lifecycle and dispatcher command:

```bash
cd apps/worker
.venv/bin/python -m pytest \
  tests/alerts/test_lifecycle_delivery.py \
  tests/integration/test_ews_dispatch.py -q
```

Result: `17 passed in 0.10s`.

Relevant worker suite command:

```bash
cd apps/worker
.venv/bin/python -m pytest tests -q
```

Result: `240 passed, 4 warnings in 0.67s`. The warnings are existing FastAPI
`on_event` lifespan deprecations in `main.py` and FastAPI internals.

Additional checks:

- `git diff --check`: passed.
- Python compile check for the changed worker and test modules: passed.
- Static SQL placeholder audit:
  - `_ENQUEUE_ACTIVE_SQL`: `$1`, `$2`, `$3` only.
  - `_ENQUEUE_PRIOR_RECIPIENTS_SQL`: `$1` through `$6`, contiguous.

## SQL Parameter Review

Initial alert bind order:

1. `$1`: current official alert ID.
2. `$2`: lifecycle action (`alert`).
3. `$3`: deterministic disaster correlation ID.

Prior-recipient bind order:

1. `$1`: current official alert ID.
2. `$2`: source.
3. `$3`: source alert ID.
4. `$4`: current revision.
5. `$5`: lifecycle action (`update`, `cancellation`, or `expiry`).
6. `$6`: deterministic disaster correlation ID.

Both INSERT statements have 12 target columns and 12 projected values.

## Self-Review

- Confirmed only `alert` uses polygon/point, zone peril, preference severity,
  and preference alert-type matching.
- Confirmed update, cancellation, and expiry use the same prior-recipient query.
- Confirmed prior rows are restricted to `sent` or `acknowledged` and ordered by
  revision descending, then creation time descending, per subscriber/channel.
- Confirmed the selected prior row's zone ID is inserted into the new revision.
- Confirmed deterministic initial zone selection prevents duplicate candidates
  from multiple matching watch zones.
- Confirmed enabled channel settings remain enforced for both paths.
- Confirmed revision/action dedup remains enforced with `ON CONFLICT DO NOTHING`.
- Confirmed no migration, connector, API, or unrelated worker files changed.

## Concerns

- No live PostgreSQL/PostGIS execution was available because the local Docker
  daemon was not running. SQL behavior is covered through enqueue-level tests,
  exact bind-order assertions, SQL-semantic assertions, and placeholder audits,
  but not a database-backed PostGIS integration test in this task.
- Successful notification rows created before migration 040 can have a null
  `matched_watch_zone_id`; a later lifecycle revision correctly carries that
  historical null because no reliable prior zone exists to reconstruct.

## Review Finding Fixes (2026-07-15)

### Behavior Added

- Added an opt-in `asyncpg`/PostGIS integration module that creates a unique
  schema with only the tables, columns, foreign keys, and official-delivery
  unique index used by `enqueue_official_alert_revision`. The schema is dropped
  in `finally`, including when a test fails.
- Covered intersecting/non-intersecting polygons, points inside/outside the
  configured radius, deterministic selection between competing zones, zone
  peril exclusion, minimum-severity exclusion, alert-type and disabled-
  preference exclusion, `ON CONFLICT` revision deduplication, and matched-zone
  retention for update/cancellation/expiry.
- Added `official_alerts_area_geojson_valid_check` to migration 040. The PostGIS
  `ST_IsValid` check is `NOT VALID`, so historical rows are not scanned while
  subsequent invalid polygon writes are rejected.
- Guarded `ST_Intersects` behind a `CASE` and `ST_IsValid`, so a historical
  self-intersecting polygon is ignored and cannot enqueue a delivery.
- Added explicit PostgreSQL casts to the prior-recipient parameters. The live
  test exposed that the prior query previously failed at prepare time because
  `$2` was inferred as both `text` and `varchar`.

### RED Evidence

Production lifecycle SQL and migration 040 were unchanged for the first run.

```bash
cd apps/worker
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/sadar_test \
  .venv/bin/python -m pytest \
  tests/integration/test_lifecycle_delivery_postgis.py -q
```

Result: `4 failed, 4 passed in 2.17s`.

- Update, cancellation, and expiry each failed with
  `asyncpg.exceptions.AmbiguousParameterError: inconsistent types deduced for
  parameter $2 (text versus character varying)`.
- The invalid-polygon case failed because migration 040 did not contain
  `official_alerts_area_geojson_valid_check`.

After adding only the migration constraint, the focused invalid-history case
remained RED:

```bash
cd apps/worker
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/sadar_test \
  .venv/bin/python -m pytest \
  tests/integration/test_lifecycle_delivery_postgis.py::test_historical_invalid_polygon_is_quarantined_without_aborting_batch \
  -q
```

Result: `1 failed in 0.36s`; the historical self-intersecting polygon enqueued
one delivery (`assert 1 == 0`), proving that write-time enforcement alone did
not quarantine historical data.

### GREEN Evidence

The explicit prior-recipient bind casts were verified independently:

```bash
cd apps/worker
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/sadar_test \
  .venv/bin/python -m pytest \
  tests/integration/test_lifecycle_delivery_postgis.py::test_lifecycle_changes_retain_prior_recipient_zone \
  -q
```

Result: `3 passed in 1.04s`.

Real PostGIS integration suite after the validity guard:

```bash
cd apps/worker
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/sadar_test \
  .venv/bin/python -m pytest \
  tests/integration/test_lifecycle_delivery_postgis.py -q
```

Result: `8 passed in 2.26s` against PostgreSQL 16 / PostGIS 3.4.3.

Focused lifecycle verification:

```bash
cd apps/worker
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/sadar_test \
  .venv/bin/python -m pytest \
  tests/alerts/test_lifecycle_delivery.py \
  tests/integration/test_lifecycle_delivery_postgis.py -q
```

Result: `17 passed in 2.21s`.

Full worker verification with the integration tests opted in:

```bash
cd apps/worker
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/sadar_test \
  .venv/bin/python -m pytest tests -q
```

Result: `248 passed, 4 warnings in 2.86s`. The warnings are the existing FastAPI
`on_event` lifespan deprecations in `main.py` and FastAPI internals.

Additional evidence:

- Database cleanup query returned `task4 schemas remaining: 0`.
- `git diff --check`: passed.
- Python compilation of the changed lifecycle and test modules: passed.
- `ruff` was unavailable in `apps/worker/.venv`; no ruff result is claimed.

### Review Self-Check

- The integration test executes the production enqueue function and production
  SQL through a real `asyncpg.Pool`; it does not mock database results.
- The migration test inserts historical invalid data first, then extracts and
  executes migration 040's actual `ALTER TABLE` statement. It verifies the old
  row remains and a new equivalent invalid row raises `CheckViolationError`.
- `CASE` guarantees `ST_Intersects` is evaluated only for non-null, topologically
  valid polygon geometry. Point matching remains an independent fallback.
- Competing zones produce one delivery and retain the earliest `created_at, id`
  match. Repeating the same revision produces zero additional rows.
- Update, cancellation, and expiry retain the original successful recipient and
  `matched_watch_zone_id`, even when the later alert geometry is outside the
  zone.
- Changes remain scoped to lifecycle delivery/tests, migration 040, and this
  report.

### Remaining Concerns

- Historical successful rows created before migration 040 may still have a null
  `matched_watch_zone_id`; this pre-existing limitation is unchanged.
