# Task 10 Report: Add Active BMKG Warnings to EWS

Date: 2026-07-15
Base SHA: `00141a5a8b4b2b4fc6e53b640022a5f808a6e90e`

## Scope

- Added the strict `/ews/me/active-warnings` browser contract, including the
  required `sent_at` field and nullable enriched notification metadata.
- Added Peringatan Aktif as the first authenticated EWS tab with compact
  divided rows, BMKG attribution, lifecycle/category/severity, matched watch
  zones, Indonesian timestamps, curated guidance, and map/source actions.
- Preserved cached warning rows after failed refreshes and marked their state
  as unconfirmed. Initial loading, confirmed empty, initial error, and retry
  states remain distinct.
- Added `weather` and `air_quality` to watch-zone and preference controls, and
  exposed notification headline, peril, lifecycle action, and triggering watch
  zone without changing existing preference/subscription API calls.
- Wired EWS map navigation through the Task 9 `{ id, nonce }` focus request.
  Repeated selection of the same warning creates a new request, while ordinary
  dashboard event selection clears official-warning focus.
- Added `bmkg_cap` and `bmkg_air_quality` to Source Health. Missing official
  connectors receive synthetic inactive rows, while real connector responses
  always take precedence.

## RED

1. `ActiveWarningsTab.test.tsx` first failed because
   `./ActiveWarningsTab` did not exist. After the minimum component was added,
   the focused suite exposed and then pinned metadata structure and strict URL
   behavior. The URL hardening case failed while credential-bearing BMKG URLs
   were still rendered.
2. `EwsPage.test.tsx` failed 4/4 against the original page because the first tab
   was Watch Zones, tab roles were absent, active-warning forwarding and the two
   new perils were absent, and enriched notification metadata was not rendered.
3. `SourceHealthPage.test.ts` failed 3/3 because the BMKG connector list and
   synthesis helper did not exist.
4. `App.test.tsx` failed because EWS received no `onViewOnMap` callback and the
   dashboard received no focus request.
5. `ExecutiveOverview.test.tsx` failed with `none` instead of `warning-1:1`,
   proving that incoming EWS focus was ignored before implementation.

## GREEN

- Focused active-warning suite: 6 passed.
- Focused EWS page suite: 4 passed.
- Focused source-health suite: 3 passed.
- Focused App navigation suite: 1 passed.
- Focused ExecutiveOverview focus/clear suite: 1 passed.
- Full web suite: `8` files, `49` tests passed.
- Web production build: `tsc && vite build` passed. The existing Vite chunk-size
  warning remains informational.
- Repository verification: `npm run verify` passed.
- Whitespace verification: `git diff --check` passed.

## Browser QA

- Ran the Task 10 worktree at `http://127.0.0.1:3002/` because port 3001 was
  already occupied.
- At `1440x900`, Source Health rendered all seven hazard connectors. The real
  `bmkg_cap` response remained visible, while missing `bmkg_air_quality` showed
  `Belum aktif`. No horizontal page overflow was present.
- At `390x844`, all seven hazard rows rendered as mobile cards within the
  viewport, with no horizontal overflow. The EWS login shell also fit without
  overflow.
- Browser console errors: none.
- Authenticated EWS row QA was not performed because the available browser
  origin had no test session; creating a user account was outside this task's
  authorized side effects. Rendering, long metadata, source safety, tabs, and
  interactions are covered by Testing Library.

## Self-review

- Confirmed `EWSActiveWarning.sent_at` is required because the component always
  renders its publication timestamp.
- Confirmed source and guidance links require HTTPS BMKG hostnames and reject
  embedded credentials, nonstandard ports, lookalike domains, malformed URLs,
  and non-HTTPS URLs.
- Confirmed BMKG attribution uses the full required organization name and no
  raw payload or credentials are exposed.
- Confirmed guidance only renders API-provided curated actions and explicitly
  tells users to follow BMKG and local authorities.
- Confirmed active-warning rows do not turn PM2.5 observations into EWS alerts.
- Confirmed accessible tabs expose tablist/tab/tabpanel relationships,
  `aria-selected`, roving tab index, and Arrow/Home/End navigation.
- Confirmed App increments focus nonce on every EWS map action, including repeat
  clicks for one warning. ExecutiveOverview does not reassert a stale parent
  request after an ordinary event selection.
- Confirmed initial empty BMKG dashboard state cannot clear an EWS focus request
  before both official-warning endpoints are confirmed.
- Confirmed synthetic health rows are limited to missing official connectors
  and cannot hide real connector state.
- Reviewed the final diff for unrelated refactors; changes remain within Task 10
  UI/API contracts, tests, and this report.

## Review Remediation (2026-07-15)

### RED

- Added review-regression coverage first. The focused web run failed 13 tests
  across six files: arbitrary official sources leaked into BMKG rows, inactive
  and expired cached warnings remained actionable, truncated dashboard arrays
  cleared valid map overlays, App retained consumed focus, synthesized health
  rows rendered as healthy/stale data, inactive tabpanels were absent, mobile
  connector rows were nested cards, and null metadata/payload contracts were
  not pinned.
- Added backend SQL and response-boundary tests first. The focused Go run failed
  because the query did not restrict official-alert sources and the handler
  returned a fixture with source `other_official`.

### GREEN

- Focused backend active-warning suite passed with a fresh Go cache.
- Focused review web suite passed: `6` files, `27` tests.
- Full backend suite passed: `GOCACHE=/tmp/codex-go-cache-bmkg-dashboard-ews go test ./... -count=1`.
- Full web suite passed: `9` files, `61` tests.
- Web production build passed: `tsc && vite build`; the existing Vite chunk-size
  warning remains informational.
- Repository verification passed: `npm run verify`.
- Whitespace verification passed: `git diff --check`.

### Browser QA

- At `1440x900`, all three desktop source-health tables were visible, mobile
  lists were hidden, `Belum aktif` appeared for both API-synthesized official
  health rows, and document width remained exactly 1440 pixels.
- At `390x844`, desktop tables were hidden and three divided mobile lists were
  visible. Connector rows used the unframed `py-3` treatment, no row exceeded
  the viewport, and document width remained exactly 390 pixels.
- Browser console errors: none.

### Self-review

- BMKG attribution is now enforced at SQL, handler, API parser, and component
  boundaries and is limited to `bmkg_cap` and `bmkg_air_quality`.
- Active warnings are re-evaluated every minute using lifecycle status,
  cancellation message type, and expiry. Cached data follows the same rules
  after a refresh failure, and interval cleanup is covered.
- Dashboard focus resolves against the complete active map overlay collection,
  so a valid warning outside the 20-item source lists remains selectable while
  expired overlays are still rejected.
- App owns and clears consumed or invalid focus state. Repeat clicks receive a
  new nonce, and navigation/remount coverage prevents stale focus resurrection.
- The connector API's zero/null/no-error synthesized signature renders as
  `Belum aktif`; any real health evidence takes precedence.
- All EWS tabpanels remain mounted and hidden when inactive, preserving every
  `aria-controls` target and the existing roving keyboard behavior.
- Mobile connector rows are an unframed divided list inside each category;
  desktop scanning remains table-based.
- All-null notification metadata renders no invented labels. Existing
  weather/air-quality watch-zone and preference save payloads are covered
  without changing their API shape.
- Reviewed the complete remediation diff for unrelated changes; ownership stays
  within Task 10 web/API files, tests, and this report.
