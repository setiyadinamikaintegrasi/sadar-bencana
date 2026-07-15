# Task 8 Report: Expose Latest Air-Quality Observations

## Scope

- Worktree: `/Users/pandawa-project/projects/tugure/reinsurance-risk-monitor/.worktrees/bmkg-dashboard-ews`
- Base SHA: `a3b21eeb7b26c6b648fbec167c02104cc9ffc3ac`
- Branch: `feat/bmkg-dashboard-ews`
- Task files: `apps/api/internal/http/air_quality.go`,
  `apps/api/internal/http/air_quality_test.go`, and
  `apps/api/cmd/server/main.go`.

## Implementation

- Added public `GET /api/v1/air-quality/observations` beside the existing
  public API routes.
- Enforced an allowlisted, single-valued query contract: `source` is empty or
  exactly `bmkg`; `latest` is omitted, `true`, or `false`; and `limit` is
  bounded to 1..50 (default 50). Unknown and duplicate query keys are rejected.
- Implemented latest-per-`station_id`/`pollutant` selection with deterministic
  duplicate resolution, plus bounded history mode.
- Both modes rank the worst air-quality categories first, then order by
  observation time and stable station, pollutant, and ID tiebreakers.
- Computes `stale` in PostgreSQL from twice the configured
  `expected_interval_seconds` for `bmkg_air_quality`.
- Reads `source_active` from `enabled AND run_mode = 'active'`; a missing
  source setting is represented as `false`, not a service failure.
- Selects and serializes only safe observation columns. Neither SQL query nor
  the response type contains `raw_payload`.
- Handles nil database pools, cancelled requests, source-status query errors,
  observation query errors, scan errors, and row-iteration errors.

## TDD Evidence

### RED

After adding the handler/query tests and before adding production code:

```bash
cd apps/api
TEST_DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/sadar_test' \
  go test ./internal/http -run 'TestAirQuality' -count=1
```

Observed expected compilation failures:

```text
undefined: airQualityLimit
undefined: AirQualityObservations
undefined: airQualityLatestQuery
undefined: airQualityHistoryQuery
FAIL github.com/setiyadinamikaintegrasi/sadar-bencana/api/internal/http [build failed]
```

### GREEN

After the minimal handler, queries, and route registration:

```bash
cd apps/api
TEST_DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/sadar_test' \
  go test ./internal/http -run 'TestAirQuality' -count=1
```

Observed result:

```text
ok github.com/setiyadinamikaintegrasi/sadar-bencana/api/internal/http
exit_code=0
```

The focused suite includes an isolated PostgreSQL integration test. It creates
a unique temporary schema, inserts duplicate station observations, validates
latest selection, category ordering, stale calculation, raw-payload omission,
and active-to-inactive source metadata transition, then drops that schema.

## Self-Review

- Confirmed no `raw_payload` projection or response field exists; static query
  tests and handler/integration response tests assert this explicitly.
- Confirmed the source setting remains read-only: this endpoint does not
  enable the default-disabled BMKG air-quality source or initiate ingestion.
- Confirmed PM2.5 observations remain presentation-only; no code path creates
  official alerts or EWS deliveries.
- Confirmed SQL uses request context for both source-status and observation
  calls, and a pre-cancelled request exits before database work.
- Confirmed both queries have bounded parameterized limits and no interpolated
  request values.
- Confirmed `git diff --check` reports no whitespace errors before final
  verification.

## Final Verification

Focused Task 8 handler/query suite:

```text
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/sadar_test \
  go test ./internal/http -run 'TestAirQuality' -count=1
ok github.com/setiyadinamikaintegrasi/sadar-bencana/api/internal/http
exit_code=0
```

Full Go API suite with the same database URL:

```text
go test ./... -count=1
all packages passed; internal/http passed in 0.932s
exit_code=0
```

`git diff --check` completed without output before staging.

## Review Fix Follow-up

### RED

After adding review regressions and before changing production parsing:

```bash
cd apps/api
TEST_DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/sadar_test' \
  go test ./internal/http -run 'TestAirQuality' -count=1
```

Observed expected failures:

```text
--- FAIL: TestAirQualityLimit
    air_quality_test.go:42: airQualityLimit(" ") = (50, true), want (0, false)
--- FAIL: TestAirQualityObservationsRejectsInvalidQueries
    air_quality_test.go:141: ...?limit=%20 status=503 ... source_status_query_failed ...
FAIL
```

This demonstrated that trimmed whitespace was defaulted and malformed/invalid
query input reached the database instead of being rejected as a client error.

### GREEN

After parsing `RawQuery` with `url.ParseQuery` and defaulting only the exact
empty `limit` value:

```bash
cd apps/api
TEST_DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/sadar_test' \
  go test ./internal/http -run 'TestAirQuality' -count=1
```

Observed result:

```text
ok github.com/setiyadinamikaintegrasi/sadar-bencana/api/internal/http 0.774s
exit_code=0
```

### Self-Review

- `url.ParseQuery` rejects malformed semicolon separators and invalid percent
  escapes before unknown-key and duplicate-key validation; parsed values are
  compared exactly, without trimming `source` or `latest`.
- The limit helper defaults only `""`; literal and URL-encoded whitespace now
  return HTTP 400. Tests cover whitespace `source`, `latest`, and `limit`.
- The `latest=false` mock is anchored to a history-only `SELECT o.id` query
  and `ORDER BY CASE o.category`, so the latest CTE cannot satisfy it.
- Nullable public fields are exactly latitude, longitude, and source URL;
  SQL-mock response coverage verifies all serialize as JSON `null` without a
  scan failure.
- The isolated PostgreSQL test deletes `bmkg_air_quality` settings and verifies
  the defined behavior: HTTP 200, `source_active=false`, and no observations
  because stale calculation requires the settings join.
