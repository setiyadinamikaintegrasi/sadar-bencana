# Task 9 Report: Build the Dashboard BMKG Warning Panel

## Scope

- Worktree: `/Users/pandawa-project/projects/tugure/reinsurance-risk-monitor/.worktrees/bmkg-dashboard-ews`
- Base SHA: `e1e8cb3dbf327f07b90fd8a005942c065821b948`
- Branch: `feat/bmkg-dashboard-ews`
- Task ownership: web API contracts, BMKG presentation helpers/tests, dashboard
  panel integration, and RiskMap official-overlay focus.

## Implementation

- Added Vitest, Testing Library, jsdom, and an isolated Vitest config. The
  dedicated config prevents the development-only Vite backend supervisor from
  keeping test runs open.
- Added browser-safe `OfficialAlert` and `AirQualityObservation` contracts plus
  clients for active official warnings and latest BMKG PM2.5 observations. The
  duplicated `sent_at` field from the brief was defined once.
- Added pure helpers for severity/category ordering, Indonesian WIB/WITA/WIT
  formatting, malformed-time fallback, strict HTTPS BMKG source URL
  allowlisting, partial `Promise.allSettled` result unpacking, PM2.5 ordering,
  and official-alert-to-map-overlay conversion.
- Built one compact, divided-row BMKG section directly below the risk map and
  above KPI cards. It includes the Cuaca Ekstrem/Kualitas Udara tablist,
  weather and air-quality official alerts, PM2.5 station rows, stale labels,
  source-inactive notice, safe source links, loading/empty/error states, and a
  retry action. Successful rows remain visible beside endpoint-level errors.
- Added visible and ARIA-labelled severity/category text. All new external
  links use `target="_blank"` with `rel="noopener noreferrer"`, and API-provided
  links render only when they resolve to HTTPS on `bmkg.go.id` or an official
  subdomain.
- Dashboard BMKG loading uses three independent promises with
  `Promise.allSettled`; fulfilled sources update even when a sibling source
  fails, while previous successful state is retained during retries.
- Merged geocoded official alerts into existing map overlays by the shared
  alert ID. RiskMap now focuses selected polygon/MultiPolygon overlays with
  `fitBounds`, point-only official overlays with `flyTo`, renders point
  fallbacks as `CircleMarker`, and preserves the map's fixed dimensions.

## TDD Evidence

### RED 1: Presentation Module

After installing Vitest and writing the initial presentation tests:

```bash
npm run test --workspace apps/web
```

Observed the expected missing-feature failure:

```text
FAIL src/features/executive/bmkgPresentation.test.ts
Error: Cannot find module './bmkgPresentation'
Test Files 1 failed (1)
exit_code=1
```

### GREEN 1: Pure Helpers

After adding API contracts and presentation helpers:

```text
Test Files 1 passed (1)
Tests 13 passed (13)
exit_code=0
```

### RED 2: Panel Component

After adding interaction and state tests before creating the panel:

```text
FAIL src/features/executive/bmkgPresentation.test.ts
Error: Failed to resolve import "./BmkgWarningsPanel"
Test Files 1 failed (1)
exit_code=1
```

### GREEN 2: Panel Component

After implementing the divided-row panel and its states:

```text
Test Files 1 passed (1)
Tests 17 passed (17)
exit_code=0
```

### RED 3: Partial Loading and Map Geometry

Before adding result unpacking and moving polygon conversion to module scope:

```text
2 failed | 17 passed (19)
TypeError: unpackBmkgResults is not a function
TypeError: overlayPolygons is not a function
exit_code=1
```

### GREEN 3: Dashboard and Map Integration

After wiring partial loading, alert-derived overlays, polygon focus, and point
fallbacks:

```text
Test Files 1 passed (1)
Tests 19 passed (19)
exit_code=0
```

### RED/GREEN 4: Category Accessibility Review

Self-review added a regression assertion for official air-alert category ARIA
text. It first failed with:

```text
Unable to find a label with the text of: Kategori kualitas udara Berbahaya
1 failed | 18 passed (19)
exit_code=1
```

After adding the label, the suite returned to 19/19 passing.

## Self-Review

- Confirmed the panel is one section with divider rows and no nested cards;
  every new radius is 8px or less and no decorative gradient/orb was added.
- Confirmed the panel is between the map and KPI grid, and map focus changes
  only Leaflet view state rather than layout dimensions.
- Confirmed official air alerts precede observations and both are sorted by
  operational severity/category and source time without mutating inputs.
- Confirmed source inactivity is informational and does not activate ingestion
  or turn PM2.5 observations into EWS alerts.
- Confirmed raw payloads and credentials are absent from browser contracts.
- Browser QA at 1440x900 and 390x844 found no horizontal overflow or console
  errors. At 390px, document width equalled viewport width (390px), the panel's
  client and scroll widths both measured 356px, and both tab labels fit their
  157px controls. Inactive-source, partial-error, retry, empty, and segmented
  states stacked without overlap.
- Confirmed the visible BMKG attribution is exactly `BMKG (Badan Meteorologi,
  Klimatologi, dan Geofisika)`.

## Final Verification

Web test suite:

```text
npm run test --workspace apps/web
Test Files 1 passed (1)
Tests 19 passed (19)
exit_code=0
```

Production build:

```text
npm run build --workspace apps/web
1904 modules transformed
vite build completed successfully
exit_code=0
```

The build emitted the repository's existing warning for a minified chunk over
500 kB; it did not fail compilation or bundling.

Repository verification:

```text
npm verify
Unknown command: "verify"
```

The npm CLI instructed using the package script form, which passed:

```text
npm run verify
Structure verification PASSED
exit_code=0
```

Whitespace verification:

```text
git diff --check
(no output)
exit_code=0
```

## Review Findings Fix Pass

### Scope and Root Causes

- Replaced the observation source's initial `false` default with a tri-state
  `boolean | null` model. Endpoint status now records whether a successful
  response has ever been observed and whether retained data became uncertain
  after a failed refresh.
- Moved BMKG loading into a single-flight hook with a 60-second clock/reload.
  Timer ticks update local expiry even while a request is already running;
  overlapping reloads share the same promise, and unmounted consumers ignore
  late completions.
- Added local status/`expires_at` filtering in the hook and again at the panel
  render boundary. Expired or cancelled alerts cannot remain in the list, map
  inputs, or focus selection after the local clock advances.
- Replaced selected-ID-only map focus with `{ id, nonce }` requests. Repeated
  clicks refit/refly the map, stable Leaflet layer refs reopen popups, and
  selected polygons and points use visibly stronger styling.
- Completed the tabs as an accessible manual-activation tablist with
  `useId`-derived IDs, persistent hidden tabpanels, roving `tabIndex`, and
  ArrowLeft/ArrowRight/Home/End behavior.
- Added the approved weather-active count, lifecycle text, remaining-time text,
  malformed/missing-time fallbacks, and full wrapping BMKG attribution.

### RED 5: Lifecycle and Loader State

After adding tests for local expiry, remaining-time formatting, initial unknown
source status, cached retry uncertainty, and overlapping timer loads:

```text
Test Files 2 failed (2)
Tests 2 failed | 19 passed
Error: Failed to resolve import "./useBmkgWarnings"
TypeError: filterActiveOfficialAlerts is not a function
TypeError: lifecycleStatusText is not a function
exit_code=1
```

### GREEN 5: Lifecycle and Loader State

After implementing the pure helpers and single-flight hook:

```text
Test Files 2 passed (2)
Tests 24 passed (24)
exit_code=0
```

The hook test cleanup was made explicit after an intermediate timeout revealed
a live interval from the previous test. The cached-retry case then passed both
alone and with the presentation suite.

### RED 6: Panel Review Findings

The panel contract tests failed on the six missing review behaviors while all
previous assertions remained green:

```text
Test Files 1 failed (1)
Tests 6 failed | 20 passed
Missing: active count, unknown source state, cached uncertainty,
local expiry filtering, two persistent tabpanels, wrapping attribution
exit_code=1
```

### GREEN 6: Panel Review Findings

After implementing endpoint-aware empty states, lifecycle presentation,
accessible tabs, and wrapping attribution:

```text
Test Files 1 passed (1)
Tests 26 passed (26)
exit_code=0
```

### RED/GREEN 7: Repeatable Map Focus

Controller tests first failed because the focus, popup, nonce, and selected
style helpers did not exist:

```text
Test Files 1 failed (1)
Tests 3 failed (3)
TypeError: focusOverlay is not a function
TypeError: nextOverlayFocusRequest is not a function
exit_code=1
```

After routing Polygon, MultiPolygon, and point layers through the tested
helpers, the suite passed. A follow-up expiry-gate test first failed with
`isOverlayActiveAt is not a function`, then passed after the map's selected
overlay lookup adopted the local expiry gate:

```text
Test Files 1 passed (1)
Tests 4 passed (4)
exit_code=0
```

### RED/GREEN 8: Cached Inactive Source Truthfulness

Self-review added a regression for a previously confirmed inactive source
whose next observation refresh fails. It first failed because the panel still
rendered `Integrasi kualitas udara BMKG belum aktif` as a current fact. After
separating confirmed from uncertain inactivity, the case passed with
`Status terakhir: integrasi kualitas udara BMKG belum aktif; status terbaru
belum diketahui`.

### Browser QA

- `1440x900`: document/body width `1440`; panel width `1376`, scroll width
  `1374`; no horizontal overflow. Both tabpanels were present with reciprocal
  `aria-controls`/`aria-labelledby` IDs. Attribution used `white-space: normal`.
- `390x844`: document/body width `390`; panel width `358`, scroll width `356`;
  tab controls were `157px` wide with matching scroll widths.
- `320x700`: document/body width `320`; panel width `288`, scroll width `286`.
  Full attribution wrapped to two visible lines (`32px` height), and both tab
  labels fit their `122px x 32px` controls without internal overflow.
- Live ArrowRight interaction moved DOM focus to Kualitas Udara, changed its
  `aria-selected` to `true` and `tabIndex` to `0`, demoted Cuaca Ekstrem to
  `tabIndex=-1`, and exposed the matching tabpanel.
- Browser console error log was empty at the end of QA.

### Fix-Pass Self-Review

- Initial observation failure now shows an error plus unknown source status;
  it never shows the inactive-source notice or a confirmed-empty observation
  state. Only an explicit successful `source_active: false` response is shown
  as confirmed inactive; a retained `false` after refresh failure is labeled
  as last-known and uncertain.
- A failed retry preserves prior rows and source status. Cached official rows
  display `Status aktif belum terkonfirmasi`; cached observations display
  `Data terbaru belum terkonfirmasi`. Empty states require successful,
  non-uncertain endpoint status.
- Status and expiry filtering is applied before counts, rows, overlays, focus
  buttons, and map selection. The local minute clock removes elapsed cached
  alerts even if the refresh fails or remains in flight.
- Periodic and manual reloads are single-flight, preventing overlap and stale
  completion ordering. State updates are also suppressed after unmount.
- Repeated focus requests increment a nonce. Polygon/MultiPolygon bounds and
  point fly-to behavior are covered; stable layer refs reopen popups, and both
  point and polygon selections have distinct radius/weight/color/fill styling.
- Tabs have unique IDs per component instance, both targets remain mounted,
  only the active tab is tabbable, and all required navigation keys are tested.
- The compact divided-row layout remains one panel with no nested cards. The
  full BMKG attribution remains visible and wrapping at narrow widths.

### Fix-Pass Final Verification

```text
npm run test --workspace apps/web
Test Files 3 passed (3)
Tests 34 passed (34)
exit_code=0

npm run build --workspace apps/web
1905 modules transformed
vite build completed successfully
exit_code=0

npm run verify
Structure verification PASSED
exit_code=0

git diff --check
(no output)
exit_code=0
```

The build retained the existing non-fatal warning for a minified chunk over
500 kB.
