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
