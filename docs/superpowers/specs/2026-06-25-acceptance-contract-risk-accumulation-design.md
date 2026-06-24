# Acceptance Contract Risk & Cat-Event Accumulation — Design

**Date:** 2026-06-25
**Project:** Reinsurance Risk Monitor (PT Tugure)
**Status:** Approved for planning

## Problem & Goal

The current exposure model (`exposure_rules`) is coarse: it maps region *keywords* to a
single `total_exposure` and `risk_multiplier`. It cannot answer the question an
underwriter actually asks: *"An M6.5 just hit Sulawesi — exactly which of our accepted
risks sit inside the impact radius, and what is our total exposure there?"*

This feature replaces the region-keyword model with a granular, point-level model:
every **acceptance contract** (kontrak akseptasi) carries one geo-located **risk object**
with financial values (premium, sum insured, company share, claim). Each object becomes a
point on the Executive Risk Map. When a Cat event occurs at a location, the system
accumulates exposure of all risk objects within a radius of that point.

Success = an underwriter selects a quake event and within seconds sees the affected
contracts and the accumulated TSI / company share / premium / claim inside the radius,
without opening another tool.

## Decisions (from brainstorming)

1. **Data model:** 1 contract = 1 risk object. A single flat table (`acceptance_contracts`).
2. **Accumulation:** haversine radius from a point. Configurable km radius. No PostGIS
   (Approach A) — bounding-box prefilter on a `(latitude, longitude)` index + precise
   haversine in SQL, isolated in one function so a future PostGIS swap touches one place.
3. **Data input:** full CRUD + CSV import (server-side, `encoding/csv`, no new Go dep) +
   seeded demo data. Excel users "save as CSV".
4. **Attributes:** peril / line of business, contract & cedant identity, period & currency,
   treaty type & occupancy — in addition to premium, TSI, share, claim, lat/long.
5. **Map layer:** new `RISIKO` layer — one point per object, marker size by exposure,
   color by peril, `supercluster` clustering on zoom-out, radius circle + highlight on
   selection, accumulation summary panel.
6. **Relationship to old module:** **replace entirely.** The granular contract module is
   the source of truth; point-based accumulation replaces the region estimate.
7. **Accumulation trigger:** real event click **and** manual what-if pin, both via one
   generic `/accumulation` endpoint. Radius adjustable (slider 10–200 km) + peril filter.
   What-if controls live inside the same Executive Risk Map (no new page).
8. **CSV import mode:** all-or-nothing (one transaction; any invalid row aborts and
   returns per-row errors).

## Architecture — Components Touched

- **DB:** `db/schema/009_acceptance_contracts.sql` (table + indexes),
  `db/schema/010_seed_demo_contracts.sql` (demo data). `exposure_rules` is left in place
  (not dropped — keeps migrations idempotent and harmless), but no longer used by the app.
- **API (Go + Gin):** new `internal/http/contracts.go` (CRUD + import + list) and
  `internal/http/accumulation.go` (accumulation engine). Old `/exposures` &
  `/exposures/match` routes removed from `cmd/server/main.go`; `internal/http/exposures.go`
  deleted.
- **Web (React):** `features/exposures/ExposuresPage.tsx` replaced by
  `features/contracts/ContractsPage.tsx`; `components/RiskMap.tsx` gains the `RISIKO`
  layer + accumulation panel + what-if mode; `features/events/EventsPage.tsx` decoupled
  from `getExposures` and shows point-accumulation summary for the selected event;
  `lib/api/client.ts` gets new types/functions and drops the old ones; `App.tsx` repoints
  the route and nav label.

## Data Model — `acceptance_contracts`

Flat table; 1 row = 1 contract = 1 risk object.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | default `uuid_generate_v4()` |
| `contract_no` | TEXT | policy / contract number; **UNIQUE** (for idempotent seed/import) |
| `cedant_name` | TEXT | ceding insurer |
| `object_name` | TEXT | risk object name |
| `object_address` | TEXT | optional |
| `peril` | TEXT | CHECK in (`earthquake`,`flood`,`volcano`,`fire`,`windstorm`,`other`) |
| `treaty_type` | TEXT | CHECK in (`facultative`,`treaty`) |
| `occupancy` | TEXT | occupancy / construction (optional) |
| `latitude` | DOUBLE PRECISION | NOT NULL; map point |
| `longitude` | DOUBLE PRECISION | NOT NULL |
| `currency` | TEXT | default `IDR` |
| `sum_insured` | NUMERIC(18,2) | TSI 100% |
| `share_pct` | NUMERIC(7,4) | company share in % (0–100) |
| `share_amount` | NUMERIC(18,2) | **company exposure** = `sum_insured * share_pct/100`; stored explicitly, derivable if blank |
| `premium` | NUMERIC(18,2) | premium (share portion) |
| `claim_amount` | NUMERIC(18,2) | default 0; realized claim/exposure |
| `inception_date` | DATE | for active-on-event filter |
| `expiry_date` | DATE | |
| `created_at` | TIMESTAMPTZ | default `now()` |
| `updated_at` | TIMESTAMPTZ | default `now()` |

**Indexes:** `(latitude, longitude)` (bbox prefilter), `peril`, `(inception_date, expiry_date)`,
unique on `contract_no`.

**Exposure convention:** marker size and the headline accumulation number use
`share_amount` (the company's exposure). Accumulation also sums `sum_insured` (100% TSI),
`premium`, `claim_amount`, and contract count.

## API (all under `/api/v1`)

Follows the existing handler-per-file pattern (`func X(db *sql.DB) gin.HandlerFunc`, raw SQL).

### CRUD — `internal/http/contracts.go`

| Method | Path | Description |
|---|---|---|
| `GET` | `/contracts` | List + filter: `peril`, `treaty_type`, `cedant`, `q` (contract_no/object_name), `active_on` (date → active contracts), `bbox` (map viewport, optional), `limit`/`offset`. Default order `share_amount DESC`. |
| `GET` | `/contracts/:id` | Single contract |
| `POST` | `/contracts` | Create. Validate: lat/long present & valid, `peril`/`treaty_type` in enum, monetary ≥ 0, `share_pct` 0–100. `share_amount` derived if blank. |
| `PUT` | `/contracts/:id` | Full update |
| `DELETE` | `/contracts/:id` | Delete |
| `POST` | `/contracts/import` | Multipart `file` (CSV). See below. |
| `GET` | `/contracts/import/template` | Download example CSV (headers + a sample row). |

### CSV import (`POST /contracts/import`)

- Parse with stdlib `encoding/csv` (no new dependency).
- Fixed header row; column names = table field names.
- Per-row validation; insert in **one transaction (all-or-nothing)**. Any invalid row
  aborts the transaction.
- Response: `{ inserted: int, failed: int, errors: [{ row: int, message: string }] }`.

### Accumulation engine — `internal/http/accumulation.go`

`GET /accumulation?lat=&lon=&radius_km=&peril=&active_on=`

Generic — serves both real events and what-if pins.

Algorithm (isolated in one function; swappable to PostGIS later):
1. **Bounding-box prefilter** using the `(latitude, longitude)` index: derive lat/long
   deltas from `radius_km`, `WHERE latitude BETWEEN … AND longitude BETWEEN …`.
2. **Precise haversine** in SQL over the prefiltered rows → `WHERE distance_km <= radius_km`.
3. Optional filters: `peril` (e.g. a flood event accumulates only `flood` contracts) and
   `active_on` (`inception_date <= d AND expiry_date >= d`).
4. Aggregate: `SUM(sum_insured)`, `SUM(share_amount)`, `SUM(premium)`,
   `SUM(claim_amount)`, `COUNT(*)`, plus a `GROUP BY peril` breakdown.

Response:
```
{
  "summary": { "sum_insured", "share_amount", "premium", "claim_amount", "count" },
  "by_peril": [ { "peril", "share_amount", "count" } ],
  "contracts": [ { "id", "object_name", "lat", "lon", "distance_km", "peril",
                   "share_amount", "sum_insured", "premium", "claim_amount" } ]
}
```
`contracts` capped (e.g. top 500 by `share_amount`) for map highlight.

### Event → peril mapping

A small Go helper maps `event_type` (earthquake / wildfire / volcano / flood / …) to the
`peril` enum, parallel to the frontend `eventLabel()`. Used to auto-set the `peril` filter
when accumulating from a real event.

### Routing & cleanup (`cmd/server/main.go`)

Add the routes above; **remove** `GET /exposures` and `GET /exposures/match`; delete
`internal/http/exposures.go`.

## Frontend (React)

### `lib/api/client.ts`

- New types: `AcceptanceContract`, `AccumulationResult`.
- New functions: `getContracts(filters)`, `getContract(id)`, `createContract()`,
  `updateContract()`, `deleteContract()`, `importContracts(file)`,
  `getAccumulation({ lat, lon, radiusKm, peril?, activeOn? })`.
- Remove `getExposures`, `matchExposure`, and the `ExposureRule` type.

### `features/contracts/ContractsPage.tsx` (replaces ExposuresPage)

- **Toolbar:** filters (peril, treaty_type, cedant, search), **+ Kontrak** button,
  **Import CSV** button (+ download-template link).
- **Grid:** desktop table / mobile cards (reuse the old ExposuresPage styling): columns
  contract_no, cedant, object_name, peril badge, treaty_type, TSI, share %, share_amount,
  premium, claim, period. Per-row edit/delete. Pagination.
- **Create/edit form** (drawer or modal): same validation as the API; `share_amount`
  auto-computed from `sum_insured × share_pct` but overridable.
- **Import modal:** choose file → show `{ inserted, failed, errors[] }`; on failure list
  per-row errors so the user can fix and retry.

### `components/RiskMap.tsx` — `RISIKO` layer

- Add `RISIKO` to `LAYER_FILTERS` (toggle + count). When active, fetch
  `getContracts({ bbox })` following the viewport.
- **Clustering** with `supercluster`: one marker per object, marker size scaled by
  `log(share_amount)`, color by peril (reuse `eventColor` palette). Clusters show object
  count; clicking a cluster zooms in.
- **Object popup:** object_name, cedant, peril, TSI, share_amount, premium, claim.
- **Accumulation modes:**
  - *Real event:* when `selectedEvent` is set (existing flow), draw an `L.circle` of the
    chosen radius at the event point, call `/accumulation` (peril auto from `event_type`,
    `active_on` = event date), highlight affected objects.
  - *What-if pin:* a "What-if" toggle → clicking the map drops a pin; show a **radius
    slider (10–200 km)** + peril filter dropdown; recompute on pin/radius/peril change.
  - **Accumulation panel** (overlay, styled like the existing "Map Focus" card): total
    TSI, total share/exposure, premium, claim, contract count, and a per-peril breakdown.
    Clear button.

### `features/events/EventsPage.tsx`

Decouple from `getExposures`. Replace the old region list with a point-accumulation
summary (TSI, share, premium, claim, contract count) from `/accumulation` at the selected
event's point — consistent with the map.

### Dependencies

Add `supercluster` + `@types/supercluster` to `apps/web/package.json`. No frontend CSV
library (parsing is server-side).

## Seed Demo Data (`db/schema/010_seed_demo_contracts.sql`)

- ~40–60 contracts spread realistically across Indonesia: clusters in DKI Jakarta,
  Surabaya, Bandung, Medan, plus points near seismic zones (Sulawesi, West Sumatra,
  Lombok) so a demo quake event produces a meaningful accumulation.
- Mixed peril, treaty_type (fac & treaty), several cedants, varied TSI/share/premium/claim,
  periods covering the current date (active). Idempotent via
  `ON CONFLICT (contract_no) DO NOTHING`.

## Testing

- **Go (priority — accumulation is the core risk):**
  1. Haversine + bounding-box (known distances, radius boundary inclusivity).
  2. `event_type → peril` mapping.
  3. Contract validation (share_pct range, lat/long bounds, enum membership).
  4. CSV import parser — success path and all-or-nothing rollback on an invalid row.
  Follows the existing `ai_briefings_test.go` pattern.
- **Web:** manual smoke against the demo seed; include component tests if a setup exists,
  but server-side accumulation logic is the priority for automated coverage.

## Cleanup Checklist

- Delete `internal/http/exposures.go`; remove `/exposures*` routes from `main.go`.
- Delete `ExposuresPage.tsx`; remove `getExposures` / `matchExposure` / `ExposureRule`
  from `client.ts`; update `App.tsx` (route + nav label "Exposures" → "Kontrak / Risiko")
  and `EventsPage.tsx`.
- Leave `exposure_rules` table in the DB (not dropped).

## Technical Notes

- Large IDR values (trillions): show compact (e.g. `Rp 4,2 T`) in the panel and markers,
  full value in popups/detail.
- The haversine/bbox logic is isolated in a single Go function so migrating to PostGIS
  (`geography` + `ST_DWithin` + GiST) later changes only that function.

## Out of Scope (YAGNI)

- PostGIS / proper geospatial types (Approach B) — future upgrade, isolated.
- Distance/intensity decay weighting and CRESTA-style accumulation zones.
- Excel (.xlsx) parsing — users export to CSV.
- Precomputed/materialized accumulation zones (Approach C).
- Deriving region-level rollups from contracts.
