# Peta Operasi MapLibre Implementation Plan

> **For implementation:** Execute this plan with the `superpowers:subagent-driven-development` skill, completing and reviewing one task at a time.

**Goal:** Replace page-specific Leaflet viewers with a shared MapLibre operational map that exposes public disaster intelligence while preserving authenticated, owner-only watch zones and personal assets.

**Architecture:** The Go API provides bounded WGS84 GeoJSON through dedicated public and authenticated map endpoints. A shared React `OperationalMap` owns MapLibre lifecycle, URL-backed camera state, layers, legend, details, and WebGL fallback. Leaflet remains selectable through a build-time engine flag during release stabilization.

**Technology:** Go/Gin, PostgreSQL with PostGIS, React 18, TypeScript, Vite, MapLibre GL JS, Vitest, Playwright, Docker Compose.

## Guardrails

- Do not add a database migration, standalone tile server, GeoLibre embedding, DuckDB, or Cesium in this release.
- Do not remove Leaflet or React Leaflet until the MapLibre release completes its production stabilization window.
- Never expose `raw_payload`, subscriber data, personal asset data, or private watch zones from public endpoints.
- Public responses have bounded bbox, time, zoom, and feature count. Private responses require authentication and use `Cache-Control: no-store`.
- Geometry is GeoJSON WGS84 using `[longitude, latitude]`.
- Basemap/style URLs are reviewed application constants, never URL parameters or administrator input.
- Existing API endpoints and Leaflet behavior remain unchanged while the engine is `leaflet`.

## Task 1: Define GeoJSON Contract and Query Validation

**Files**

- Create `apps/api/internal/http/operations_map.go`
- Create `apps/api/internal/http/operations_map_test.go`

**Step 1: Add failing parser tests.**

Use a Gin test router to cover valid bbox `106.7,-6.4,107.1,-6.0`, zoom `8`, and `perils=earthquake,flood`. Cover rejection for missing/malformed bbox, inverted values, latitude/longitude outside the world, extent wider than 20 degrees, zoom outside `0..18`, unsupported peril, malformed RFC3339, and event time spans above 72 hours. Assert omitted event times default to the most recent 72 hours and alert/AQ accept one `at` time.

Run:

```bash
go test ./apps/api/internal/http -run 'TestOperationMapQuery' -count=1
```

Expected before implementation: parser and contract imports fail.

**Step 2: Implement wire types and parser.**

Add these types in `operations_map.go`:

```go
type OperationMapFeatureProperties struct {
	ID                 string     `json:"id"`
	Layer              string     `json:"layer"`
	Label              string     `json:"label"`
	PerilType          string     `json:"peril_type,omitempty"`
	Severity           string     `json:"severity,omitempty"`
	Source             string     `json:"source"`
	Attribution        string     `json:"attribution"`
	SourceURL          string     `json:"source_url,omitempty"`
	VerificationStatus string     `json:"verification_status"`
	ObservedAt         *time.Time `json:"observed_at,omitempty"`
	EffectiveAt        *time.Time `json:"effective_at,omitempty"`
	ExpiresAt          *time.Time `json:"expires_at,omitempty"`
	DataVintage        *time.Time `json:"data_vintage,omitempty"`
}

type OperationMapFeature struct {
	Type       string                        `json:"type"`
	ID         string                        `json:"id"`
	Geometry   json.RawMessage               `json:"geometry"`
	Properties OperationMapFeatureProperties `json:"properties"`
}

type OperationMapFeatureCollection struct {
	Type      string                `json:"type"`
	Features  []OperationMapFeature `json:"features"`
	Truncated bool                  `json:"truncated"`
	Layer     string                `json:"layer"`
}
```

Implement `parseOperationMapQuery(c, options)` with normalized UTC timestamps, de-duplicated permitted perils, bbox validation, maximum 20-degree spans, zoom `0..18`, and the 72-hour event window. Add `writePublicOperationMapJSON` with:

```text
Cache-Control: public, max-age=30, s-maxage=60, stale-while-revalidate=60
Vary: Accept-Encoding
```

Add `writePrivateOperationMapJSON` with exact `Cache-Control: no-store`. Neither writer accepts caller-provided headers.

**Step 3: Verify and commit.**

```bash
gofmt -w apps/api/internal/http/operations_map.go apps/api/internal/http/operations_map_test.go
go test ./apps/api/internal/http -run 'TestOperationMapQuery' -count=1
git add apps/api/internal/http/operations_map.go apps/api/internal/http/operations_map_test.go
git commit -m "feat(api): define operational map GeoJSON contract"
```

## Task 2: Add Bounded Public Map Feeds

**Files**

- Modify `apps/api/internal/http/operations_map.go`
- Modify `apps/api/internal/http/operations_map_test.go`
- Modify `apps/api/cmd/server/main.go`

**Step 1: Add failing handler tests using `sqlmock`.**

Test these routes:

```text
GET /api/v1/map/operations/events?bbox=106.7,-6.4,107.1,-6.0&zoom=8
GET /api/v1/map/operations/alerts?bbox=106.7,-6.4,107.1,-6.0&at=2026-08-02T00:00:00Z
GET /api/v1/map/operations/air-quality?bbox=106.7,-6.4,107.1,-6.0
GET /api/v1/map/operations/evacuations?bbox=106.7,-6.4,107.1,-6.0&zoom=8
```

Assert JSON FeatureCollection response, required safe feature properties, point ordering `[longitude, latitude]`, public cache headers, and `truncated: true` when query returns one row above the limit. Assert serialized output contains none of `raw_payload`, subscriber email, personal asset attributes, or database ownership identifiers. SQL expectations require the existing `productionEventSQLPredicate` for events, enabled/active official-source filtering for alerts, and bbox filtering for every layer.

Run:

```bash
go test ./apps/api/internal/http -run 'TestOperationMapPublic' -count=1
```

**Step 2: Implement public handlers.**

Add `OperationMapEvents`, `OperationMapAlerts`, `OperationMapAirQuality`, and `OperationMapEvacuations` methods on `Server`. Keep their queries separate from current `Events`, `OfficialAlerts`, `AirQualityObservations`, and `EvacuationLocations` handlers.

Request one row above these limits and trim before serializing:

| Layer | Maximum |
| --- | ---: |
| events | 2,000 |
| official-alerts | 200 |
| air-quality | 500 |
| evacuations | 2,000 |

Events use the existing production predicate, parsed time window, optional peril filter, bbox, and stable newest-first order. Alerts include active records from enabled sources and only use validated `area_geojson` or valid latitude/longitude. AQ uses only safe fields already exposed by `air_quality.go`. Evacuations use the existing public-visibility predicate and omit capacity/contact/internal notes. Every feature has an explicit source attribution.

**Step 3: Register routes.**

Add to the current public router in `apps/api/cmd/server/main.go`:

```go
publicMap := router.Group("/api/v1/map/operations")
publicMap.GET("/events", server.OperationMapEvents)
publicMap.GET("/alerts", server.OperationMapAlerts)
publicMap.GET("/air-quality", server.OperationMapAirQuality)
publicMap.GET("/evacuations", server.OperationMapEvacuations)
```

Do not alter `/api/v1/map/overlays` or `/api/v1/map/overlays/me`.

**Step 4: Add safe request telemetry.**

Log endpoint, HTTP status, elapsed milliseconds, returned feature count, and truncation state. Do not log bbox, request body, geometry, feature IDs, tokens, or user IDs.

**Step 5: Verify and commit.**

```bash
gofmt -w apps/api/internal/http/operations_map.go apps/api/internal/http/operations_map_test.go apps/api/cmd/server/main.go
go test ./apps/api/internal/http -run 'TestOperationMap' -count=1
go test ./apps/api/... -count=1
git add apps/api/internal/http/operations_map.go apps/api/internal/http/operations_map_test.go apps/api/cmd/server/main.go
git commit -m "feat(api): add bounded public operational map feeds"
```

## Task 3: Add Owner-Only Private Map Feeds

**Files**

- Modify `apps/api/internal/http/operations_map.go`
- Modify `apps/api/internal/http/operations_map_test.go`
- Modify `apps/api/cmd/server/main.go`

**Step 1: Add failing authorization tests.**

Using the same claims setup as `PersonalAssetsList` and `EWSMeWatchZonesList`, prove anonymous access is rejected by current Supabase middleware; a member receives only subscriber-resolved watch zones; a user receives only rows with `auth_user_id = authenticated subject`; other users' rows are absent; cache is exactly `no-store`; and response JSON excludes subscriber email, EWS endpoint, owner IDs, notes, and other unneeded fields.

Run:

```bash
go test ./apps/api/internal/http -run 'TestOperationMapPrivate' -count=1
```

**Step 2: Implement private handlers.**

```go
func (s *Server) OperationMapWatchZones(c *gin.Context)
func (s *Server) OperationMapPersonalAssets(c *gin.Context)
```

`OperationMapWatchZones` calls current `resolveSubscriber`, limits by that subscriber and bbox, and returns only ID, display label, safe visual category, and geometry. `OperationMapPersonalAssets` reads authenticated subject from context and has a mandatory SQL `auth_user_id = $1` predicate plus bbox. Both use Task 1 GeoJSON types with layers `watch-zones` and `personal-assets`.

**Step 3: Register routes using the existing authenticated grouping pattern.**

```go
meMap := router.Group("/api/v1/me/map", SupabaseAuth())
meMap.GET("/watch-zones", server.OperationMapWatchZones)
meMap.GET("/personal-assets", server.OperationMapPersonalAssets)
```

Use the actual middleware constructor in the repository; do not duplicate, bypass, or weaken existing Supabase middleware.

**Step 4: Verify and commit.**

```bash
gofmt -w apps/api/internal/http/operations_map.go apps/api/internal/http/operations_map_test.go apps/api/cmd/server/main.go
go test ./apps/api/internal/http -run 'TestOperationMapPrivate|TestPersonalAssets|TestEWSMeWatchZones' -count=1
go test ./apps/api/... -count=1
git add apps/api/internal/http/operations_map.go apps/api/internal/http/operations_map_test.go apps/api/cmd/server/main.go
git commit -m "feat(api): add private operational map feeds"
```

## Task 4: Add MapLibre, Engine Flag, and Shared Map Foundation

**Files**

- Modify `apps/web/package.json`, `package-lock.json`, `apps/web/src/main.tsx`
- Create `apps/web/src/config/mapEngine.ts`, `apps/web/src/config/mapEngine.test.ts`
- Create `apps/web/src/features/map/types.ts`, `state.ts`, `state.test.ts`, `OperationalMap.tsx`, `OperationalMap.test.tsx`, `styles.css`
- Modify `apps/web/.env.example`, `.env.example`, `apps/web/Dockerfile.web`, `docker-compose.yml`

**Step 1: Write failing web tests.**

Test engine resolution: only `VITE_OPERATIONAL_MAP_ENGINE=maplibre` selects MapLibre; omitted/malformed values select `leaflet`. Test `readMapViewState` and `writeMapViewState` round-trip `mapLng`, `mapLat`, `mapZoom`, `mapLayers`, and `mapTime`; clamp world values; discard unknown layers; and preserve unrelated parameters. Mock MapLibre to assert one map per mount, cleanup on unmount, initial camera from URL, and accessible fallback on construction/WebGL failure.

```bash
npm test --workspace apps/web -- --run src/config/mapEngine.test.ts src/features/map/state.test.ts src/features/map/OperationalMap.test.tsx
```

**Step 2: Add dependency and build-time configuration.**

```bash
npm install maplibre-gl@^5 --workspace apps/web
```

Implement:

```ts
export type OperationalMapEngine = 'leaflet' | 'maplibre';

export function getOperationalMapEngine(value = import.meta.env.VITE_OPERATIONAL_MAP_ENGINE): OperationalMapEngine {
  return value === 'maplibre' ? 'maplibre' : 'leaflet';
}
```

Add `VITE_OPERATIONAL_MAP_ENGINE=leaflet` to both example env files. Declare/pass it as a Docker build argument in `apps/web/Dockerfile.web` and `docker-compose.yml`. Default remains Leaflet.

**Step 3: Implement shared types and URL state.**

In `types.ts`, define public layers `events`, `official-alerts`, `air-quality`, and `evacuations`; private layers `watch-zones` and `personal-assets`; plus a typed FeatureCollection matching Task 1 exactly. Keep one known public layer array and one known private layer array, and parse URL layer values only through these arrays.

**Step 4: Implement `OperationalMap`.**

It owns one `maplibregl.Map` ref, a fixed reviewed base-style URL constant, move-end URL synchronization with `history.replaceState`, source/layer cleanup, a `ResizeObserver`, and a visible state for loading, empty, stale, unavailable, and fallback. Viewer mode includes navigation/geolocation controls; picker mode excludes them. Import bundled MapLibre CSS and local `styles.css` from `main.tsx`. No dynamic stylesheet loading and no untrusted style URL.

**Step 5: Verify and commit.**

```bash
npm test --workspace apps/web -- --run src/config/mapEngine.test.ts src/features/map/state.test.ts src/features/map/OperationalMap.test.tsx
npm run build --workspace apps/web
git add package.json package-lock.json apps/web/package.json apps/web/src/config apps/web/src/features/map apps/web/src/main.tsx apps/web/.env.example .env.example apps/web/Dockerfile.web docker-compose.yml
git commit -m "feat(web): add MapLibre operational map foundation"
```

## Task 5: Implement Public Layers, Legend, and Details

**Files**

- Create `apps/web/src/features/map/mapApi.ts`, `mapApi.test.ts`, `MapLegend.tsx`, `MapDetailSheet.tsx`
- Create `apps/web/src/features/map/layers/events.ts`, `officialAlerts.ts`, `airQuality.ts`, `evacuations.ts`
- Modify `apps/web/src/features/map/OperationalMap.tsx` and `OperationalMap.test.tsx`

**Step 1: Write failing fetch and rendering tests.**

Mock fetch. Verify validated bbox/time/zoom/peril encoding; typed `unavailable` states for non-200 responses; `empty` state for empty data; legend truncation indicator; stale indicator from `data_vintage`; use of current public `request` without bearer token; known-layer toggles only; detail sheet provenance, verification, timestamps, optional source link; and no raw GeoJSON rendering.

```bash
npm test --workspace apps/web -- --run src/features/map/mapApi.test.ts src/features/map/OperationalMap.test.tsx
```

**Step 2: Implement fixed public endpoint mapping and typed result state.**

```ts
const publicMapEndpoints = {
  events: '/map/operations/events',
  'official-alerts': '/map/operations/alerts',
  'air-quality': '/map/operations/air-quality',
  evacuations: '/map/operations/evacuations',
} as const;
```

Return `ready`, `empty`, `stale`, or `unavailable` state. Abort obsolete viewport requests with `AbortController`; only the latest request may update layer state.

**Step 3: Implement deterministic adapters.**

Each adapter exports stable source/layer IDs plus `apply(map, collection)` and `remove(map)`. Events use zoom-aware clusters and peril color. Official alerts use polygon fill/outline and point fallback with severity color. AQ uses category colors plus a non-color cue in details. Evacuations use a fixed safe icon. Refresh via `setData`; never create HTML with `innerHTML`.

**Step 4: Implement compact operational UI.**

`MapLegend` has known-layer toggles, stale state, truncation status, and attribution. `MapDetailSheet` is a desktop side sheet/mobile bottom sheet with icon-only accessible close control, safe text fields, timestamps, attribution, and an optional external link.

**Step 5: Wire adapters into the map and commit.**

On debounced `moveend`, load enabled public layers in parallel. Retain ready data while refresh is in flight. Click handlers select typed source properties and open details.

```bash
npm test --workspace apps/web -- --run src/features/map
npm run build --workspace apps/web
git add apps/web/src/features/map
git commit -m "feat(web): render public operational map layers"
```

## Task 6: Add Private Layers and Existing-Flow Integration

**Files**

- Create `apps/web/src/features/map/layers/private.ts`
- Modify `apps/web/src/features/map/mapApi.ts`, `mapApi.test.ts`
- Modify `apps/web/src/features/executive/ExecutiveOverview.tsx`, `ExecutiveOverview.test.tsx`, `apps/web/src/components/RiskMap.tsx`
- Create `apps/web/src/features/evacuation/MapLibreEvacuationMap.tsx` and `apps/web/src/features/ews/MapLibreWatchZonePicker.tsx`
- Modify `apps/web/src/features/evacuation/EvacuationMap.tsx` and `apps/web/src/features/ews/WatchZoneMapPicker.tsx`

**Step 1: Write failing authenticated frontend tests.**

Verify private endpoints use `authenticatedFetch`; missing session makes no private request/control; logout removes private sources and selection; Executive Overview uses `OperationalMap` only when flag is MapLibre; evacuation and watch-zone picker retain Leaflet for the Leaflet flag; and MapLibre picker emits the existing form's center/radius or geometry value without putting that private draft in URL state.

**Step 2: Implement private client and adapter.**

```ts
const privateMapEndpoints = {
  'watch-zones': '/me/map/watch-zones',
  'personal-assets': '/me/map/personal-assets',
} as const;
```

The private adapter renders subdued distinct outlines/markers and removes all private sources, layers, and click handlers on logout/unmount. Private source IDs must not appear in URL state, local storage, public telemetry, or public layer state.

**Step 3: Integrate by engine flag.**

At the Executive Overview map boundary, preserve current loading/selection behavior. Render current `RiskMap` for Leaflet. Render viewer-mode `OperationalMap` for MapLibre, with public initial layers driven by existing executive filters and private layers enabled only with an authenticated session.

`MapLibreEvacuationMap` uses shared viewer mode with evacuations enabled. `MapLibreWatchZonePicker` uses picker mode and changes only local pending form state. Existing `EvacuationMap.tsx` and `WatchZoneMapPicker.tsx` become narrow flag wrappers; do not change persistence behavior or delete current Leaflet implementation.

**Step 4: Verify and commit.**

```bash
npm test --workspace apps/web -- --run src/features/executive src/features/evacuation src/features/ews src/features/map
npm run build --workspace apps/web
git add apps/web/src/features/map apps/web/src/features/executive apps/web/src/features/evacuation apps/web/src/features/ews apps/web/src/components/RiskMap.tsx
git commit -m "feat(web): add operational map to public and private flows"
```

## Task 7: Browser Tests, CSP Controls, and Rollout Documentation

**Files**

- Create `apps/web/playwright.config.ts`, `apps/web/e2e/operational-map.spec.ts`
- Modify `apps/web/package.json`, `package-lock.json`, `.github/workflows/ci.yml`, `docs/production-security-deployment.md`

**Step 1: Add failing Playwright tests with controlled API fixtures.**

Cover desktop/mobile public map load, legend, selected event attribution; logged-out users making no `/api/v1/me/map/` call; logged-in owner-only features; visible truncation; MapLibre/WebGL failure fallback; and screenshots proving canvas/controls are nonblank and do not overlap mobile navigation. Fixtures must not call BMKG, Supabase, production, or a live basemap.

**Step 2: Add a dedicated browser-test script.**

```json
{
  "test:e2e:map": "playwright test -c playwright.config.ts",
  "test:e2e:map:install": "playwright install --with-deps chromium"
}
```

Configure a deterministic local Vite server, desktop Chromium, mobile Chromium, failure screenshots, and one CI retry.

**Step 3: Add a CI job after web unit/build checks.**

Install the lockfile and Chromium, run `npm run test:e2e:map --workspace apps/web`, and upload reports/screenshots on failure. It receives no production secret.

**Step 4: Document production CSP and rollout.**

In `docs/production-security-deployment.md`, add a MapLibre section specifying approved API/Supabase/basemap style `connect-src` and `img-src` origins, no `script-src` relaxation for bundled MapLibre, actual public CSP inspection, deployment order, rollback order, and metrics to monitor. The external production Caddy configuration is not in this repository; change it only after comparing existing CSP to the documented approved origins and checking `curl -fsSI https://sadarbencana.id/`.

**Step 5: Verify and commit.**

```bash
go test ./apps/api/... -count=1
npm test --workspace apps/web
npm run build --workspace apps/web
npm run test:e2e:map --workspace apps/web
docker compose config --quiet
git add apps/web/playwright.config.ts apps/web/e2e apps/web/package.json package-lock.json .github/workflows/ci.yml docs/production-security-deployment.md
git commit -m "test(web): verify operational map rollout"
```

## Task 8: Staged Deployment and Leaflet Retirement

**Files**

- Production environment file only for initial engine enablement; never commit it.
- Future separate retirement PR: MapLibre-related wrappers, Leaflet dependencies, and legacy tests only after stabilization.

**Step 1: Deploy API first with MapLibre disabled.**

Record current commit/image IDs, deploy approved API, and verify all four public endpoints with a valid bbox. Keep `VITE_OPERATIONAL_MAP_ENGINE=leaflet`.

**Step 2: Enable MapLibre as a web-only release.**

Set `VITE_OPERATIONAL_MAP_ENGINE=maplibre`, rebuild/recreate only web, and verify public desktop/mobile map rendering, anonymous users never request private feeds, authenticated watch zones work, API/worker/Redis/Mastra health remains green, and public CSP allows only reviewed map resources.

**Step 3: Monitor seven consecutive days.**

Leaflet remains until there are no unresolved map 5xx responses, no privacy/authorization reports, no fallback trend requiring action, acceptable latency/truncation, successful desktop/mobile checks after deployments, and visible attribution for every public layer.

**Step 4: Retire Leaflet in a new reviewed pull request.**

Only then remove flag, Leaflet code, dependencies, CSS, and tests after a new production backup and rollback review. Do not combine this deletion with the initial MapLibre rollout.

## Final Review Checklist

- [ ] Public routes validate and bound all input, cap features, order stably, and return safe cache headers.
- [ ] Private routes require existing Supabase authentication, filter by owner in SQL, and return `Cache-Control: no-store`.
- [ ] Map responses exclude raw worker payloads, secrets, subscriber endpoints, and unowned data.
- [ ] Endpoints, style, layers, and source IDs are application constants.
- [ ] Leaflet is the default engine until controlled production enablement.
- [ ] Go, unit, desktop browser, mobile browser, and WebGL fallback tests pass.
- [ ] Docker, API, worker, Mastra, public meta, and CSP checks pass after release.
- [ ] Previous commit and web image are recorded before MapLibre is enabled.
