# Task 11 Verification Report

- Date: 2026-07-15 (Asia/Jakarta)
- Worktree: `/Users/pandawa-project/projects/tugure/reinsurance-risk-monitor/.worktrees/bmkg-dashboard-ews`
- Branch: `feat/bmkg-dashboard-ews`
- Base/starting HEAD: `827dceedebdc5b8234b1e9e1be224c26c5fbe3dd`
- Backend/docs review base: `2496760711e2413c13cb38681d50662c070f169e`
- Disposable database: `postgresql://postgres:***@127.0.0.1:55432/sadar_test`
- Public BMKG pages/endpoints called: none
- Production activation or side effects: none

## Automated Suites

- Worker, current full database-backed suite:
  `env TEST_DATABASE_URL=postgresql://postgres:***@127.0.0.1:55432/sadar_test .venv/bin/python -m pytest -q`
  -> `347 passed, 4 warnings in 3.14s` (exit 0). The warnings are the existing
  FastAPI `on_event` deprecations; no database test was skipped.
- Go, current full database-backed suite:
  `env TEST_DATABASE_URL=... go test -count=1 ./...`
  -> all tested packages passed, including `internal/config` and
  `internal/http` (exit 0; packages without tests were reported separately).
- Focused official-source handlers:
  `go test -count=1 ./internal/http -run 'TestOfficialSource(DryRun|Activate|Rollback)' -v`
  -> all current-version dry-run, stale-race rejection, activation, and
  active/disabled rollback tests passed against isolated PostgreSQL schemas.
- Focused CAP worker, persistence, and PostGIS delivery:
  `pytest tests/connectors/test_bmkg_cap.py tests/integration/test_bmkg_cap_cycle_postgres.py tests/integration/test_lifecycle_delivery_postgis.py -q`
  -> `29 passed, 4` existing warnings.
- Web: `npm run test --workspace apps/web`
  -> 9 files passed, 61 tests passed (exit 0).
- Web production build: 1,906 modules transformed, exit 0. Output was
  `index.html` 1.56 kB, CSS 82.25 kB, JS 758.86 kB; the existing >500 kB chunk
  warning remains.
- `npm run verify` -> `Structure verification PASSED` (exit 0).
- Earlier focused air-quality API fixture verification -> 15 Go test/subtest nodes
  passed, covering warning/observation preview separation, strict single JSON,
  recursive redaction, pinned local TLS fixture, forced dry-run after config
  changes, and stale-active-save rejection.

## Migration 040

- Host `psql` was unavailable, so the exact migration file was streamed to
  `psql` inside `sadar-bmkg-postgis`:
  `docker exec -i sadar-bmkg-postgis psql -U postgres -d sadar_test -v ON_ERROR_STOP=1 -f - < db/schema/040_bmkg_warning_and_air_quality.sql`.
- First application: `BEGIN ... COMMIT`, exit 0. Second application:
  `BEGIN ... COMMIT`, exit 0. Existing extension/columns/table/index emitted
  expected `already exists, skipping` notices; trigger and constraints were
  recreated successfully.
- Catalog evidence:
  - `official_alerts`: `peril_type`, `severity`, `category`, `area_name`,
    `latitude`, `longitude`, `source_url` present with expected types.
  - `ews_notification_log.matched_watch_zone_id` UUID FK present.
  - `official_source_settings.expected_interval_seconds` integer, default 600.
  - `air_quality_observations`: all 14 expected columns, unique
    `(source, station_id, pollutant, observed_at)`, category/pollutant/unit/value
    and coordinate checks, `idx_air_quality_latest`, RLS and FORCE RLS enabled.
  - `official_alerts_area_geojson_validation` is a BEFORE INSERT/UPDATE trigger.

## Weather Delivery

- The 9 live PostGIS tests ran in the full suite. Evidence includes polygon and
  point inside -> one delivery each, polygon and point outside -> zero;
  peril/severity/alert-type/disabled-preference exclusions -> zero; repeated
  revision -> one total row; deterministic oldest matching zone; and update,
  cancellation, and expiry retaining the prior recipient and zone.
- CAP fixture tests verify `peril_type=weather`, normalized severity, area name,
  GeoJSON coordinate order, source URL, update/cancel lifecycle identity, and
  missing severity as non-deliverable.
- A disposable DB browser fixture was returned by the live API with source
  `bmkg_cap`, peril `weather`, severity `High`, long `area_name`, active/current
  lifecycle, polygon, and official source URL. `/api/v1/map/overlays` returned
  the same polygon and full BMKG attribution.
- A follow-up worker fix now enforces CAP `dry_run` as a non-persisting
  boundary. The cycle fetches and parses alerts, records item/detail-error
  health, closes the connector, and returns zero before source, evidence,
  official-alert, retention, or delivery writes. Active settings and the
  environment fallback retain their prior persistence behavior.
- A new isolated PostgreSQL cycle test mocks only `BMKGCAPConnector.fetch_active`
  with a local parsed CAP fixture. It uses the real connector construction/close,
  settings resolver,
  connector-health upsert, source persistence, disaster observability, and
  official-alert persistence. The dry-run cycle observed health
  `items_fetched=1` and exact counts `(source_records,
  disaster_observability_events, official_alerts, ews_notification_log) =
  (0,0,0,0)`. After changing the same row to active, the cycle returned one new
  alert and counts became `(1,2,1,0)` with the expected weather metadata.
- Delivery is intentionally disabled in that cycle test, so its delivery
  assertion is limited to proving no accidental queue write. The existing nine
  live PostGIS lifecycle tests remain the database-backed evidence for positive
  delivery matching, deduplication, update, cancel, and expiry behavior.

## Air-Quality Gate

- Live DB row after migration: `enabled=f`, `run_mode=disabled`,
  `mode=custom_api`, `default_api_url=NULL`, `config_version=1`, and no dry-run
  evidence. No official/default endpoint was configured or called.
- Worker focused tests prove: missing/disabled/no-URL settings do no work;
  dry-run parses and updates health without source/alert/observation writes;
  active mode persists both collections but enqueues only warnings; observation
  only payloads never enqueue; categories map to Moderate/High/Critical.
- Direct database-backed handler tests now prove the API gate rather than
  relying on a manual rollback-only SQL probe. API Dry-run records evidence for
  the validated current version, and a concurrent change from version 7 to 8
  returns `stale_config_version`, leaves all `last_dry_run_*` fields null, and
  writes a failed version-7 audit entry. Activate succeeds only when evidence
  matches the current version and rejects stale evidence with
  `successful_current_dry_run_required`.
- Rolling back an historical active version restores its endpoint, mapping,
  adapter, intervals, and encrypted token reference into a new config version,
  but forces `enabled=true, run_mode=dry_run` and clears dry-run evidence.
  Immediate activation is rejected; a fresh successful API Dry-run for the new
  version is required before activation. An historical coherent disabled target
  remains `enabled=false, run_mode=disabled`. Both paths preserve rollback
  history and audit rows inside the existing transaction.

## Browser QA (pre-review evidence)

- Exact isolated service method:
  - API: `DATABASE_URL=postgresql://postgres:***@127.0.0.1:55432/sadar_test API_HOST=127.0.0.1 API_PORT=18081 API_ENV=local CORS_ALLOWED_ORIGINS=http://127.0.0.1:13001 SUPABASE_JWT_SECRET=<local-only> go run ./cmd/server`
  - Web build: `VITE_API_BASE_URL=http://127.0.0.1:18081/api/v1 npm run build --workspace apps/web`
  - Web: `npm run preview --workspace apps/web -- --host 127.0.0.1 --port 13001`
  - Worker was not started, preventing connector/network side effects.
- Read-only HTTP checks passed for `/health`, the built web root, structured
  official alerts, map overlays, and air observations. Air response was
  `data=[]` with `source_active=false`.
- Authenticated visual QA was not safe/available: the repository has only
  Supabase email/password auth and no local magic-link/dev-auth flow. No real
  credentials were used. This session exposed no in-app Browser runtime, and
  `require.resolve('playwright')` failed because Playwright is not installed.
  Therefore viewport screenshots, visual overflow, console-error inspection,
  map-focus clicking, and authenticated EWS browser inspection were not
  performed. The 61-test web suite covers panel tab stability, long content,
  loading/empty/stale/inactive/error states, attribution, map-focus callbacks,
  and `Peringatan Aktif` first; this is automated component evidence, not a
  substitute for the requested visual pass.

## Final Checks

- Backend/docs review verification after implementation:
  - worker: 347 passed, 0 failed, 0 skipped, 4 known warnings;
  - Go: all tested packages passed with `TEST_DATABASE_URL`;
  - focused CAP worker/PostgreSQL/PostGIS: 29 passed;
  - focused official-source handler tests: all current/stale and rollback paths
    passed against isolated PostgreSQL schemas;
  - `npm run verify`: `Structure verification PASSED`;
  - `git diff --check`: exit 0 with no output.
- The web suite/build evidence above is retained from the pre-review Task 11
  run. This backend/docs correction did not modify or re-run web UI files.
- The labeled browser fixture was deleted (`DELETE 1`) and a follow-up count
  returned 0. API port 18081 and web port 13001 were stopped and confirmed not
  listening. No QA server remains running.
- No official/public BMKG endpoint was called, and no production activation or
  credentials were used. The only connector fetch in the new live cycle test
  was the local fixture.
- Documentation commit: `c8a61ad` (`docs: add BMKG warning operations runbook`),
  containing only `docs/bmkg-air-quality.md` and `docs/bmkg-cap-nowcast.md`.

## CAP Dry-Run Fix RED/GREEN Evidence

- RED at base `c8a61ad`: the focused dry-run cycle test failed with
  `assert 1 == 0`, proving `_bmkg_cap_cycle` persisted and counted the parsed
  alert instead of returning before persistence.
- GREEN after the minimal run-mode branch: `pytest
  tests/connectors/test_bmkg_cap.py -q` -> `19 passed, 4 existing warnings`.
  The cycle coverage includes dry-run non-persistence with delivery enabled,
  active persistence/delivery, disabled/no-endpoint boundaries, fetch failure,
  connector close, health item/error counts, and active-compatible environment
  fallback.
- Current database-backed CAP cycle and lifecycle focused verification ->
  `29 passed, 4 existing warnings`. Full worker verification with
  `TEST_DATABASE_URL` -> `347 passed, 4 existing warnings`.

## Browser QA Layout-Shift Fix

- Finding from the live Task 11 browser fixture: at 1024px, switching from a
  long weather warning changed the panel from 230.5px to 109px for inactive air
  quality; at 390px the weather panel was 403px while air quality was much
  shorter. This shifted the KPI/content below the panel.
- Root cause: the inactive `tabpanel` used the HTML `hidden` attribute, which
  removes it from layout. The outer panel therefore matched only the active
  tab's content height.
- Fix: both persistent tabpanels now occupy `col-start-1 row-start-1` in one
  CSS grid container. Their natural content jointly determines the panel height;
  no fixture-specific height was introduced. The inactive panel is
  `aria-hidden`, `invisible`, pointer-blocked, and receives the native `inert`
  attribute through a typed ref. Inactive links are removed from tab order and
  inactive buttons are disabled, while active controls retain their existing
  behavior.
- RED/GREEN component evidence: the new
  `BmkgWarningsPanel.test.tsx` first failed because no shared grid existed, then
  passed after the layout change. It asserts both panels remain in the shared
  grid cell, do not use `hidden`, and that inactive links/buttons are inert and
  not keyboard-focusable. Updated existing panel coverage preserves the
  persistent-panel/loading contract.
- Current verification: `npm run test --workspace apps/web` -> 10 files, 62
  tests passed; `npm run build --workspace apps/web` -> passed (existing >500 kB
  chunk advisory only); `npm run verify` -> passed.
