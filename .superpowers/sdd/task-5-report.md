# Task 5 Report: Personalized Active Warning API

## RED

Created `apps/api/internal/http/ews_active_warnings_test.go` before production code.

Command:

```bash
cd apps/api
go test ./internal/http -run 'TestEWSMeActiveWarnings|TestEWSMeNotifications.*LifecycleMetadata' -count=1
```

Result: failed as expected because `EWSMeActiveWarnings` and `EWSActiveWarning` were undefined.

## GREEN

Implemented the personalized active-warning handler, enriched self-service notification history, and registered `GET /api/v1/ews/me/active-warnings` inside the authenticated `ewsMe` route group.

Focused verification:

```bash
cd apps/api
go test ./internal/http -run 'TestEWSMeActiveWarnings|TestEWSMeNotifications.*LifecycleMetadata' -count=1
```

Result: PASS.

Full verification:

```bash
cd apps/api
go test ./...
```

Result: PASS. `internal/http` passed and all API packages compiled successfully.

## Files

- `apps/api/internal/http/ews_active_warnings.go`
- `apps/api/internal/http/ews_active_warnings_test.go`
- `apps/api/internal/http/ews_me.go`
- `apps/api/cmd/server/main.go`

## Self-Review

- The active-warning SELECT and `rows.Scan` order match exactly.
- SQL JSON arrays decode into matched watch-zone ID and label slices.
- Queries scope warnings and notification history to the resolved authenticated subscriber; active-warning tests assert the bound subscriber ID.
- Default and explicit valid limits are asserted by sqlmock.
- Nullable alert, guidance, source, and notification lifecycle fields are returned as JSON `null`.
- The active-warning response selects structured metadata, geometry, matched zones, and stored guidance only; it does not select or expose raw payload.
- The route is registered inside the `SupabaseAuth`-protected `/api/v1/ews/me` group.

## Concerns

None. The geographic/peril matching SQL follows the production semantics established by Task 4.

## Review Remediation (2026-07-15)

### RED

Added stricter sqlmock query expectations and the opt-in
`TestEWSMeActiveWarningsPostGIS` integration test before changing production SQL.

Focused sqlmock RED:

```bash
cd apps/api
go test ./internal/http -run 'TestEWSMeActiveWarnings|TestEWSMeNotifications.*LifecycleMetadata' -count=1 -v
```

Result: FAIL (exit 1). Both active-warning handler tests returned HTTP 503 because
the existing query's independent `DISTINCT` aggregates, unguarded geometry
predicate, and missing incomplete-alert filters did not match the required SQL
semantics. Both notification-history tests passed their strengthened
`WHERE l.subscriber_id = $1` expectations.

Live PostGIS RED:

```bash
cd apps/api
TEST_DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/sadar_test' \
  go test ./internal/http -run '^TestEWSMeActiveWarningsPostGIS$' -count=1 -v
```

Result: FAIL (exit 1). The real handler returned HTTP 500 with
`row_scan_failed`: `sql: Scan error on column index 5, name "peril_type": converting NULL to string is unsupported`.

### GREEN

The active-warning query now:

- quarantines parseable invalid historical polygons with Task 4's
  `CASE`/`ST_IsValid` guard while retaining the independent point fallback;
- excludes rows whose `peril_type` or `severity` is `NULL`;
- aggregates IDs and labels with the same `ORDER BY z.created_at, z.id`, without
  label deduplication.

Live PostGIS endpoint verification:

```bash
cd apps/api
TEST_DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/sadar_test' \
  go test ./internal/http -run '^TestEWSMeActiveWarningsPostGIS$' -count=1 -v
```

Result: PASS (1 test, package time 0.477s). The isolated-schema fixture covers
two authenticated subscribers, matching and nonmatching zones, current/status/
effective/expiry filters, nullable legacy classification rows, invalid polygon
quarantine, invalid-polygon point fallback, raw payload absence, and ordered
ID/label alignment with duplicate labels.

Focused Task 5 verification:

```bash
cd apps/api
TEST_DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/sadar_test' \
  go test ./internal/http \
  -run 'TestEWSMeActiveWarnings|TestEWSMeNotifications.*LifecycleMetadata' \
  -count=1 -v
```

Result: PASS (5 tests, package time 0.785s).

Full API verification:

```bash
cd apps/api
TEST_DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/sadar_test' \
  go test ./... -count=1
```

Result: PASS. `internal/config` passed in 0.377s, `internal/http` passed in
0.779s, and all no-test packages compiled.

Diff verification:

```bash
git diff --check
```

Result: PASS with no output.

### Review Self-Check

- Subscriber isolation is exercised through `resolveSubscriber` using two
  distinct `auth_user_id` values and disjoint matched-zone arrays.
- A self-intersecting historical polygon without point coordinates is omitted;
  a second self-intersecting polygon is returned only through point fallback,
  without preventing the valid polygon result.
- Future-effective, expired, noncurrent, non-active, missing-peril, and
  missing-severity fixtures are all absent from the exact returned ID list.
- Three matching zones inserted out of order, including tied timestamps and
  duplicate labels, return aligned arrays ordered by `created_at` then `id`.
- Every returned raw response object is asserted not to contain `raw_payload`.
- Sqlmock expectations require active-warning subscriber binding and required
  spatial/filter/aggregation semantics, and require notification history's
  subscriber-scoped `WHERE` clause.
- The impossible `Medium` test severity is now `Moderate`.

### Review Concerns

None. The integration test is intentionally opt-in and skips when
`TEST_DATABASE_URL` is unset; the supplied PostGIS database was used for all
recorded live runs.
