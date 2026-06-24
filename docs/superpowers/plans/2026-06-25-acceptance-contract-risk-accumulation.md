# Acceptance Contract Risk & Cat-Event Accumulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the coarse region-keyword exposure model with a granular acceptance-contract model whose geo-located risk objects render on the map and accumulate exposure within a radius of any Cat-event point.

**Architecture:** A single flat Postgres table (`acceptance_contracts`) holds one risk object per contract. A Go/Gin API provides CRUD, CSV import, and a generic `/accumulation` endpoint that does a bounding-box prefilter + precise haversine in SQL (no PostGIS). The React app gets a contract-management page, a new `RISIKO` map layer with `supercluster` clustering, and an accumulation panel driven by either a selected real event or a manual what-if pin.

**Tech Stack:** Go 1.25 + Gin + `database/sql` (pgx stdlib driver), PostgreSQL 16, React 18 + TypeScript + Vite + react-leaflet 4 + Leaflet + Tailwind, `supercluster`.

## Global Constraints

- Go module path: `github.com/setiyadinamikaintegrasi/reinsurance-risk-monitor/api` — import internal packages from this root.
- API handlers live in package `http` under `apps/api/internal/http/`, one file per resource, signature `func Name(db *sql.DB) gin.HandlerFunc`. SQL placeholders are Postgres-style (`$1`, `$2`).
- DB-unavailable contract: when `db == nil`, respond `503` with `{"error":"database_unavailable","message":"the database is not configured"}` (match existing handlers).
- All API routes are under `/api/v1`. Frontend base URL helper is `request<T>(path, init?)` in `apps/web/src/lib/api/client.ts` (already prefixes `/api/v1`).
- Schema files in `db/schema/NNN_*.sql` are idempotent and auto-applied only on first DB init (mounted to `/docker-entrypoint-initdb.d`). For an already-initialized dev DB, apply new migrations manually with `psql`.
- `peril` enum values: `earthquake`, `flood`, `volcano`, `fire`, `windstorm`, `other`. `treaty_type` enum values: `facultative`, `treaty`.
- Exposure convention: headline accumulation number and marker size use `share_amount` (company exposure).
- Currency display: compact for large IDR (e.g. `Rp 4,2 T`) in panel/markers; full value in popups/detail.
- Frontend dark "Bloomberg terminal" aesthetic: reuse existing slate/indigo Tailwind classes and the `eventColor` peril palette from `RiskMap.tsx`.
- Run Go tests with `cd apps/api && go test ./internal/http/ -run <Name> -v`. Build frontend with `cd apps/web && npm run build`.
- Spec: `docs/superpowers/specs/2026-06-25-acceptance-contract-risk-accumulation-design.md`.

---

### Task 1: Database migration — `acceptance_contracts` table

**Files:**
- Create: `db/schema/009_acceptance_contracts.sql`

**Interfaces:**
- Produces: table `acceptance_contracts` with columns and indexes used by all Go tasks.

- [ ] **Step 1: Write the migration**

Create `db/schema/009_acceptance_contracts.sql`:

```sql
-- =============================================================================
-- 009_acceptance_contracts.sql — granular acceptance-contract risk objects
-- Project : Reinsurance Risk Monitor (PT Tugure)
-- Engine  : PostgreSQL 16
-- Notes   : Idempotent. 1 row = 1 acceptance contract = 1 geo-located risk object.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS acceptance_contracts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contract_no     TEXT NOT NULL,
    cedant_name     TEXT NOT NULL DEFAULT '',
    object_name     TEXT NOT NULL DEFAULT '',
    object_address  TEXT NOT NULL DEFAULT '',
    peril           TEXT NOT NULL DEFAULT 'other'
                      CHECK (peril IN ('earthquake','flood','volcano','fire','windstorm','other')),
    treaty_type     TEXT NOT NULL DEFAULT 'facultative'
                      CHECK (treaty_type IN ('facultative','treaty')),
    occupancy       TEXT NOT NULL DEFAULT '',
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'IDR',
    sum_insured     NUMERIC(18,2) NOT NULL DEFAULT 0,
    share_pct       NUMERIC(7,4)  NOT NULL DEFAULT 0,
    share_amount    NUMERIC(18,2) NOT NULL DEFAULT 0,
    premium         NUMERIC(18,2) NOT NULL DEFAULT 0,
    claim_amount    NUMERIC(18,2) NOT NULL DEFAULT 0,
    inception_date  DATE,
    expiry_date     DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_acceptance_contracts_contract_no UNIQUE (contract_no)
);

CREATE INDEX IF NOT EXISTS idx_acceptance_contracts_geo
    ON acceptance_contracts (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_acceptance_contracts_peril
    ON acceptance_contracts (peril);
CREATE INDEX IF NOT EXISTS idx_acceptance_contracts_period
    ON acceptance_contracts (inception_date, expiry_date);

COMMIT;

SELECT 'acceptance_contracts' AS table_name, count(*) AS rows FROM acceptance_contracts;
```

- [ ] **Step 2: Apply and verify against a running dev DB**

Run (adjust connection to your local compose Postgres):
```bash
psql "$DATABASE_URL" -f db/schema/009_acceptance_contracts.sql
```
Expected: ends with a row `acceptance_contracts | 0`. Re-running prints the same (idempotent, no errors).

- [ ] **Step 3: Commit**

```bash
git add db/schema/009_acceptance_contracts.sql
git commit -m "feat(db): add acceptance_contracts table for granular risk objects"
```

---

### Task 2: Database seed — demo contracts

**Files:**
- Create: `db/schema/010_seed_demo_contracts.sql`

**Interfaces:**
- Consumes: `acceptance_contracts` table (Task 1).
- Produces: ~50 demo rows for map/accumulation demos.

- [ ] **Step 1: Write the seed migration**

Create `db/schema/010_seed_demo_contracts.sql`. Include ~50 rows clustered around Jakarta (-6.2,106.8), Surabaya (-7.25,112.75), Bandung (-6.9,107.6), Medan (3.59,98.67), and seismic points near Palu/Sulawesi (-0.9,119.9), Padang/West Sumatra (-0.95,100.35), Lombok (-8.65,116.32). Vary peril, treaty_type, cedant, and amounts; set periods covering today. Idempotent via `ON CONFLICT`. Use this shape (showing the first rows; continue the same pattern to ~50, distributing across the clusters above and the perils):

```sql
BEGIN;

INSERT INTO acceptance_contracts
    (contract_no, cedant_name, object_name, object_address, peril, treaty_type, occupancy,
     latitude, longitude, currency, sum_insured, share_pct, share_amount, premium, claim_amount,
     inception_date, expiry_date)
VALUES
    ('FAC-2026-0001','PT Asuransi Jasa Indonesia','Menara BNI 46','Jl. Jend. Sudirman, Jakarta','earthquake','facultative','office_highrise',
     -6.2088,106.8210,'IDR',1200000000000,15.0000,180000000000,2700000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0002','PT Asuransi Sinar Mas','Grand Indonesia Mall','Jl. M.H. Thamrin, Jakarta','fire','facultative','retail_mall',
     -6.1952,106.8205,'IDR',800000000000,20.0000,160000000000,2400000000,0,'2026-01-01','2026-12-31'),
    ('TRT-2026-0003','PT Asuransi Astra Buana','Kawasan Industri Pulogadung','Jakarta Timur','flood','treaty','industrial',
     -6.1830,106.9000,'IDR',500000000000,25.0000,125000000000,1800000000,5000000000,'2026-01-01','2026-12-31'),
    ('FAC-2026-0004','PT Asuransi Tugu Pratama','Pakuwon Tower','Jl. Embong Malang, Surabaya','earthquake','facultative','office_highrise',
     -7.2650,112.7400,'IDR',650000000000,18.0000,117000000000,1900000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0005','PT Asuransi Wahana Tata','Pabrik Tekstil Bandung','Kab. Bandung','fire','facultative','industrial',
     -6.9175,107.6191,'IDR',300000000000,30.0000,90000000000,1500000000,12000000000,'2026-01-01','2026-12-31'),
    ('FAC-2026-0006','PT Reasuransi Nasional','Hotel Santika Palu','Palu, Sulawesi Tengah','earthquake','facultative','hotel',
     -0.9000,119.9000,'IDR',220000000000,40.0000,88000000000,1700000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0007','PT Asuransi Sinar Mas','Plaza Andalas','Padang, Sumatera Barat','earthquake','facultative','retail_mall',
     -0.9500,100.3500,'IDR',180000000000,35.0000,63000000000,1300000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0008','PT Asuransi Jasa Indonesia','Resort Senggigi','Lombok, NTB','earthquake','facultative','hotel',
     -8.6500,116.3200,'IDR',150000000000,45.0000,67500000000,1400000000,8000000000,'2026-01-01','2026-12-31'),
    ('TRT-2026-0009','PT Asuransi Astra Buana','Gudang Logistik Belawan','Medan, Sumatera Utara','flood','treaty','warehouse',
     3.5900,98.6700,'IDR',400000000000,22.0000,88000000000,1600000000,0,'2026-01-01','2026-12-31'),
    ('FAC-2026-0010','PT Asuransi Central Asia','Apartemen Kemang','Jakarta Selatan','windstorm','facultative','residential_highrise',
     -6.2600,106.8130,'IDR',250000000000,28.0000,70000000000,1200000000,0,'2026-01-01','2026-12-31')
    -- … continue with FAC-2026-0011 … FAC-2026-0050 across the same clusters/perils …
ON CONFLICT (contract_no) DO NOTHING;

COMMIT;

SELECT count(*) AS demo_contracts FROM acceptance_contracts;
```

- [ ] **Step 2: Apply and verify**

```bash
psql "$DATABASE_URL" -f db/schema/010_seed_demo_contracts.sql
```
Expected: final count ≥ 50. Re-running keeps the same count (no duplicates).

- [ ] **Step 3: Commit**

```bash
git add db/schema/010_seed_demo_contracts.sql
git commit -m "feat(db): seed demo acceptance contracts for map and accumulation"
```

---

### Task 3: Go geo + peril helpers (pure functions, TDD)

**Files:**
- Create: `apps/api/internal/http/geo.go`
- Test: `apps/api/internal/http/geo_test.go`

**Interfaces:**
- Produces:
  - `func haversineKm(lat1, lon1, lat2, lon2 float64) float64`
  - `func boundingBox(lat, lon, radiusKm float64) (minLat, maxLat, minLon, maxLon float64)`
  - `func eventTypeToPeril(eventType string) string` (returns a `peril` enum value)

- [ ] **Step 1: Write the failing tests**

Create `apps/api/internal/http/geo_test.go`:

```go
package http

import (
	"math"
	"testing"
)

func TestHaversineKmKnownDistance(t *testing.T) {
	// Jakarta (-6.2088,106.8210) to Bandung (-6.9175,107.6191) ≈ 117 km.
	got := haversineKm(-6.2088, 106.8210, -6.9175, 107.6191)
	if math.Abs(got-117) > 6 {
		t.Fatalf("expected ~117 km, got %.2f", got)
	}
}

func TestHaversineKmZero(t *testing.T) {
	if got := haversineKm(1, 2, 1, 2); got != 0 {
		t.Fatalf("expected 0 for identical points, got %.6f", got)
	}
}

func TestBoundingBoxContainsRadiusEdge(t *testing.T) {
	lat, lon, r := -6.2, 106.8, 50.0
	minLat, maxLat, minLon, maxLon := boundingBox(lat, lon, r)
	if minLat >= lat || maxLat <= lat || minLon >= lon || maxLon <= lon {
		t.Fatalf("box must straddle the center: got %v %v %v %v", minLat, maxLat, minLon, maxLon)
	}
	// A point ~49 km due north must fall inside the box's latitude span.
	northLat := lat + 49.0/111.0
	if northLat > maxLat {
		t.Fatalf("point within radius fell outside box: northLat=%.5f maxLat=%.5f", northLat, maxLat)
	}
}

func TestEventTypeToPeril(t *testing.T) {
	cases := map[string]string{
		"earthquake": "earthquake",
		"quake":      "earthquake",
		"wildfire":   "fire",
		"fire":       "fire",
		"volcano":    "volcano",
		"flood":      "flood",
		"storm":      "windstorm",
		"unknown":    "other",
	}
	for in, want := range cases {
		if got := eventTypeToPeril(in); got != want {
			t.Fatalf("eventTypeToPeril(%q) = %q, want %q", in, got, want)
		}
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && go test ./internal/http/ -run 'Haversine|BoundingBox|EventTypeToPeril' -v`
Expected: FAIL — `undefined: haversineKm` (etc.).

- [ ] **Step 3: Implement the helpers**

Create `apps/api/internal/http/geo.go`:

```go
package http

import (
	"math"
	"strings"
)

const earthRadiusKm = 6371.0

// haversineKm returns the great-circle distance in kilometres between two points.
func haversineKm(lat1, lon1, lat2, lon2 float64) float64 {
	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180
	rLat1 := lat1 * math.Pi / 180
	rLat2 := lat2 * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Sin(dLon/2)*math.Sin(dLon/2)*math.Cos(rLat1)*math.Cos(rLat2)
	return earthRadiusKm * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

// boundingBox returns a lat/lon rectangle that fully contains the radiusKm circle
// around (lat, lon). Used as a cheap index-friendly prefilter before haversine.
func boundingBox(lat, lon, radiusKm float64) (minLat, maxLat, minLon, maxLon float64) {
	latDelta := radiusKm / 111.0 // ~111 km per degree latitude
	cos := math.Cos(lat * math.Pi / 180)
	if cos < 0.01 {
		cos = 0.01 // guard near the poles
	}
	lonDelta := radiusKm / (111.0 * cos)
	return lat - latDelta, lat + latDelta, lon - lonDelta, lon + lonDelta
}

// eventTypeToPeril maps a normalized event_type string to a peril enum value.
func eventTypeToPeril(eventType string) string {
	t := strings.ToLower(strings.TrimSpace(eventType))
	switch {
	case strings.Contains(t, "earthquake") || strings.Contains(t, "quake"):
		return "earthquake"
	case strings.Contains(t, "wildfire") || strings.Contains(t, "fire"):
		return "fire"
	case strings.Contains(t, "volcano"):
		return "volcano"
	case strings.Contains(t, "flood"):
		return "flood"
	case strings.Contains(t, "storm") || strings.Contains(t, "cyclone") || strings.Contains(t, "wind"):
		return "windstorm"
	default:
		return "other"
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && go test ./internal/http/ -run 'Haversine|BoundingBox|EventTypeToPeril' -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/internal/http/geo.go apps/api/internal/http/geo_test.go
git commit -m "feat(api): add haversine, bounding-box, and event-to-peril helpers"
```

---

### Task 4: Contract validation + CSV parsing (pure functions, TDD)

**Files:**
- Create: `apps/api/internal/http/contracts_model.go`
- Test: `apps/api/internal/http/contracts_model_test.go`

**Interfaces:**
- Produces:
  - type `Contract struct { … }` with JSON tags mirroring the DB columns (all fields below).
  - `func (c *Contract) normalizeAndValidate() error` — derives `ShareAmount` if zero, returns a non-nil error on the first violation.
  - `func parseContractsCSV(r io.Reader) ([]Contract, error)` — strict header, returns an error of type `*csvRowError` (with `Row int`) on the first invalid row.
  - type `csvRowError struct { Row int; Message string }` implementing `error`.
  - `var contractCSVHeader = []string{...}` (canonical import column order).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/internal/http/contracts_model_test.go`:

```go
package http

import (
	"errors"
	"strings"
	"testing"
)

func TestNormalizeDerivesShareAmount(t *testing.T) {
	c := Contract{SumInsured: 1000, SharePct: 25, Peril: "fire", TreatyType: "facultative",
		Latitude: -6.2, Longitude: 106.8, ContractNo: "X-1"}
	if err := c.normalizeAndValidate(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if c.ShareAmount != 250 {
		t.Fatalf("expected derived share_amount 250, got %v", c.ShareAmount)
	}
}

func TestValidateRejectsBadEnumAndRanges(t *testing.T) {
	bad := []Contract{
		{ContractNo: "", Peril: "fire", TreatyType: "facultative", Latitude: 0, Longitude: 0},
		{ContractNo: "A", Peril: "meteor", TreatyType: "facultative", Latitude: 0, Longitude: 0},
		{ContractNo: "A", Peril: "fire", TreatyType: "xxx", Latitude: 0, Longitude: 0},
		{ContractNo: "A", Peril: "fire", TreatyType: "treaty", Latitude: 100, Longitude: 0},
		{ContractNo: "A", Peril: "fire", TreatyType: "treaty", Latitude: 0, Longitude: 200},
		{ContractNo: "A", Peril: "fire", TreatyType: "treaty", Latitude: 0, Longitude: 0, SharePct: 150},
	}
	for i, c := range bad {
		if err := c.normalizeAndValidate(); err == nil {
			t.Fatalf("case %d: expected validation error, got nil", i)
		}
	}
}

func TestParseContractsCSVSuccess(t *testing.T) {
	csv := strings.Join(contractCSVHeader, ",") + "\n" +
		"C-1,Cedant A,Object A,Addr,earthquake,facultative,office,-6.2,106.8,IDR,1000,25,0,10,0,2026-01-01,2026-12-31\n"
	got, err := parseContractsCSV(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0].ContractNo != "C-1" || got[0].ShareAmount != 250 {
		t.Fatalf("unexpected parse result: %#v", got)
	}
}

func TestParseContractsCSVRowErrorCarriesRowNumber(t *testing.T) {
	csv := strings.Join(contractCSVHeader, ",") + "\n" +
		"C-1,Cedant A,Object A,Addr,earthquake,facultative,office,-6.2,106.8,IDR,1000,25,0,10,0,2026-01-01,2026-12-31\n" +
		"C-2,Cedant B,Object B,Addr,meteor,facultative,office,-6.2,106.8,IDR,1000,25,0,10,0,2026-01-01,2026-12-31\n"
	_, err := parseContractsCSV(strings.NewReader(csv))
	var rowErr *csvRowError
	if !errors.As(err, &rowErr) {
		t.Fatalf("expected *csvRowError, got %v", err)
	}
	if rowErr.Row != 2 {
		t.Fatalf("expected row 2, got %d", rowErr.Row)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && go test ./internal/http/ -run 'Normalize|Validate|ParseContractsCSV' -v`
Expected: FAIL — undefined `Contract`, `contractCSVHeader`, `parseContractsCSV`, `csvRowError`.

- [ ] **Step 3: Implement the model + parser**

Create `apps/api/internal/http/contracts_model.go`:

```go
package http

import (
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

// Contract mirrors a row of acceptance_contracts.
type Contract struct {
	ID             string  `json:"id"`
	ContractNo     string  `json:"contract_no"`
	CedantName     string  `json:"cedant_name"`
	ObjectName     string  `json:"object_name"`
	ObjectAddress  string  `json:"object_address"`
	Peril          string  `json:"peril"`
	TreatyType     string  `json:"treaty_type"`
	Occupancy      string  `json:"occupancy"`
	Latitude       float64 `json:"latitude"`
	Longitude      float64 `json:"longitude"`
	Currency       string  `json:"currency"`
	SumInsured     float64 `json:"sum_insured"`
	SharePct       float64 `json:"share_pct"`
	ShareAmount    float64 `json:"share_amount"`
	Premium        float64 `json:"premium"`
	ClaimAmount    float64 `json:"claim_amount"`
	InceptionDate  string  `json:"inception_date"` // YYYY-MM-DD or ""
	ExpiryDate     string  `json:"expiry_date"`    // YYYY-MM-DD or ""
	CreatedAt      string  `json:"created_at,omitempty"`
	UpdatedAt      string  `json:"updated_at,omitempty"`
	DistanceKm     float64 `json:"distance_km,omitempty"`
}

var validPerils = map[string]bool{
	"earthquake": true, "flood": true, "volcano": true,
	"fire": true, "windstorm": true, "other": true,
}
var validTreatyTypes = map[string]bool{"facultative": true, "treaty": true}

// contractCSVHeader is the canonical import column order.
var contractCSVHeader = []string{
	"contract_no", "cedant_name", "object_name", "object_address", "peril", "treaty_type",
	"occupancy", "latitude", "longitude", "currency", "sum_insured", "share_pct",
	"share_amount", "premium", "claim_amount", "inception_date", "expiry_date",
}

// normalizeAndValidate fills defaults, derives ShareAmount when zero, and validates.
func (c *Contract) normalizeAndValidate() error {
	c.ContractNo = strings.TrimSpace(c.ContractNo)
	c.Peril = strings.ToLower(strings.TrimSpace(c.Peril))
	c.TreatyType = strings.ToLower(strings.TrimSpace(c.TreatyType))
	if c.Currency == "" {
		c.Currency = "IDR"
	}
	if c.Peril == "" {
		c.Peril = "other"
	}
	if c.TreatyType == "" {
		c.TreatyType = "facultative"
	}
	if c.ContractNo == "" {
		return fmt.Errorf("contract_no is required")
	}
	if !validPerils[c.Peril] {
		return fmt.Errorf("invalid peril %q", c.Peril)
	}
	if !validTreatyTypes[c.TreatyType] {
		return fmt.Errorf("invalid treaty_type %q", c.TreatyType)
	}
	if c.Latitude < -90 || c.Latitude > 90 {
		return fmt.Errorf("latitude out of range: %v", c.Latitude)
	}
	if c.Longitude < -180 || c.Longitude > 180 {
		return fmt.Errorf("longitude out of range: %v", c.Longitude)
	}
	if c.SharePct < 0 || c.SharePct > 100 {
		return fmt.Errorf("share_pct must be 0..100, got %v", c.SharePct)
	}
	for name, v := range map[string]float64{
		"sum_insured": c.SumInsured, "premium": c.Premium, "claim_amount": c.ClaimAmount,
	} {
		if v < 0 {
			return fmt.Errorf("%s must be >= 0", name)
		}
	}
	if c.InceptionDate != "" {
		if _, err := time.Parse("2006-01-02", c.InceptionDate); err != nil {
			return fmt.Errorf("invalid inception_date (want YYYY-MM-DD): %v", err)
		}
	}
	if c.ExpiryDate != "" {
		if _, err := time.Parse("2006-01-02", c.ExpiryDate); err != nil {
			return fmt.Errorf("invalid expiry_date (want YYYY-MM-DD): %v", err)
		}
	}
	if c.ShareAmount == 0 && c.SumInsured > 0 && c.SharePct > 0 {
		c.ShareAmount = c.SumInsured * c.SharePct / 100
	}
	if c.ShareAmount < 0 {
		return fmt.Errorf("share_amount must be >= 0")
	}
	return nil
}

// csvRowError reports the 1-based data row (excluding header) that failed.
type csvRowError struct {
	Row     int
	Message string
}

func (e *csvRowError) Error() string {
	return fmt.Sprintf("row %d: %s", e.Row, e.Message)
}

// parseContractsCSV reads a strict-header CSV and returns validated contracts.
func parseContractsCSV(r io.Reader) ([]Contract, error) {
	reader := csv.NewReader(r)
	reader.FieldsPerRecord = len(contractCSVHeader)
	header, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("cannot read header: %w", err)
	}
	for i, h := range contractCSVHeader {
		if i >= len(header) || strings.TrimSpace(strings.ToLower(header[i])) != h {
			return nil, fmt.Errorf("unexpected header: column %d must be %q", i+1, h)
		}
	}

	var out []Contract
	row := 0
	for {
		rec, err := reader.Read()
		if err == io.EOF {
			break
		}
		row++
		if err != nil {
			return nil, &csvRowError{Row: row, Message: err.Error()}
		}
		c := Contract{
			ContractNo: rec[0], CedantName: rec[1], ObjectName: rec[2], ObjectAddress: rec[3],
			Peril: rec[4], TreatyType: rec[5], Occupancy: rec[6], Currency: rec[9],
			InceptionDate: strings.TrimSpace(rec[15]), ExpiryDate: strings.TrimSpace(rec[16]),
		}
		floats := []struct {
			idx int
			dst *float64
		}{
			{7, &c.Latitude}, {8, &c.Longitude}, {10, &c.SumInsured}, {11, &c.SharePct},
			{12, &c.ShareAmount}, {13, &c.Premium}, {14, &c.ClaimAmount},
		}
		for _, f := range floats {
			s := strings.TrimSpace(rec[f.idx])
			if s == "" {
				continue
			}
			v, perr := strconv.ParseFloat(s, 64)
			if perr != nil {
				return nil, &csvRowError{Row: row, Message: fmt.Sprintf("column %q is not a number: %q", contractCSVHeader[f.idx], rec[f.idx])}
			}
			*f.dst = v
		}
		if verr := c.normalizeAndValidate(); verr != nil {
			return nil, &csvRowError{Row: row, Message: verr.Error()}
		}
		out = append(out, c)
	}
	return out, nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && go test ./internal/http/ -run 'Normalize|Validate|ParseContractsCSV' -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/internal/http/contracts_model.go apps/api/internal/http/contracts_model_test.go
git commit -m "feat(api): add contract model with validation and CSV parser"
```

---

### Task 5: Contracts CRUD + list handlers

**Files:**
- Create: `apps/api/internal/http/contracts.go`

**Interfaces:**
- Consumes: `Contract`, `(*Contract).normalizeAndValidate` (Task 4).
- Produces:
  - `func ContractsList(db *sql.DB) gin.HandlerFunc` → `GET /contracts`
  - `func ContractGet(db *sql.DB) gin.HandlerFunc` → `GET /contracts/:id`
  - `func ContractCreate(db *sql.DB) gin.HandlerFunc` → `POST /contracts`
  - `func ContractUpdate(db *sql.DB) gin.HandlerFunc` → `PUT /contracts/:id`
  - `func ContractDelete(db *sql.DB) gin.HandlerFunc` → `DELETE /contracts/:id`
  - `func scanContract(s interface{ Scan(...any) error }) (Contract, error)` (shared row scanner)
  - `const contractColumns` (shared SELECT column list)

- [ ] **Step 1: Implement the handlers**

Create `apps/api/internal/http/contracts.go`:

```go
package http

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

const contractColumns = `id, contract_no, cedant_name, object_name, object_address, peril,
	treaty_type, occupancy, latitude, longitude, currency, sum_insured, share_pct,
	share_amount, premium, claim_amount,
	COALESCE(to_char(inception_date,'YYYY-MM-DD'),''),
	COALESCE(to_char(expiry_date,'YYYY-MM-DD'),''),
	to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SSOF'),
	to_char(updated_at,'YYYY-MM-DD"T"HH24:MI:SSOF')`

type rowScanner interface{ Scan(...any) error }

func scanContract(s rowScanner) (Contract, error) {
	var c Contract
	err := s.Scan(&c.ID, &c.ContractNo, &c.CedantName, &c.ObjectName, &c.ObjectAddress,
		&c.Peril, &c.TreatyType, &c.Occupancy, &c.Latitude, &c.Longitude, &c.Currency,
		&c.SumInsured, &c.SharePct, &c.ShareAmount, &c.Premium, &c.ClaimAmount,
		&c.InceptionDate, &c.ExpiryDate, &c.CreatedAt, &c.UpdatedAt)
	return c, err
}

func dbDown(c *gin.Context) bool {
	return false
}

// nullableDate converts "" to a NULL-compatible arg, else the date string.
func nullableDate(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func ContractsList(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable", "message": "the database is not configured"})
			return
		}
		var where []string
		var args []any
		add := func(clause string, val any) {
			args = append(args, val)
			where = append(where, strings.Replace(clause, "$$", "$"+strconv.Itoa(len(args)), 1))
		}
		if v := strings.TrimSpace(c.Query("peril")); v != "" {
			add("peril = $$", v)
		}
		if v := strings.TrimSpace(c.Query("treaty_type")); v != "" {
			add("treaty_type = $$", v)
		}
		if v := strings.TrimSpace(c.Query("cedant")); v != "" {
			add("cedant_name ILIKE '%'||$$||'%'", v)
		}
		if v := strings.TrimSpace(c.Query("q")); v != "" {
			args = append(args, v)
			n := strconv.Itoa(len(args))
			where = append(where, "(contract_no ILIKE '%'||$"+n+"||'%' OR object_name ILIKE '%'||$"+n+"||'%')")
		}
		if v := strings.TrimSpace(c.Query("active_on")); v != "" {
			add("(inception_date IS NULL OR inception_date <= $$)", v)
			add("(expiry_date IS NULL OR expiry_date >= $$)", v)
		}
		if v := strings.TrimSpace(c.Query("bbox")); v != "" {
			// bbox = minLon,minLat,maxLon,maxLat
			parts := strings.Split(v, ",")
			if len(parts) == 4 {
				f := func(s string) float64 { x, _ := strconv.ParseFloat(strings.TrimSpace(s), 64); return x }
				add("longitude >= $$", f(parts[0]))
				add("latitude  >= $$", f(parts[1]))
				add("longitude <= $$", f(parts[2]))
				add("latitude  <= $$", f(parts[3]))
			}
		}
		limit := 200
		if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 2000 {
			limit = v
		}
		offset := 0
		if v, err := strconv.Atoi(c.Query("offset")); err == nil && v >= 0 {
			offset = v
		}
		query := "SELECT " + contractColumns + " FROM acceptance_contracts"
		if len(where) > 0 {
			query += " WHERE " + strings.Join(where, " AND ")
		}
		args = append(args, limit, offset)
		query += " ORDER BY share_amount DESC LIMIT $" + strconv.Itoa(len(args)-1) + " OFFSET $" + strconv.Itoa(len(args))

		rows, err := db.QueryContext(c.Request.Context(), query, args...)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		defer rows.Close()
		list := make([]Contract, 0, limit)
		for rows.Next() {
			ct, err := scanContract(rows)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed", "message": err.Error()})
				return
			}
			list = append(list, ct)
		}
		c.JSON(http.StatusOK, gin.H{"data": list, "meta": gin.H{"count": len(list)}})
	}
}

func ContractGet(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable", "message": "the database is not configured"})
			return
		}
		row := db.QueryRowContext(c.Request.Context(),
			"SELECT "+contractColumns+" FROM acceptance_contracts WHERE id = $1", c.Param("id"))
		ct, err := scanContract(row)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "contract not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": ct})
	}
}

const contractInsertSQL = `
INSERT INTO acceptance_contracts
  (contract_no, cedant_name, object_name, object_address, peril, treaty_type, occupancy,
   latitude, longitude, currency, sum_insured, share_pct, share_amount, premium, claim_amount,
   inception_date, expiry_date)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
RETURNING ` + contractColumns

func ContractCreate(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable", "message": "the database is not configured"})
			return
		}
		var in Contract
		if err := c.ShouldBindJSON(&in); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body", "message": err.Error()})
			return
		}
		if err := in.normalizeAndValidate(); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "validation_failed", "message": err.Error()})
			return
		}
		row := db.QueryRowContext(c.Request.Context(), contractInsertSQL,
			in.ContractNo, in.CedantName, in.ObjectName, in.ObjectAddress, in.Peril, in.TreatyType,
			in.Occupancy, in.Latitude, in.Longitude, in.Currency, in.SumInsured, in.SharePct,
			in.ShareAmount, in.Premium, in.ClaimAmount, nullableDate(in.InceptionDate), nullableDate(in.ExpiryDate))
		ct, err := scanContract(row)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "insert_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"data": ct})
	}
}

const contractUpdateSQL = `
UPDATE acceptance_contracts SET
  contract_no=$1, cedant_name=$2, object_name=$3, object_address=$4, peril=$5, treaty_type=$6,
  occupancy=$7, latitude=$8, longitude=$9, currency=$10, sum_insured=$11, share_pct=$12,
  share_amount=$13, premium=$14, claim_amount=$15, inception_date=$16, expiry_date=$17, updated_at=now()
WHERE id=$18
RETURNING ` + contractColumns

func ContractUpdate(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable", "message": "the database is not configured"})
			return
		}
		var in Contract
		if err := c.ShouldBindJSON(&in); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body", "message": err.Error()})
			return
		}
		if err := in.normalizeAndValidate(); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "validation_failed", "message": err.Error()})
			return
		}
		row := db.QueryRowContext(c.Request.Context(), contractUpdateSQL,
			in.ContractNo, in.CedantName, in.ObjectName, in.ObjectAddress, in.Peril, in.TreatyType,
			in.Occupancy, in.Latitude, in.Longitude, in.Currency, in.SumInsured, in.SharePct,
			in.ShareAmount, in.Premium, in.ClaimAmount, nullableDate(in.InceptionDate), nullableDate(in.ExpiryDate),
			c.Param("id"))
		ct, err := scanContract(row)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "contract not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "update_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": ct})
	}
}

func ContractDelete(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable", "message": "the database is not configured"})
			return
		}
		res, err := db.ExecContext(c.Request.Context(),
			"DELETE FROM acceptance_contracts WHERE id = $1", c.Param("id"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "delete_failed", "message": err.Error()})
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "contract not found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"deleted": true}})
	}
}
```

> Note: remove the unused `dbDown` helper before committing if `go vet` flags it; it is not referenced. (Included here only as a reminder not to duplicate the nil-db guard — delete it.)

- [ ] **Step 2: Delete the unused helper and verify it compiles**

Remove the `dbDown` function from the file (it is unused). Then run:
Run: `cd apps/api && go build ./...`
Expected: builds with no errors.

- [ ] **Step 3: Run the existing test suite to confirm nothing broke**

Run: `cd apps/api && go test ./internal/http/ -run 'Normalize|Validate|ParseContractsCSV|Haversine' -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/internal/http/contracts.go
git commit -m "feat(api): add acceptance contract CRUD and list handlers"
```

---

### Task 6: CSV import + template handlers

**Files:**
- Create: `apps/api/internal/http/contracts_import.go`

**Interfaces:**
- Consumes: `parseContractsCSV`, `csvRowError`, `Contract`, `contractCSVHeader`, `contractInsertSQL` is NOT reused (import uses its own batch insert), `nullableDate` (Task 5).
- Produces:
  - `func ContractsImport(db *sql.DB) gin.HandlerFunc` → `POST /contracts/import`
  - `func ContractsImportTemplate() gin.HandlerFunc` → `GET /contracts/import/template`

- [ ] **Step 1: Implement the handlers**

Create `apps/api/internal/http/contracts_import.go`:

```go
package http

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// ContractsImportTemplate returns a CSV with the canonical header and one sample row.
func ContractsImportTemplate() gin.HandlerFunc {
	return func(c *gin.Context) {
		sample := "FAC-2026-9999,PT Contoh Asuransi,Gedung Contoh,Jl. Contoh Jakarta,earthquake,facultative,office_highrise,-6.2088,106.8210,IDR,1000000000,15,150000000,2000000,0,2026-01-01,2026-12-31"
		body := strings.Join(contractCSVHeader, ",") + "\n" + sample + "\n"
		c.Header("Content-Disposition", "attachment; filename=acceptance_contracts_template.csv")
		c.Data(http.StatusOK, "text/csv; charset=utf-8", []byte(body))
	}
}

// ContractsImport ingests a CSV in a single all-or-nothing transaction.
func ContractsImport(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable", "message": "the database is not configured"})
			return
		}
		fileHeader, err := c.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing_file", "message": "multipart field 'file' is required"})
			return
		}
		f, err := fileHeader.Open()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot_open_file", "message": err.Error()})
			return
		}
		defer f.Close()

		contracts, perr := parseContractsCSV(f)
		if perr != nil {
			var rowErr *csvRowError
			if e, ok := perr.(*csvRowError); ok {
				rowErr = e
			}
			resp := gin.H{"error": "parse_failed", "message": perr.Error()}
			if rowErr != nil {
				resp["errors"] = []gin.H{{"row": rowErr.Row, "message": rowErr.Message}}
			}
			c.JSON(http.StatusBadRequest, resp)
			return
		}

		tx, err := db.BeginTx(c.Request.Context(), nil)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "tx_begin_failed", "message": err.Error()})
			return
		}
		stmt, err := tx.PrepareContext(c.Request.Context(), contractInsertSQL)
		if err != nil {
			_ = tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "prepare_failed", "message": err.Error()})
			return
		}
		defer stmt.Close()

		inserted := 0
		for i, ct := range contracts {
			if _, err := stmt.ExecContext(c.Request.Context(),
				ct.ContractNo, ct.CedantName, ct.ObjectName, ct.ObjectAddress, ct.Peril, ct.TreatyType,
				ct.Occupancy, ct.Latitude, ct.Longitude, ct.Currency, ct.SumInsured, ct.SharePct,
				ct.ShareAmount, ct.Premium, ct.ClaimAmount, nullableDate(ct.InceptionDate), nullableDate(ct.ExpiryDate)); err != nil {
				_ = tx.Rollback()
				c.JSON(http.StatusBadRequest, gin.H{
					"error":    "import_failed",
					"message":  "transaction rolled back; no rows inserted",
					"inserted": 0,
					"failed":   len(contracts),
					"errors":   []gin.H{{"row": i + 1, "message": err.Error()}},
				})
				return
			}
			inserted++
		}
		if err := tx.Commit(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "commit_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"inserted": inserted, "failed": 0, "errors": []gin.H{}}})
	}
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/api && go build ./...`
Expected: builds with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/internal/http/contracts_import.go
git commit -m "feat(api): add all-or-nothing CSV import and template download"
```

---

### Task 7: Accumulation engine handler

**Files:**
- Create: `apps/api/internal/http/accumulation.go`

**Interfaces:**
- Consumes: `boundingBox` (Task 3), `contractColumns`/`scanContract` (Task 5), `Contract` (Task 4).
- Produces: `func Accumulation(db *sql.DB) gin.HandlerFunc` → `GET /accumulation`.
- Response JSON shape:
  ```
  { "data": {
      "summary": {"sum_insured","share_amount","premium","claim_amount","count"},
      "by_peril": [{"peril","share_amount","count"}],
      "contracts": [ Contract with distance_km ],
      "params": {"lat","lon","radius_km","peril","active_on"} } }
  ```

- [ ] **Step 1: Implement the handler**

Create `apps/api/internal/http/accumulation.go`:

```go
package http

import (
	"database/sql"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

func Accumulation(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable", "message": "the database is not configured"})
			return
		}
		lat, errLat := strconv.ParseFloat(c.Query("lat"), 64)
		lon, errLon := strconv.ParseFloat(c.Query("lon"), 64)
		radius, errR := strconv.ParseFloat(c.Query("radius_km"), 64)
		if errLat != nil || errLon != nil || errR != nil || radius <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_params", "message": "lat, lon, and positive radius_km are required"})
			return
		}
		peril := strings.ToLower(strings.TrimSpace(c.Query("peril")))
		activeOn := strings.TrimSpace(c.Query("active_on"))

		minLat, maxLat, minLon, maxLon := boundingBox(lat, lon, radius)

		// Bounding-box prefilter (index-friendly) + optional filters; precise
		// haversine is applied in Go over the small candidate set.
		where := []string{"latitude BETWEEN $1 AND $2", "longitude BETWEEN $3 AND $4"}
		args := []any{minLat, maxLat, minLon, maxLon}
		if peril != "" {
			args = append(args, peril)
			where = append(where, "peril = $"+strconv.Itoa(len(args)))
		}
		if activeOn != "" {
			args = append(args, activeOn)
			n := strconv.Itoa(len(args))
			where = append(where, "(inception_date IS NULL OR inception_date <= $"+n+")")
			where = append(where, "(expiry_date IS NULL OR expiry_date >= $"+n+")")
		}
		query := "SELECT " + contractColumns + " FROM acceptance_contracts WHERE " + strings.Join(where, " AND ")

		rows, err := db.QueryContext(c.Request.Context(), query, args...)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		defer rows.Close()

		var affected []Contract
		var sumInsured, shareAmount, premium, claim float64
		byPeril := map[string]struct {
			share float64
			count int
		}{}
		for rows.Next() {
			ct, err := scanContract(rows)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed", "message": err.Error()})
				return
			}
			d := haversineKm(lat, lon, ct.Latitude, ct.Longitude)
			if d > radius {
				continue
			}
			ct.DistanceKm = d
			affected = append(affected, ct)
			sumInsured += ct.SumInsured
			shareAmount += ct.ShareAmount
			premium += ct.Premium
			claim += ct.ClaimAmount
			agg := byPeril[ct.Peril]
			agg.share += ct.ShareAmount
			agg.count++
			byPeril[ct.Peril] = agg
		}

		sort.Slice(affected, func(i, j int) bool { return affected[i].ShareAmount > affected[j].ShareAmount })
		if len(affected) > 500 {
			affected = affected[:500]
		}
		perilList := make([]gin.H, 0, len(byPeril))
		for p, v := range byPeril {
			perilList = append(perilList, gin.H{"peril": p, "share_amount": v.share, "count": v.count})
		}
		sort.Slice(perilList, func(i, j int) bool {
			return perilList[i]["share_amount"].(float64) > perilList[j]["share_amount"].(float64)
		})

		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"summary": gin.H{
				"sum_insured": sumInsured, "share_amount": shareAmount,
				"premium": premium, "claim_amount": claim, "count": len(affected),
			},
			"by_peril":  perilList,
			"contracts": affected,
			"params": gin.H{
				"lat": lat, "lon": lon, "radius_km": radius, "peril": peril, "active_on": activeOn,
			},
		}})
	}
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/api && go build ./...`
Expected: builds with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/internal/http/accumulation.go
git commit -m "feat(api): add radius-based exposure accumulation endpoint"
```

---

### Task 8: Wire routes, remove old exposure module

**Files:**
- Modify: `apps/api/cmd/server/main.go:51-52`
- Delete: `apps/api/internal/http/exposures.go`

**Interfaces:**
- Consumes: all handlers from Tasks 5–7.

- [ ] **Step 1: Replace exposure routes with contract + accumulation routes**

In `apps/api/cmd/server/main.go`, delete these two lines:

```go
	router.GET("/api/v1/exposures", apihttp.Exposures(dbPool))
	router.GET("/api/v1/exposures/match", apihttp.ExposureMatch(dbPool))
```

Insert in their place:

```go
	router.GET("/api/v1/contracts", apihttp.ContractsList(dbPool))
	router.GET("/api/v1/contracts/import/template", apihttp.ContractsImportTemplate())
	router.POST("/api/v1/contracts/import", apihttp.ContractsImport(dbPool))
	router.GET("/api/v1/contracts/:id", apihttp.ContractGet(dbPool))
	router.POST("/api/v1/contracts", apihttp.ContractCreate(dbPool))
	router.PUT("/api/v1/contracts/:id", apihttp.ContractUpdate(dbPool))
	router.DELETE("/api/v1/contracts/:id", apihttp.ContractDelete(dbPool))
	router.GET("/api/v1/accumulation", apihttp.Accumulation(dbPool))
```

> Gin route ordering: register the static `/contracts/import/template` and `/contracts/import` paths before `/contracts/:id` is fine because they are distinct path segments; gin's tree handles this. Keep the order above.

- [ ] **Step 2: Delete the old handler file**

```bash
git rm apps/api/internal/http/exposures.go
```

- [ ] **Step 3: Verify it builds and tests pass**

Run: `cd apps/api && go build ./... && go test ./internal/http/ -v`
Expected: builds; all unit tests PASS; no references to `Exposures`/`ExposureMatch` remain.

- [ ] **Step 4: Manual smoke against the dev DB (seeded)**

Start the API (per repo `start.sh` or your usual command) and run:
```bash
curl -s "http://localhost:8080/api/v1/contracts?limit=3" | head
curl -s "http://localhost:8080/api/v1/accumulation?lat=-0.9&lon=119.9&radius_km=100&peril=earthquake" | head
```
Expected: first returns demo contracts; second returns a non-zero `summary.count` (Palu cluster).

- [ ] **Step 5: Commit**

```bash
git add apps/api/cmd/server/main.go
git commit -m "feat(api): wire contract/accumulation routes and remove exposure module"
```

---

### Task 9: Frontend API client — types & functions

**Files:**
- Modify: `apps/web/src/lib/api/client.ts`

**Interfaces:**
- Produces (exports):
  - `type AcceptanceContract` (camel-free, snake_case fields matching API JSON).
  - `type AccumulationSummary`, `type AccumulationByPeril`, `type AccumulationResult`.
  - `getContracts(params?: ContractFilters): Promise<{ data: AcceptanceContract[] }>`
  - `getContract(id): Promise<{ data: AcceptanceContract }>`
  - `createContract(body): Promise<{ data: AcceptanceContract }>`
  - `updateContract(id, body): Promise<{ data: AcceptanceContract }>`
  - `deleteContract(id): Promise<void>`
  - `importContracts(file: File): Promise<ImportResult>`
  - `getAccumulation(p): Promise<{ data: AccumulationResult }>`
- Removes: `getExposures`, `matchExposure`, `ExposureRule`, `ExposuresResponse`, `ExposureMatch`, `ExposureMatchResponse`.

- [ ] **Step 1: Remove the old exposure exports**

In `apps/web/src/lib/api/client.ts`, delete the `ExposureRule`, `ExposuresResponse`, `getExposures`, `ExposureMatch`, `ExposureMatchResponse`, and `matchExposure` declarations (lines around 115–146).

- [ ] **Step 2: Add the new types and functions**

Append to `apps/web/src/lib/api/client.ts`:

```ts
export type AcceptanceContract = {
  id: string
  contract_no: string
  cedant_name: string
  object_name: string
  object_address: string
  peril: 'earthquake' | 'flood' | 'volcano' | 'fire' | 'windstorm' | 'other'
  treaty_type: 'facultative' | 'treaty'
  occupancy: string
  latitude: number
  longitude: number
  currency: string
  sum_insured: number
  share_pct: number
  share_amount: number
  premium: number
  claim_amount: number
  inception_date: string
  expiry_date: string
  created_at?: string
  updated_at?: string
  distance_km?: number
}

export type ContractFilters = {
  peril?: string
  treaty_type?: string
  cedant?: string
  q?: string
  active_on?: string
  bbox?: string
  limit?: number
  offset?: number
}

export async function getContracts(
  params: ContractFilters = {},
): Promise<{ data: AcceptanceContract[]; meta: { count: number } }> {
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && `${v}` !== '') qs.set(k, `${v}`)
  })
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return request(`/contracts${suffix}`)
}

export async function getContract(id: string): Promise<{ data: AcceptanceContract }> {
  return request(`/contracts/${id}`)
}

export async function createContract(
  body: Partial<AcceptanceContract>,
): Promise<{ data: AcceptanceContract }> {
  return request('/contracts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function updateContract(
  id: string,
  body: Partial<AcceptanceContract>,
): Promise<{ data: AcceptanceContract }> {
  return request(`/contracts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function deleteContract(id: string): Promise<void> {
  await request(`/contracts/${id}`, { method: 'DELETE' })
}

export type ImportResult = {
  data?: { inserted: number; failed: number; errors: { row: number; message: string }[] }
  error?: string
  message?: string
  errors?: { row: number; message: string }[]
}

export async function importContracts(file: File): Promise<ImportResult> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`${BASE_URL}/contracts/import`, { method: 'POST', body: fd })
  return (await res.json()) as ImportResult
}

export type AccumulationSummary = {
  sum_insured: number
  share_amount: number
  premium: number
  claim_amount: number
  count: number
}
export type AccumulationByPeril = { peril: string; share_amount: number; count: number }
export type AccumulationResult = {
  summary: AccumulationSummary
  by_peril: AccumulationByPeril[]
  contracts: AcceptanceContract[]
  params: { lat: number; lon: number; radius_km: number; peril: string; active_on: string }
}

export async function getAccumulation(p: {
  lat: number
  lon: number
  radiusKm: number
  peril?: string
  activeOn?: string
}): Promise<{ data: AccumulationResult }> {
  const qs = new URLSearchParams({
    lat: `${p.lat}`,
    lon: `${p.lon}`,
    radius_km: `${p.radiusKm}`,
  })
  if (p.peril) qs.set('peril', p.peril)
  if (p.activeOn) qs.set('active_on', p.activeOn)
  return request(`/accumulation?${qs.toString()}`)
}
```

- [ ] **Step 3: Verify the client still type-checks (will fail at consumers — expected)**

Run: `cd apps/web && npx tsc --noEmit`
Expected: errors ONLY in `ExposuresPage.tsx` and `EventsPage.tsx` (they still import removed symbols). These are fixed in Tasks 10–14. No errors inside `client.ts` itself.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api/client.ts
git commit -m "feat(web): add contract + accumulation API client, remove exposure client"
```

---

### Task 10: Contracts page — list, filters, delete

**Files:**
- Create: `apps/web/src/features/contracts/ContractsPage.tsx`
- Create: `apps/web/src/features/contracts/format.ts`

**Interfaces:**
- Consumes: `getContracts`, `deleteContract`, `AcceptanceContract`, `ContractFilters` (Task 9).
- Produces:
  - `format.ts`: `export function formatIDRCompact(value: number, currency?: string): string` and `export function formatCurrencyFull(value: number, currency: string): string` and `export const PERIL_LABELS: Record<string,string>`.
  - `ContractsPage` default export (the page shell + grid + filters; create/edit/import wired in Task 11 via local state hooks defined here).

- [ ] **Step 1: Create formatting helpers**

Create `apps/web/src/features/contracts/format.ts`:

```ts
export const PERIL_LABELS: Record<string, string> = {
  earthquake: 'Gempa',
  flood: 'Banjir',
  volcano: 'Vulkanik',
  fire: 'Kebakaran',
  windstorm: 'Angin Topan',
  other: 'Lainnya',
}

export const PERIL_COLORS: Record<string, string> = {
  earthquake: '#f97316',
  flood: '#38bdf8',
  volcano: '#ef4444',
  fire: '#fb7185',
  windstorm: '#a78bfa',
  other: '#94a3b8',
}

export function formatCurrencyFull(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: currency || 'IDR',
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${currency} ${value.toLocaleString('id-ID')}`
  }
}

// Compact IDR: 4_200_000_000_000 -> "Rp 4,2 T"
export function formatIDRCompact(value: number, currency = 'IDR'): string {
  const sym = currency === 'IDR' ? 'Rp ' : `${currency} `
  const abs = Math.abs(value)
  const fmt = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 1 })
  if (abs >= 1e12) return `${sym}${fmt(value / 1e12)} T`
  if (abs >= 1e9) return `${sym}${fmt(value / 1e9)} M`
  if (abs >= 1e6) return `${sym}${fmt(value / 1e6)} jt`
  return `${sym}${value.toLocaleString('id-ID')}`
}
```

- [ ] **Step 2: Create the page with list + filters + delete**

Create `apps/web/src/features/contracts/ContractsPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import {
  getContracts,
  deleteContract,
  type AcceptanceContract,
  type ContractFilters,
} from '../../lib/api/client'
import { PERIL_LABELS, formatIDRCompact } from './format'

const PERIL_OPTIONS = ['', 'earthquake', 'flood', 'volcano', 'fire', 'windstorm', 'other']

export default function ContractsPage() {
  const [rows, setRows] = useState<AcceptanceContract[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<ContractFilters>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getContracts({ ...filters, limit: 500 })
      setRows(res.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat kontrak.')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    void load()
  }, [load])

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm('Hapus kontrak ini?')) return
      await deleteContract(id)
      void load()
    },
    [load],
  )

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-2xl font-semibold text-slate-50">Kontrak Akseptasi</h3>
            <p className="mt-2 text-sm text-slate-400">
              Portofolio objek risiko per kontrak akseptasi — premi, TSI, share, dan klaim.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300 ring-1 ring-inset ring-slate-700">
              {rows.length} kontrak
            </span>
            {/* Create + Import buttons are added in Task 11 */}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <select
            value={filters.peril ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, peril: e.target.value || undefined }))}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
          >
            {PERIL_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p === '' ? 'Semua peril' : PERIL_LABELS[p]}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Cari no. kontrak / objek…"
            value={filters.q ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value || undefined }))}
            className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />
        </div>
      </section>

      {loading ? (
        <p className="px-2 text-sm text-slate-400">Memuat…</p>
      ) : error ? (
        <p className="px-2 text-sm text-rose-300">{error}</p>
      ) : (
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-6">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
              <thead>
                <tr className="text-slate-400">
                  <th className="pb-3 pr-4 font-medium">No. Kontrak</th>
                  <th className="pb-3 pr-4 font-medium">Objek / Cedant</th>
                  <th className="pb-3 pr-4 font-medium">Peril</th>
                  <th className="pb-3 pr-4 font-medium">TSI</th>
                  <th className="pb-3 pr-4 font-medium">Share</th>
                  <th className="pb-3 pr-4 font-medium">Premi</th>
                  <th className="pb-3 pr-4 font-medium">Klaim</th>
                  <th className="pb-3 font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map((r) => (
                  <tr key={r.id} className="text-slate-200">
                    <td className="py-3 pr-4 font-medium text-slate-100">{r.contract_no}</td>
                    <td className="py-3 pr-4">
                      <p className="text-slate-100">{r.object_name}</p>
                      <p className="text-xs text-slate-500">{r.cedant_name}</p>
                    </td>
                    <td className="py-3 pr-4">{PERIL_LABELS[r.peril]}</td>
                    <td className="py-3 pr-4">{formatIDRCompact(r.sum_insured, r.currency)}</td>
                    <td className="py-3 pr-4">
                      {formatIDRCompact(r.share_amount, r.currency)}
                      <span className="ml-1 text-xs text-slate-500">({r.share_pct}%)</span>
                    </td>
                    <td className="py-3 pr-4">{formatIDRCompact(r.premium, r.currency)}</td>
                    <td className="py-3 pr-4">{formatIDRCompact(r.claim_amount, r.currency)}</td>
                    <td className="py-3">
                      <button
                        type="button"
                        onClick={() => handleDelete(r.id)}
                        className="text-xs font-semibold text-rose-300 hover:text-rose-200"
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors in `ContractsPage.tsx`/`format.ts` (errors may still exist in `ExposuresPage.tsx`/`EventsPage.tsx`, fixed later).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/contracts/ContractsPage.tsx apps/web/src/features/contracts/format.ts
git commit -m "feat(web): add contracts page with list, filters, and delete"
```

---

### Task 11: Contracts page — create/edit form + CSV import

**Files:**
- Modify: `apps/web/src/features/contracts/ContractsPage.tsx`
- Create: `apps/web/src/features/contracts/ContractFormModal.tsx`
- Create: `apps/web/src/features/contracts/ImportModal.tsx`

**Interfaces:**
- Consumes: `createContract`, `updateContract`, `importContracts` (Task 9); `PERIL_LABELS` (Task 10).
- Produces:
  - `ContractFormModal` props `{ initial?: AcceptanceContract; onClose(): void; onSaved(): void }`.
  - `ImportModal` props `{ onClose(): void; onImported(): void }`.

- [ ] **Step 1: Create the form modal**

Create `apps/web/src/features/contracts/ContractFormModal.tsx`:

```tsx
import { useState } from 'react'
import {
  createContract,
  updateContract,
  type AcceptanceContract,
} from '../../lib/api/client'
import { PERIL_LABELS } from './format'

type Props = {
  initial?: AcceptanceContract
  onClose: () => void
  onSaved: () => void
}

const PERILS = ['earthquake', 'flood', 'volcano', 'fire', 'windstorm', 'other'] as const

const NUMERIC_FIELDS = [
  'latitude', 'longitude', 'sum_insured', 'share_pct', 'share_amount', 'premium', 'claim_amount',
] as const

export default function ContractFormModal({ initial, onClose, onSaved }: Props) {
  const [form, setForm] = useState<Partial<AcceptanceContract>>(
    initial ?? { peril: 'earthquake', treaty_type: 'facultative', currency: 'IDR' },
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof AcceptanceContract, v: string) => {
    const numeric = (NUMERIC_FIELDS as readonly string[]).includes(k)
    setForm((f) => ({ ...f, [k]: numeric ? Number(v) : v }))
  }

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      // Auto-derive share_amount if left blank.
      const body = { ...form }
      if (!body.share_amount && body.sum_insured && body.share_pct) {
        body.share_amount = (body.sum_insured * body.share_pct) / 100
      }
      if (initial) await updateContract(initial.id, body)
      else await createContract(body)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan.')
    } finally {
      setSaving(false)
    }
  }

  const field = (label: string, key: keyof AcceptanceContract, type = 'text') => (
    <label className="flex flex-col gap-1 text-xs text-slate-400">
      {label}
      <input
        type={type}
        value={(form[key] as string | number | undefined) ?? ''}
        onChange={(e) => set(key, e.target.value)}
        className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
      />
    </label>
  )

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/70 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6">
        <h3 className="text-lg font-semibold text-slate-50">
          {initial ? 'Edit Kontrak' : 'Tambah Kontrak'}
        </h3>
        {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}
        <div className="mt-4 grid grid-cols-2 gap-3">
          {field('No. Kontrak', 'contract_no')}
          {field('Cedant', 'cedant_name')}
          {field('Nama Objek', 'object_name')}
          {field('Alamat', 'object_address')}
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Peril
            <select
              value={form.peril ?? 'earthquake'}
              onChange={(e) => set('peril', e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
            >
              {PERILS.map((p) => (
                <option key={p} value={p}>{PERIL_LABELS[p]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Tipe Treaty
            <select
              value={form.treaty_type ?? 'facultative'}
              onChange={(e) => set('treaty_type', e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
            >
              <option value="facultative">Facultative</option>
              <option value="treaty">Treaty</option>
            </select>
          </label>
          {field('Occupancy', 'occupancy')}
          {field('Currency', 'currency')}
          {field('Latitude', 'latitude', 'number')}
          {field('Longitude', 'longitude', 'number')}
          {field('Sum Insured (TSI)', 'sum_insured', 'number')}
          {field('Share %', 'share_pct', 'number')}
          {field('Share Amount', 'share_amount', 'number')}
          {field('Premi', 'premium', 'number')}
          {field('Klaim', 'claim_amount', 'number')}
          {field('Inception (YYYY-MM-DD)', 'inception_date')}
          {field('Expiry (YYYY-MM-DD)', 'expiry_date')}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300">
            Batal
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="rounded-xl border border-indigo-400 bg-indigo-500/20 px-4 py-2 text-sm font-semibold text-indigo-200 disabled:opacity-60"
          >
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the import modal**

Create `apps/web/src/features/contracts/ImportModal.tsx`:

```tsx
import { useState } from 'react'
import { importContracts, type ImportResult } from '../../lib/api/client'

type Props = { onClose: () => void; onImported: () => void }

export default function ImportModal({ onClose, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  const submit = async () => {
    if (!file) return
    setBusy(true)
    setResult(null)
    const res = await importContracts(file)
    setResult(res)
    setBusy(false)
    if (res.data && res.data.failed === 0) {
      onImported()
    }
  }

  const errors = result?.data?.errors ?? result?.errors ?? []

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6">
        <h3 className="text-lg font-semibold text-slate-50">Import CSV</h3>
        <p className="mt-1 text-sm text-slate-400">
          Mode all-or-nothing: jika ada baris invalid, tidak ada baris yang tersimpan.{' '}
          <a href="/api/v1/contracts/import/template" className="text-indigo-300">
            Unduh template
          </a>
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-4 block w-full text-sm text-slate-300"
        />
        {result?.data && result.data.failed === 0 && (
          <p className="mt-3 text-sm text-emerald-300">
            Berhasil mengimpor {result.data.inserted} kontrak.
          </p>
        )}
        {(result?.error || errors.length > 0) && (
          <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
            <p className="font-semibold">{result?.message ?? 'Import gagal — tidak ada baris tersimpan.'}</p>
            <ul className="mt-1 list-disc pl-5">
              {errors.map((e, i) => (
                <li key={i}>Baris {e.row}: {e.message}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300">
            Tutup
          </button>
          <button
            onClick={submit}
            disabled={!file || busy}
            className="rounded-xl border border-indigo-400 bg-indigo-500/20 px-4 py-2 text-sm font-semibold text-indigo-200 disabled:opacity-60"
          >
            {busy ? 'Mengimpor…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire the modals + buttons into ContractsPage**

In `apps/web/src/features/contracts/ContractsPage.tsx`:

Add imports at the top:
```tsx
import ContractFormModal from './ContractFormModal'
import ImportModal from './ImportModal'
```

Add state inside the component (below the existing `filters` state):
```tsx
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AcceptanceContract | undefined>(undefined)
  const [importOpen, setImportOpen] = useState(false)
```

Replace the comment `{/* Create + Import buttons are added in Task 11 */}` with:
```tsx
            <button
              type="button"
              onClick={() => { setEditing(undefined); setFormOpen(true) }}
              className="rounded-xl border border-indigo-400 bg-indigo-500/20 px-3 py-1.5 text-xs font-semibold text-indigo-200"
            >
              + Kontrak
            </button>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200"
            >
              Import CSV
            </button>
```

In the table row "Aksi" cell, add an Edit button before the Hapus button:
```tsx
                      <button
                        type="button"
                        onClick={() => { setEditing(r); setFormOpen(true) }}
                        className="mr-3 text-xs font-semibold text-indigo-300 hover:text-indigo-200"
                      >
                        Edit
                      </button>
```

At the end of the returned JSX, before the final closing `</div>`, add the modals:
```tsx
      {formOpen && (
        <ContractFormModal
          initial={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); void load() }}
        />
      )}
      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onImported={() => { setImportOpen(false); void load() }}
        />
      )}
```

- [ ] **Step 4: Verify it type-checks**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors in the contracts feature files.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/contracts/
git commit -m "feat(web): add contract create/edit form and CSV import modal"
```

---

### Task 12: Map `RISIKO` layer with supercluster

**Files:**
- Modify: `apps/web/package.json` (add `supercluster`, `@types/supercluster`)
- Create: `apps/web/src/components/RiskLayer.tsx`
- Modify: `apps/web/src/components/RiskMap.tsx` (add `RISIKO` filter + render `<RiskLayer/>`)

**Interfaces:**
- Consumes: `getContracts`, `AcceptanceContract` (Task 9); `PERIL_COLORS`, `PERIL_LABELS`, `formatIDRCompact` (Task 10).
- Produces: `RiskLayer` component with props `{ active: boolean; onContractsLoaded?(c: AcceptanceContract[]): void }` that fetches contracts for the current viewport and renders clustered markers.

- [ ] **Step 1: Add the dependency**

Run:
```bash
cd apps/web && npm install supercluster && npm install -D @types/supercluster
```
Expected: `supercluster` appears in `dependencies`, `@types/supercluster` in `devDependencies`.

- [ ] **Step 2: Create the RiskLayer component**

Create `apps/web/src/components/RiskLayer.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import Supercluster from 'supercluster'
import { getContracts, type AcceptanceContract } from '../lib/api/client'
import { PERIL_COLORS, PERIL_LABELS, formatIDRCompact } from '../features/contracts/format'

type Props = { active: boolean }

function markerSize(shareAmount: number): number {
  // log scale: ~18px small, ~40px large
  const v = Math.max(shareAmount, 1)
  return Math.max(16, Math.min(40, 8 + Math.log10(v) * 3))
}

function objectIcon(c: AcceptanceContract): L.DivIcon {
  const size = markerSize(c.share_amount)
  const color = PERIL_COLORS[c.peril] ?? PERIL_COLORS.other
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};opacity:0.85;border:1px solid rgba(255,255,255,0.5);box-shadow:0 4px 12px rgba(0,0,0,0.4)"></div>`,
  })
}

function clusterIcon(count: number): L.DivIcon {
  const size = count < 10 ? 30 : count < 50 ? 38 : 46
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:rgba(99,102,241,0.35);border:1px solid rgba(165,180,252,0.7);color:#e0e7ff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800">${count}</div>`,
  })
}

export default function RiskLayer({ active }: Props) {
  const map = useMap()
  const [contracts, setContracts] = useState<AcceptanceContract[]>([])
  const [bounds, setBounds] = useState(() => map.getBounds())

  useMapEvents({
    moveend: () => setBounds(map.getBounds()),
    zoomend: () => setBounds(map.getBounds()),
  })

  useEffect(() => {
    if (!active) return
    const sw = bounds.getSouthWest()
    const ne = bounds.getNorthEast()
    const bbox = `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`
    let cancelled = false
    getContracts({ bbox, limit: 2000 })
      .then((res) => { if (!cancelled) setContracts(res.data) })
      .catch(() => { if (!cancelled) setContracts([]) })
    return () => { cancelled = true }
  }, [active, bounds])

  const index = useMemo(() => {
    const sc = new Supercluster({ radius: 60, maxZoom: 16 })
    sc.load(
      contracts.map((c) => ({
        type: 'Feature' as const,
        properties: { contract: c },
        geometry: { type: 'Point' as const, coordinates: [c.longitude, c.latitude] },
      })),
    )
    return sc
  }, [contracts])

  if (!active) return null

  const sw = bounds.getSouthWest()
  const ne = bounds.getNorthEast()
  const zoom = Math.round(map.getZoom())
  const clusters = index.getClusters([sw.lng, sw.lat, ne.lng, ne.lat], zoom)

  return (
    <>
      {clusters.map((cl) => {
        const [lng, lat] = cl.geometry.coordinates
        if (cl.properties.cluster) {
          const count = cl.properties.point_count as number
          return (
            <Marker
              key={`cl-${cl.id}`}
              position={[lat, lng]}
              icon={clusterIcon(count)}
              eventHandlers={{
                click: () => {
                  const expansionZoom = Math.min(index.getClusterExpansionZoom(cl.id as number), 16)
                  map.flyTo([lat, lng], expansionZoom, { animate: true })
                },
              }}
            />
          )
        }
        const c = cl.properties.contract as AcceptanceContract
        return (
          <Marker key={`obj-${c.id}`} position={[lat, lng]} icon={objectIcon(c)}>
            <Popup>
              <div style={{ minWidth: '200px' }}>
                <strong>{c.object_name || c.contract_no}</strong>
                <br />
                <span style={{ color: '#94a3b8', fontSize: '11px' }}>{c.cedant_name}</span>
                <br />
                <span>{PERIL_LABELS[c.peril]} · {c.treaty_type}</span>
                <br />
                <span style={{ fontSize: '12px' }}>
                  TSI {formatIDRCompact(c.sum_insured, c.currency)} · Share {formatIDRCompact(c.share_amount, c.currency)}
                </span>
                <br />
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                  Premi {formatIDRCompact(c.premium, c.currency)} · Klaim {formatIDRCompact(c.claim_amount, c.currency)}
                </span>
              </div>
            </Popup>
          </Marker>
        )
      })}
    </>
  )
}
```

- [ ] **Step 3: Add the `RISIKO` filter and render the layer in RiskMap**

In `apps/web/src/components/RiskMap.tsx`:

Add the import near the top:
```tsx
import RiskLayer from './RiskLayer'
```

Extend the `PerilFilter` type and `LAYER_FILTERS` array to include the risk layer:
```tsx
type PerilFilter = 'all' | 'earthquake' | 'wildfire' | 'volcano' | 'flood' | 'news' | 'risiko'
```
Add this entry to the end of the `LAYER_FILTERS` array:
```tsx
  { key: 'risiko', label: 'Risiko', icon: '◉', accent: 'text-violet-300' },
```

Add a `risiko: 0` placeholder so the `counts` object stays typed — in the `counts` useMemo return object add:
```tsx
      risiko: 0,
```

Inside the `<MapContainer>`, after the news markers block, render the layer:
```tsx
            <RiskLayer active={currentFilter === 'risiko'} />
```

- [ ] **Step 4: Verify it type-checks and builds**

Run: `cd apps/web && npx tsc --noEmit && npm run build`
Expected: builds. (Errors may remain only in `ExposuresPage.tsx`/`EventsPage.tsx` until Tasks 13–14; if `npm run build` fails solely due to those, that is expected and resolved next.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/src/components/RiskLayer.tsx apps/web/src/components/RiskMap.tsx
git commit -m "feat(web): add clustered RISIKO risk-object map layer"
```

---

### Task 13: Accumulation mode — event + what-if pin + panel

**Files:**
- Create: `apps/web/src/components/AccumulationPanel.tsx`
- Modify: `apps/web/src/components/RiskMap.tsx`

**Interfaces:**
- Consumes: `getAccumulation`, `AccumulationResult`, `Event` (Task 9); `formatIDRCompact`, `PERIL_LABELS` (Task 10); existing `selectedEvent` prop on `RiskMap`.
- Produces:
  - `AccumulationPanel` props `{ result: AccumulationResult | null; radiusKm: number; onRadiusChange(n: number): void; peril: string; onPerilChange(p: string): void; whatIf: boolean; onToggleWhatIf(): void; onClear(): void }`.
  - An internal `AccumulationController` (uses `useMapEvents` for what-if click + draws an `L.circle`).

- [ ] **Step 1: Create the AccumulationPanel**

Create `apps/web/src/components/AccumulationPanel.tsx`:

```tsx
import type { AccumulationResult } from '../lib/api/client'
import { PERIL_LABELS, formatIDRCompact } from '../features/contracts/format'

type Props = {
  result: AccumulationResult | null
  radiusKm: number
  onRadiusChange: (n: number) => void
  peril: string
  onPerilChange: (p: string) => void
  whatIf: boolean
  onToggleWhatIf: () => void
  onClear: () => void
}

const PERIL_OPTIONS = ['', 'earthquake', 'flood', 'volcano', 'fire', 'windstorm', 'other']

export default function AccumulationPanel({
  result, radiusKm, onRadiusChange, peril, onPerilChange, whatIf, onToggleWhatIf, onClear,
}: Props) {
  const s = result?.summary
  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-[600] w-64 rounded-xl border border-slate-700/80 bg-slate-950/90 p-3 text-slate-200 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Akumulasi</p>
        <button onClick={onClear} className="text-[10px] text-slate-400 hover:text-slate-200">clear</button>
      </div>

      <button
        onClick={onToggleWhatIf}
        className={`mt-2 w-full rounded-lg px-2 py-1.5 text-[11px] font-semibold ${
          whatIf ? 'bg-violet-500/30 text-violet-100 ring-1 ring-violet-400/50' : 'bg-slate-800 text-slate-300'
        }`}
      >
        {whatIf ? 'Mode What-if: klik peta untuk pin' : 'Aktifkan Mode What-if'}
      </button>

      <label className="mt-3 block text-[11px] text-slate-400">
        Radius: <span className="font-semibold text-slate-100">{radiusKm} km</span>
        <input
          type="range" min={10} max={200} step={5} value={radiusKm}
          onChange={(e) => onRadiusChange(Number(e.target.value))}
          className="mt-1 w-full"
        />
      </label>

      <label className="mt-2 block text-[11px] text-slate-400">
        Filter peril
        <select
          value={peril}
          onChange={(e) => onPerilChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100"
        >
          {PERIL_OPTIONS.map((p) => (
            <option key={p} value={p}>{p === '' ? 'Semua' : PERIL_LABELS[p]}</option>
          ))}
        </select>
      </label>

      {s ? (
        <div className="mt-3 space-y-1 border-t border-slate-800 pt-2 text-xs">
          <Row label="Objek terdampak" value={`${s.count}`} />
          <Row label="TSI" value={formatIDRCompact(s.sum_insured)} />
          <Row label="Share (eksposur)" value={formatIDRCompact(s.share_amount)} strong />
          <Row label="Premi" value={formatIDRCompact(s.premium)} />
          <Row label="Klaim" value={formatIDRCompact(s.claim_amount)} />
          {result!.by_peril.length > 0 && (
            <div className="mt-2 border-t border-slate-800 pt-2">
              {result!.by_peril.map((b) => (
                <Row key={b.peril} label={PERIL_LABELS[b.peril] ?? b.peril} value={`${formatIDRCompact(b.share_amount)} (${b.count})`} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-slate-500">Pilih event atau drop pin what-if untuk menghitung akumulasi.</p>
      )}
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={strong ? 'font-semibold text-violet-200' : 'text-slate-200'}>{value}</span>
    </div>
  )
}
```

- [ ] **Step 2: Add the controller + state to RiskMap**

In `apps/web/src/components/RiskMap.tsx`:

Add imports:
```tsx
import { Circle, useMapEvents } from 'react-leaflet'
import { getAccumulation, type AccumulationResult } from '../lib/api/client'
import AccumulationPanel from './AccumulationPanel'
import { eventTypeToPerilClient } from './perilMap'
```

Create `apps/web/src/components/perilMap.ts`:
```ts
export function eventTypeToPerilClient(eventType: string | null | undefined): string {
  const t = (eventType ?? '').toLowerCase()
  if (t.includes('earthquake') || t.includes('quake')) return 'earthquake'
  if (t.includes('wildfire') || t.includes('fire')) return 'fire'
  if (t.includes('volcano')) return 'volcano'
  if (t.includes('flood')) return 'flood'
  if (t.includes('storm') || t.includes('cyclone') || t.includes('wind')) return 'windstorm'
  return 'other'
}
```

Add an `AccumulationController` component inside `RiskMap.tsx` (above the default export):
```tsx
function AccumulationController({
  center, radiusKm, whatIf, onPick,
}: {
  center: [number, number] | null
  radiusKm: number
  whatIf: boolean
  onPick: (lat: number, lon: number) => void
}) {
  useMapEvents({
    click: (e) => {
      if (whatIf) onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  if (!center) return null
  return <Circle center={center} radius={radiusKm * 1000} pathOptions={{ color: '#a78bfa', weight: 1, fillOpacity: 0.08 }} />
}
```

Inside the `RiskMap` component body, add state:
```tsx
  const [radiusKm, setRadiusKm] = useState(50)
  const [accPeril, setAccPeril] = useState('')
  const [whatIf, setWhatIf] = useState(false)
  const [accCenter, setAccCenter] = useState<[number, number] | null>(null)
  const [accResult, setAccResult] = useState<AccumulationResult | null>(null)
  const [accActiveOn, setAccActiveOn] = useState<string | undefined>(undefined)
```

Add an effect that derives the accumulation center + peril from a selected real event:
```tsx
  useEffect(() => {
    if (selectedEvent) {
      setWhatIf(false)
      setAccCenter([selectedEvent.latitude, selectedEvent.longitude])
      setAccPeril(eventTypeToPerilClient(selectedEvent.event_type))
      setAccActiveOn(selectedEvent.event_time ? selectedEvent.event_time.slice(0, 10) : undefined)
    }
  }, [selectedEvent])
```

Add an effect that calls the API whenever center/radius/peril changes:
```tsx
  useEffect(() => {
    if (!accCenter) {
      setAccResult(null)
      return
    }
    let cancelled = false
    getAccumulation({
      lat: accCenter[0],
      lon: accCenter[1],
      radiusKm,
      peril: accPeril || undefined,
      activeOn: accActiveOn,
    })
      .then((res) => { if (!cancelled) setAccResult(res.data) })
      .catch(() => { if (!cancelled) setAccResult(null) })
    return () => { cancelled = true }
  }, [accCenter, radiusKm, accPeril, accActiveOn])
```

Render the controller inside `<MapContainer>` (after `<RiskLayer .../>`):
```tsx
            <AccumulationController
              center={accCenter}
              radiusKm={radiusKm}
              whatIf={whatIf}
              onPick={(lat, lon) => { setAccActiveOn(undefined); setAccCenter([lat, lon]) }}
            />
```

Render the panel inside the map wrapper `div.rrm-exec-map` (sibling of the "Map Focus" overlay), gated to when the risk layer is active OR an event is selected:
```tsx
        {(currentFilter === 'risiko' || selectedEvent) && (
          <AccumulationPanel
            result={accResult}
            radiusKm={radiusKm}
            onRadiusChange={setRadiusKm}
            peril={accPeril}
            onPerilChange={setAccPeril}
            whatIf={whatIf}
            onToggleWhatIf={() => setWhatIf((v) => !v)}
            onClear={() => { setAccCenter(null); setAccResult(null); setWhatIf(false) }}
          />
        )}
```

- [ ] **Step 3: Verify it type-checks and builds**

Run: `cd apps/web && npx tsc --noEmit && npm run build`
Expected: builds (errors may remain only in `ExposuresPage.tsx`/`EventsPage.tsx` until Task 14).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/AccumulationPanel.tsx apps/web/src/components/perilMap.ts apps/web/src/components/RiskMap.tsx
git commit -m "feat(web): add event + what-if accumulation panel on the risk map"
```

---

### Task 14: EventsPage accumulation summary + retire ExposuresPage

**Files:**
- Modify: `apps/web/src/features/events/EventsPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/TopNav.tsx`
- Delete: `apps/web/src/features/exposures/ExposuresPage.tsx`

**Interfaces:**
- Consumes: `getAccumulation`, `getEvents` (Task 9); `formatIDRCompact`, `eventTypeToPerilClient` (Tasks 10/13).

- [ ] **Step 1: Decouple EventsPage from getExposures and show accumulation**

Open `apps/web/src/features/events/EventsPage.tsx`. Replace the `getExposures`/`ExposureRule` import on line 4 with:
```tsx
import { getEvents, getAccumulation, type Event, type AccumulationResult } from '../../lib/api/client'
import { eventTypeToPerilClient } from '../../components/perilMap'
import { formatIDRCompact } from '../contracts/format'
```

Remove the `regions` state and the `getExposures().catch(...)` call in the load effect (lines ~46–54), so events load on their own. Add accumulation state:
```tsx
  const [acc, setAcc] = useState<AccumulationResult | null>(null)
```

Add an effect that recomputes accumulation when the selected event changes (use whatever variable holds the currently selected event in this file — here assumed `selectedEvent`):
```tsx
  useEffect(() => {
    if (!selectedEvent) { setAcc(null); return }
    let cancelled = false
    getAccumulation({
      lat: selectedEvent.latitude,
      lon: selectedEvent.longitude,
      radiusKm: 50,
      peril: eventTypeToPerilClient(selectedEvent.event_type),
      activeOn: selectedEvent.event_time?.slice(0, 10),
    })
      .then((res) => { if (!cancelled) setAcc(res.data) })
      .catch(() => { if (!cancelled) setAcc(null) })
    return () => { cancelled = true }
  }, [selectedEvent])
```

Replace the old region-list JSX block with an accumulation summary card:
```tsx
      {acc && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h4 className="text-sm font-semibold text-slate-100">Akumulasi dalam radius 50 km</h4>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Objek" value={`${acc.summary.count}`} />
            <Stat label="TSI" value={formatIDRCompact(acc.summary.sum_insured)} />
            <Stat label="Share" value={formatIDRCompact(acc.summary.share_amount)} />
            <Stat label="Premi" value={formatIDRCompact(acc.summary.premium)} />
            <Stat label="Klaim" value={formatIDRCompact(acc.summary.claim_amount)} />
          </div>
        </section>
      )}
```

Add a small `Stat` helper at the bottom of the file (module scope):
```tsx
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-100">{value}</p>
    </div>
  )
}
```

> If `EventsPage` does not already track a selected event, add `const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)` and a row/marker click handler that calls `setSelectedEvent(ev)`. Inspect the file to reuse any existing selection state before adding new state.

- [ ] **Step 2: Repoint App.tsx and rename the nav label**

In `apps/web/src/App.tsx`:
- Replace `import ExposuresPage from './features/exposures/ExposuresPage'` with `import ContractsPage from './features/contracts/ContractsPage'`.
- In the `sections` array, change `{ label: 'Exposures', icon: '▲' }` to `{ label: 'Kontrak / Risiko', icon: '▲' }`.
- In `moreSections`, change `{ label: 'Exposures', section: 'Exposures', icon: '▲' }` to `{ label: 'Kontrak / Risiko', section: 'Kontrak / Risiko', icon: '▲' }`.
- In the main content conditional, change `activeSection === 'Exposures' ? (<ExposuresPage />)` to `activeSection === 'Kontrak / Risiko' ? (<ContractsPage />)`.

- [ ] **Step 3: Update TopNav if it hardcodes the label**

Open `apps/web/src/components/TopNav.tsx`. If it renders section labels from the `sections` prop/array it needs no change. If it hardcodes `'Exposures'` anywhere, replace with `'Kontrak / Risiko'`. Verify by:
Run: `cd apps/web && grep -rn "Exposures" src/`
Expected after edits: no remaining references to `Exposures` except inside the now-deleted file (handled next).

- [ ] **Step 4: Delete ExposuresPage**

```bash
git rm apps/web/src/features/exposures/ExposuresPage.tsx
```

- [ ] **Step 5: Verify the whole frontend builds cleanly**

Run: `cd apps/web && npx tsc --noEmit && npm run build`
Expected: PASS with zero errors. `grep -rn "getExposures\|matchExposure\|ExposureRule" src/` returns nothing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/events/EventsPage.tsx apps/web/src/App.tsx apps/web/src/components/TopNav.tsx
git commit -m "feat(web): event accumulation summary, route contracts page, retire exposures page"
```

---

### Task 15: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Backend up with seeded DB**

Ensure migrations 009 & 010 are applied and the API is running. Run:
```bash
curl -s "http://localhost:8080/api/v1/contracts?peril=earthquake&limit=5"
curl -s "http://localhost:8080/api/v1/accumulation?lat=-0.9&lon=119.9&radius_km=100&peril=earthquake"
curl -s "http://localhost:8080/api/v1/contracts/import/template"
```
Expected: earthquake contracts listed; accumulation `summary.count > 0` near Palu; template CSV downloads with the canonical header.

- [ ] **Step 2: Full Go test + build**

Run: `cd apps/api && go build ./... && go test ./internal/http/ -v`
Expected: build OK, all tests PASS.

- [ ] **Step 3: Full web build**

Run: `cd apps/web && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Manual UI smoke (browser)**

Open the web app. Verify:
1. "Kontrak / Risiko" page lists demo contracts; create, edit, delete, and CSV import (with a deliberately broken row → all-or-nothing error list) work.
2. Executive Risk Map → "Risiko" layer shows clustered points sized by exposure, colored by peril; clusters expand on click; popups show financials.
3. Selecting a real event draws a radius circle and fills the accumulation panel; adjusting the radius slider and peril filter updates totals.
4. "Mode What-if" lets you drop a pin anywhere and recomputes accumulation.
5. Events page shows the 50 km accumulation summary for a selected event.

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "test: end-to-end verification of contract risk accumulation"
```

---

## Self-Review

**1. Spec coverage:**
- Data model (flat table, fields, indexes) → Task 1. ✔
- Seed demo → Task 2. ✔
- CRUD + list with filters → Tasks 4, 5. ✔
- CSV import all-or-nothing + template → Tasks 4, 6. ✔
- Accumulation engine (bbox prefilter + haversine, peril/active_on, by_peril, capped contracts) → Tasks 3, 7. ✔
- Event→peril mapping (Go + client) → Tasks 3, 13. ✔
- Routing + delete old module → Task 8. ✔
- Client types/functions, remove old → Task 9. ✔
- Contracts page (grid, filters, form, import) → Tasks 10, 11. ✔
- RISIKO map layer (supercluster, sized/colored, popups) → Task 12. ✔
- Accumulation modes (event + what-if + panel + radius slider + peril filter) → Task 13. ✔
- EventsPage accumulation summary + retire ExposuresPage + nav rename → Task 14. ✔
- Compact IDR formatting → Task 10. ✔
- E2E verification → Task 15. ✔

**2. Placeholder scan:** Seed file intentionally shows 10 of ~50 rows with an explicit "continue the pattern" instruction (data, not logic) — acceptable. No TBD/TODO in code. The one `dbDown` stub is explicitly flagged for deletion in Task 5 Step 2.

**3. Type consistency:** `Contract` (Go) JSON tags ↔ `AcceptanceContract` (TS) fields match. `contractColumns` scan order ↔ `scanContract` ↔ `contractInsertSQL`/`contractUpdateSQL` parameter order verified. `getAccumulation` query params (`lat`,`lon`,`radius_km`,`peril`,`active_on`) ↔ handler `c.Query(...)` names match. `eventTypeToPeril` (Go) and `eventTypeToPerilClient` (TS) return the same enum vocabulary.

**Note on EventsPage:** Task 14 depends on the file's existing selection state; the task instructs the implementer to inspect and reuse it rather than assume, since the current `EventsPage.tsx` internals beyond the exposure usage were not fully read during planning.
