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
