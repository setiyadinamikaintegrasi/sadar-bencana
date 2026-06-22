# Source Health Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an end-to-end Source Health dashboard that shows every connector's last-poll time, item count, and error status so the PT Tugure team can detect stale or broken data sources before they affect underwriting decisions.

**Architecture:** A new `connector_health` table (one row per connector, upserted on each poll cycle) feeds a Go API handler that computes status at request time. A React page auto-refreshes every 30 seconds and groups connectors by category (Hazard / News / Vessel & Aircraft). Worker integration modifies three poll-cycle functions in `main.py` and changes `RSSNewsConnector.fetch_all()` to return per-source health metadata alongside items.

**Tech Stack:** PostgreSQL 16, asyncpg (Python worker), Go 1.21 + Gin, React 18 + TypeScript + Tailwind CSS v3

## Global Constraints

- No new npm, Go, or Python packages beyond what is already installed
- Migration applied via: `cat db/schema/008_connector_health.sql | docker exec -i rrm-postgres psql -U rrm -d reinsurance_risk_monitor`
- Go API handler file MUST be `apps/api/internal/http/connector_health.go` (NOT `health.go` — that file already exists for the ping endpoint)
- Go handler function MUST be named `ConnectorHealthHandler` (not `ConnectorHealth`) to avoid collision with the struct of the same name
- Route: `router.GET("/api/v1/health/connectors", apihttp.ConnectorHealthHandler(dbPool))` in `apps/api/cmd/server/main.go`
- All 15 connectors always appear in the API response, even if their DB row does not exist yet (status: "stale")
- Tests run from `apps/worker/` directory: `python3 -m unittest tests.db.test_health -v`
- Go build check: `cd apps/api && go build ./...`
- API server port: 8001 (not 5432 — that host port belongs to another PostgreSQL)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `db/schema/008_connector_health.sql` | Create | DB migration — one row per connector |
| `apps/worker/db/health.py` | Create | `upsert_connector_health()` async helper |
| `apps/worker/tests/db/test_health.py` | Create | Unit tests for `upsert_connector_health()` |
| `apps/worker/connectors/rss_news.py` | Modify | Change `fetch_all()` to return `(items, health)` tuple |
| `apps/worker/tests/connectors/test_rss_news.py` | Modify | Update `test_fetch_all_*` to unpack tuple + assert health dict |
| `apps/worker/main.py` | Modify | Import new sub-connectors + health module; integrate upserts at 3 poll points |
| `apps/api/internal/http/connector_health.go` | Create | Go handler `ConnectorHealthHandler` |
| `apps/api/cmd/server/main.go` | Modify | Register `GET /api/v1/health/connectors` route |
| `apps/web/src/lib/api/client.ts` | Modify | Add `ConnectorHealth` type + `getConnectorHealth()` |
| `apps/web/src/features/health/SourceHealthPage.tsx` | Create | React page — grouped cards, status badges, auto-refresh |
| `apps/web/src/App.tsx` | Modify | Add "Source Health" to sections + moreSections + render switch |

---

### Task 1: DB Migration

**Files:**
- Create: `db/schema/008_connector_health.sql`

**Interfaces:**
- Produces: table `connector_health(name VARCHAR(64) PRIMARY KEY, last_polled_at TIMESTAMPTZ, items_fetched INT NOT NULL DEFAULT 0, error_message TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`

- [ ] **Step 1: Create the migration file**

```sql
-- db/schema/008_connector_health.sql
BEGIN;

CREATE TABLE IF NOT EXISTS connector_health (
    name           VARCHAR(64)  PRIMARY KEY,
    last_polled_at TIMESTAMPTZ,
    items_fetched  INT          NOT NULL DEFAULT 0,
    error_message  TEXT,
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMIT;
```

- [ ] **Step 2: Apply the migration**

Run from the repo root:

```bash
cat db/schema/008_connector_health.sql | docker exec -i rrm-postgres psql -U rrm -d reinsurance_risk_monitor
```

Expected output:
```
BEGIN
CREATE TABLE
COMMIT
```

- [ ] **Step 3: Verify the table exists**

```bash
docker exec rrm-postgres psql -U rrm -d reinsurance_risk_monitor -c "\d connector_health"
```

Expected output (abbreviated):

```
         Table "public.connector_health"
    Column      |           Type           | Nullable |      Default
----------------+--------------------------+----------+-------------------
 name           | character varying(64)    | not null |
 last_polled_at | timestamp with time zone |          |
 items_fetched  | integer                  | not null | 0
 error_message  | text                     |          |
 updated_at     | timestamp with time zone | not null | now()
Indexes:
    "connector_health_pkey" PRIMARY KEY, btree (name)
```

- [ ] **Step 4: Commit**

```bash
git add db/schema/008_connector_health.sql
git commit -m "feat: migration 008 — connector_health table"
```

---

### Task 2: Worker Persistence Module

**Files:**
- Create: `apps/worker/db/health.py`
- Create: `apps/worker/tests/db/test_health.py`

**Interfaces:**
- Produces: `upsert_connector_health(pool: asyncpg.Pool, name: str, items_fetched: int, error_message: str | None = None) -> None`
- Consumed by: Task 3 (`main.py` integration)

- [ ] **Step 1: Write the failing tests**

Create `apps/worker/tests/db/test_health.py`:

```python
import unittest
from typing import Any, cast
from datetime import timezone
from unittest.mock import AsyncMock

from db.health import upsert_connector_health


class _AcquireContext:
    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _PoolStub:
    def __init__(self, conn):
        self._conn = conn

    def acquire(self):
        return _AcquireContext(self._conn)


class ConnectorHealthDbTests(unittest.IsolatedAsyncioTestCase):
    async def test_upsert_ok_calls_execute_with_name_and_count(self) -> None:
        conn = AsyncMock()
        pool = _PoolStub(conn)

        await upsert_connector_health(cast(Any, pool), "bmkg", 12)

        conn.execute.assert_awaited_once()
        args = conn.execute.await_args.args
        # args[0] = SQL, args[1] = name, args[2] = last_polled_at,
        # args[3] = items_fetched, args[4] = error_message
        self.assertEqual(args[1], "bmkg")
        self.assertEqual(args[3], 12)
        self.assertIsNone(args[4])

    async def test_upsert_error_passes_error_string(self) -> None:
        conn = AsyncMock()
        pool = _PoolStub(conn)

        await upsert_connector_health(cast(Any, pool), "usgs", 0, "timeout")

        args = conn.execute.await_args.args
        self.assertEqual(args[1], "usgs")
        self.assertEqual(args[3], 0)
        self.assertEqual(args[4], "timeout")

    async def test_upsert_last_polled_at_is_utc_datetime(self) -> None:
        conn = AsyncMock()
        pool = _PoolStub(conn)

        await upsert_connector_health(cast(Any, pool), "nasa_firms", 42)

        args = conn.execute.await_args.args
        polled_at = args[2]
        self.assertIsNotNone(polled_at)
        self.assertIsNotNone(polled_at.tzinfo)
        self.assertEqual(polled_at.tzinfo, timezone.utc)
```

- [ ] **Step 2: Run tests — verify they fail**

Run from `apps/worker/`:

```bash
python3 -m unittest tests.db.test_health -v 2>&1 | tail -8
```

Expected: `ModuleNotFoundError: No module named 'db.health'`

- [ ] **Step 3: Write the implementation**

Create `apps/worker/db/health.py`:

```python
"""Persistence helpers for the connector_health table."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import asyncpg

logger = logging.getLogger(__name__)

_UPSERT_SQL = """
INSERT INTO connector_health (name, last_polled_at, items_fetched, error_message, updated_at)
VALUES ($1, $2, $3, $4, now())
ON CONFLICT (name) DO UPDATE SET
    last_polled_at = EXCLUDED.last_polled_at,
    items_fetched  = EXCLUDED.items_fetched,
    error_message  = EXCLUDED.error_message,
    updated_at     = now()
"""


async def upsert_connector_health(
    pool: asyncpg.Pool,
    name: str,
    items_fetched: int,
    error_message: str | None = None,
) -> None:
    now = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        await conn.execute(_UPSERT_SQL, name, now, items_fetched, error_message)
    logger.debug(
        "connector_health upserted: %s items=%d err=%s", name, items_fetched, error_message
    )
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
python3 -m unittest tests.db.test_health -v 2>&1 | tail -8
```

Expected:
```
test_upsert_error_passes_error_string ... ok
test_upsert_last_polled_at_is_utc_datetime ... ok
test_upsert_ok_calls_execute_with_name_and_count ... ok
----------------------------------------------------------------------
Ran 3 tests in 0.XXXs
OK
```

- [ ] **Step 5: Commit**

```bash
git add apps/worker/db/health.py apps/worker/tests/db/test_health.py
git commit -m "feat: connector_health upsert helper + tests"
```

---

### Task 3: Worker Health Integration

**Files:**
- Modify: `apps/worker/connectors/rss_news.py` (change `fetch_all()` return type)
- Modify: `apps/worker/tests/connectors/test_rss_news.py` (update `test_fetch_all_*`)
- Modify: `apps/worker/main.py` (3 integration points: ingest, news, assets)

**Interfaces:**
- Consumes: `upsert_connector_health` from Task 2
- `RSSNewsConnector.fetch_all()` changes return from `list[NewsItem]` to `tuple[list[NewsItem], dict[str, int | str]]`
  - health dict value is `int` (item count) on success, `str` (error message) on failure

- [ ] **Step 1: Update the existing RSS connector test to expect a tuple**

Open `apps/worker/tests/connectors/test_rss_news.py`. Replace the method `test_fetch_all_skips_failed_feeds_and_keeps_successes` (lines 89–107) with:

```python
    async def test_fetch_all_skips_failed_feeds_and_keeps_successes(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.headers.get("User-Agent"), RSS_USER_AGENT)
            if "antaranews" in str(request.url):
                return httpx.Response(200, text=RSS_XML)
            if "cnnindonesia" in str(request.url):
                return httpx.Response(200, text=ATOM_XML)
            return httpx.Response(503, text="upstream down")

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        connector = RSSNewsConnector(http_client=client)
        try:
            items, health = await connector.fetch_all()
        finally:
            await connector.close()
            await client.aclose()

        self.assertEqual(len(items), 3)
        self.assertEqual({item.source for item in items}, {"antara", "cnn"})
        # Health dict: antara=2 items, cnn=1 item, others=error strings
        self.assertEqual(health["antara"], 2)
        self.assertEqual(health["cnn"], 1)
        self.assertIsInstance(health["detik"], str)
        self.assertIsInstance(health["tempo"], str)
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
python3 -m unittest tests.connectors.test_rss_news.RSSNewsConnectorTests.test_fetch_all_skips_failed_feeds_and_keeps_successes -v 2>&1 | tail -6
```

Expected: FAIL — `cannot unpack non-sequence` or `too many values to unpack`

- [ ] **Step 3: Update `RSSNewsConnector.fetch_all()` to return a tuple**

Open `apps/worker/connectors/rss_news.py`. Replace the `fetch_all` method (lines 183–203):

```python
    async def fetch_all(self) -> tuple[list[NewsItem], dict[str, int | str]]:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=self._timeout,
                follow_redirects=True,
                headers={"User-Agent": RSS_USER_AGENT},
            )

        all_items: list[NewsItem] = []
        health: dict[str, int | str] = {}
        assert self._client is not None
        for feed in RSS_SOURCES:
            try:
                response = await self._client.get(
                    feed["url"], headers={"User-Agent": RSS_USER_AGENT}
                )
                response.raise_for_status()
                items = _parse_rss(feed["source"], response.text)
                logger.info("RSS %s: %d items", feed["source"], len(items))
                all_items.extend(items)
                health[feed["source"]] = len(items)
            except Exception as exc:
                logger.warning("RSS feed %s failed: %s", feed["source"], exc)
                health[feed["source"]] = str(exc)

        return all_items, health
```

- [ ] **Step 4: Run the RSS connector tests — verify they pass**

```bash
python3 -m unittest tests.connectors.test_rss_news -v 2>&1 | tail -12
```

Expected: all tests OK (parser tests are unaffected; connector test passes with new assertions)

- [ ] **Step 5: Integrate health upserts into `main.py`**

Open `apps/worker/main.py`.

**5a. Add new imports at the top** (after the existing imports block, before the `logger = ...` line):

```python
from connectors.bmkg import BMKGConnector
from connectors.usgs import USGSConnector
from connectors.gdacs_flood import GDACSFloodConnector
from connectors.gdacs_volcano import GDACSVolcanoConnector
from connectors.nasa_firms import NASAFIRMSConnector
from connectors.multi_source import is_in_indonesia
from db.health import upsert_connector_health
```

**5b. Replace `_ingest_cycle`** (lines 48–80) with the new version that calls each sub-connector individually and tracks health per source. The new function keeps the same signature and return type:

```python
async def _ingest_cycle(pool: asyncpg.Pool) -> dict[str, int]:
    """Run one fetch -> upsert -> score cycle against an active pool.

    Shared by both the on-demand ingest endpoint and the background
    scheduler so they execute identical logic. Tracks health per
    sub-connector in the connector_health table. Raises on any failure.
    """
    # ---- Earthquake sources (BMKG + USGS with geo-aware merge) ----
    bmkg_conn = BMKGConnector()
    bmkg_events: list[EarthquakeEvent] = []
    bmkg_error: str | None = None
    try:
        bmkg_events = await bmkg_conn.fetch_recent()
        await upsert_connector_health(pool, "bmkg", len(bmkg_events))
    except Exception as exc:
        bmkg_error = str(exc)
        await upsert_connector_health(pool, "bmkg", 0, bmkg_error)
        logger.warning("BMKG fetch failed: %s", exc)
    finally:
        await bmkg_conn.close()

    usgs_conn = USGSConnector()
    usgs_events: list[EarthquakeEvent] = []
    try:
        usgs_events = await usgs_conn.fetch_recent()
        await upsert_connector_health(pool, "usgs", len(usgs_events))
    except Exception as exc:
        await upsert_connector_health(pool, "usgs", 0, str(exc))
        logger.warning("USGS fetch failed: %s", exc)
    finally:
        await usgs_conn.close()

    # Merge with geo-aware dedup: BMKG wins for Indonesia bbox
    merged: dict[str, EarthquakeEvent] = {}
    for ev in bmkg_events:
        merged[ev.event_id] = ev
    for ev in usgs_events:
        if is_in_indonesia(ev.latitude, ev.longitude) and bmkg_error is None:
            continue
        merged.setdefault(ev.event_id, ev)
    earthquake_events = list(merged.values())

    # ---- Hazard sources (GDACS flood, GDACS volcano, NASA FIRMS) ----
    gdacs_fl_conn = GDACSFloodConnector()
    flood_events: list[EarthquakeEvent] = []
    try:
        flood_events = await gdacs_fl_conn.fetch_recent()
        await upsert_connector_health(pool, "gdacs_fl", len(flood_events))
    except Exception as exc:
        await upsert_connector_health(pool, "gdacs_fl", 0, str(exc))
        logger.warning("GDACS flood fetch failed: %s", exc)
    finally:
        await gdacs_fl_conn.close()

    gdacs_vo_conn = GDACSVolcanoConnector()
    volcano_events: list[EarthquakeEvent] = []
    try:
        volcano_events = await gdacs_vo_conn.fetch_recent()
        await upsert_connector_health(pool, "gdacs_vo", len(volcano_events))
    except Exception as exc:
        await upsert_connector_health(pool, "gdacs_vo", 0, str(exc))
        logger.warning("GDACS volcano fetch failed: %s", exc)
    finally:
        await gdacs_vo_conn.close()

    nasa_conn = NASAFIRMSConnector()
    wildfire_events: list[EarthquakeEvent] = []
    try:
        wildfire_events = await nasa_conn.fetch_recent()
        await upsert_connector_health(pool, "nasa_firms", len(wildfire_events))
    except Exception as exc:
        await upsert_connector_health(pool, "nasa_firms", 0, str(exc))
        logger.warning("NASA FIRMS fetch failed: %s", exc)
    finally:
        await nasa_conn.close()

    all_events = earthquake_events + flood_events + volcano_events + wildfire_events

    upserted = await upsert_events(pool, all_events)
    scored = await score_events(pool, all_events)
    alerts = await evaluate_and_create_alerts(pool, all_events)

    return {
        "fetched": len(all_events),
        "upserted": upserted,
        "scored": scored,
        "alerts_created": len(alerts),
    }
```

**5c. Replace `_news_poll_cycle`** (lines 193–218) with the version that unpacks the health tuple and calls `upsert_connector_health` per source:

```python
async def _news_poll_cycle() -> int:
    """Poll configured RSS feeds, geolocate, upsert, and create alerts."""

    pool = get_pool()
    connector = RSSNewsConnector()
    try:
        items, health_results = await connector.fetch_all()

        for source_name, health_val in health_results.items():
            if isinstance(health_val, int):
                await upsert_connector_health(pool, source_name, health_val)
            else:
                await upsert_connector_health(pool, source_name, 0, health_val)

        for item in items:
            loc = await extract_location(item.title, item.summary, pool)
            if loc:
                item.lat = loc[1]
                item.lon = loc[2]
                setattr(item, "place_name", loc[0])

        id_map = await upsert_news_items(pool, items)

        for item in items:
            db_uuid = id_map.get(item.item_id)
            if getattr(item, "lat", None) is not None and db_uuid:
                await process_news_alerts(pool, item, db_uuid)

        return len(id_map)
    finally:
        await connector.close()
```

**5d. Replace `_asset_poll_cycle`** (lines 151–190) with the version that adds health upserts for opensky, aisstream, and vesselfinder:

```python
async def _asset_poll_cycle() -> dict[str, int]:
    """Poll OpenSky (REST) + drain AIS buffer + poll VesselFinder, then upsert to DB.

    Called every 60s by the AssetScheduler. Degrades gracefully:
    if any source is unreachable or unconfigured, it logs and continues.
    """
    pool = get_pool()

    # --- Aviation (OpenSky REST) ---
    aircraft_count = 0
    try:
        sky = OpenSkyConnector()
        states = await sky.fetch_states()
        if states:
            aircraft_count = await upsert_aircraft(pool, states)
        await upsert_connector_health(pool, "opensky", aircraft_count)
    except Exception as e:
        logger.warning("OpenSky poll failed: %s", e)
        await upsert_connector_health(pool, "opensky", 0, str(e))

    # --- Marine: AISStream (WebSocket buffer drain) ---
    vessel_count = 0
    if _ais_connector and _ais_connector.is_configured:
        try:
            vessels = _ais_connector.drain()
            if vessels:
                vessel_count = await upsert_vessels(pool, vessels)
            await upsert_connector_health(pool, "aisstream", vessel_count)
        except Exception as e:
            logger.warning("AIS drain failed: %s", e)
            await upsert_connector_health(pool, "aisstream", 0, str(e))

    # --- Marine: VesselFinder (REST) ---
    if _vf_connector and _vf_connector.configured:
        try:
            vf_positions = await _vf_connector.fetch_positions()
            vf_count = 0
            if vf_positions:
                converted = [p.to_vessel_position() for p in vf_positions]
                vf_count = await upsert_vessels(pool, converted)
                vessel_count += vf_count
            await upsert_connector_health(pool, "vesselfinder", vf_count)
        except Exception as e:
            logger.warning("VesselFinder poll failed: %s", e)
            await upsert_connector_health(pool, "vesselfinder", 0, str(e))

    return {"vessels": vessel_count, "aircraft": aircraft_count}
```

- [ ] **Step 6: Run the db tests to verify nothing is broken**

```bash
python3 -m unittest tests.db.test_health tests.db.test_news tests.connectors.test_rss_news -v 2>&1 | tail -15
```

Expected: all tests OK

- [ ] **Step 7: Commit**

```bash
git add apps/worker/connectors/rss_news.py \
        apps/worker/tests/connectors/test_rss_news.py \
        apps/worker/main.py
git commit -m "feat: integrate connector_health upserts into all 3 poll cycles"
```

---

### Task 4: Go API Endpoint

**Files:**
- Create: `apps/api/internal/http/connector_health.go`
- Modify: `apps/api/cmd/server/main.go`

**Interfaces:**
- Produces: `GET /api/v1/health/connectors` → `{ "data": [ConnectorHealth...], "meta": { "count": 15 } }`
- `ConnectorHealth` struct has fields: `name`, `status` ("ok"|"stale"|"error"), `last_polled_at`, `items_fetched`, `error_message`, `threshold_seconds`, `updated_at`
- `ConnectorHealthHandler(db *sql.DB) gin.HandlerFunc` — function exported from package `http`

- [ ] **Step 1: Create `connector_health.go`**

Create `apps/api/internal/http/connector_health.go`:

```go
package http

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// connectorThresholds maps each connector name to its staleness threshold in
// seconds. Threshold = 2× the scheduler's poll interval for that source type.
var connectorThresholds = map[string]int{
	// Hazard — IngestScheduler every 5 min (300s) × 2
	"bmkg":       600,
	"usgs":       600,
	"gdacs_fl":   600,
	"gdacs_vo":   600,
	"nasa_firms": 600,
	// News — NewsScheduler every 15 min (900s) × 2
	"antara":    1800,
	"detik":     1800,
	"cnn":       1800,
	"tempo":     1800,
	"republika": 1800,
	"sindo":     1800,
	"okezone":   1800,
	// Vessel & Aircraft — AssetScheduler every 60s × 2
	"aisstream":   120,
	"vesselfinder": 120,
	"opensky":     120,
}

// ConnectorHealth is one row in the /api/v1/health/connectors response.
type ConnectorHealth struct {
	Name             string     `json:"name"`
	Status           string     `json:"status"` // "ok" | "stale" | "error"
	LastPolledAt     *time.Time `json:"last_polled_at"`
	ItemsFetched     int        `json:"items_fetched"`
	ErrorMessage     *string    `json:"error_message"`
	ThresholdSeconds int        `json:"threshold_seconds"`
	UpdatedAt        *time.Time `json:"updated_at"`
}

// ConnectorHealthHandler returns a gin.HandlerFunc for GET /api/v1/health/connectors.
// Status is computed at request time: "error" if error_message is set,
// "stale" if last_polled_at is null or older than threshold_seconds, else "ok".
// All 15 known connectors always appear in the response even if the DB row
// does not exist yet (they will show as status "stale").
func ConnectorHealthHandler(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_unavailable",
				"message": "the database is not configured",
			})
			return
		}

		const query = `
			SELECT name, last_polled_at, items_fetched, error_message, updated_at
			FROM connector_health
		`
		rows, err := db.QueryContext(c.Request.Context(), query)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}
		defer rows.Close()

		type dbRow struct {
			lastPolledAt *time.Time
			itemsFetched int
			errorMessage *string
			updatedAt    *time.Time
		}
		dbRows := make(map[string]dbRow)
		for rows.Next() {
			var name string
			var r dbRow
			if err := rows.Scan(
				&name,
				&r.lastPolledAt,
				&r.itemsFetched,
				&r.errorMessage,
				&r.updatedAt,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "row_scan_failed",
					"message": err.Error(),
				})
				return
			}
			dbRows[name] = r
		}
		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "rows_iteration_failed",
				"message": err.Error(),
			})
			return
		}

		now := time.Now().UTC()
		result := make([]ConnectorHealth, 0, len(connectorThresholds))

		for name, threshold := range connectorThresholds {
			ch := ConnectorHealth{
				Name:             name,
				ThresholdSeconds: threshold,
			}

			row, exists := dbRows[name]
			if !exists {
				ch.Status = "stale"
				result = append(result, ch)
				continue
			}

			ch.LastPolledAt = row.lastPolledAt
			ch.ItemsFetched = row.itemsFetched
			ch.ErrorMessage = row.errorMessage
			ch.UpdatedAt = row.updatedAt

			switch {
			case row.errorMessage != nil:
				ch.Status = "error"
			case row.lastPolledAt == nil:
				ch.Status = "stale"
			case now.Sub(*row.lastPolledAt) > time.Duration(threshold)*time.Second:
				ch.Status = "stale"
			default:
				ch.Status = "ok"
			}

			result = append(result, ch)
		}

		c.JSON(http.StatusOK, gin.H{
			"data": result,
			"meta": gin.H{"count": len(result)},
		})
	}
}
```

- [ ] **Step 2: Register the route in `main.go`**

Open `apps/api/cmd/server/main.go`. After line 52 (`router.GET("/api/v1/assets/aviation", ...)`), add:

```go
	router.GET("/api/v1/health/connectors", apihttp.ConnectorHealthHandler(dbPool))
```

The routes block (lines 41–52) becomes:

```go
	router.GET("/health", apihttp.Health)
	router.GET("/api/v1/meta", apihttp.Meta(cfg.Env))
	router.GET("/api/v1/events", apihttp.Events(dbPool))
	router.GET("/api/v1/news", apihttp.News(dbPool))
	router.GET("/api/v1/risk-scores", apihttp.RiskScores(dbPool))
	router.GET("/api/v1/briefings/today", apihttp.BriefingsToday(dbPool))
	router.GET("/api/v1/alerts", apihttp.Alerts(dbPool))
	router.PATCH("/api/v1/alerts/:id/acknowledge", apihttp.AcknowledgeAlert(dbPool))
	router.GET("/api/v1/exposures", apihttp.Exposures(dbPool))
	router.GET("/api/v1/exposures/match", apihttp.ExposureMatch(dbPool))
	router.GET("/api/v1/assets/marine", apihttp.AssetsMarine(dbPool))
	router.GET("/api/v1/assets/aviation", apihttp.AssetsAviation(dbPool))
	router.GET("/api/v1/health/connectors", apihttp.ConnectorHealthHandler(dbPool))
```

- [ ] **Step 3: Verify Go build succeeds**

```bash
cd apps/api && go build ./...
```

Expected: no output (build succeeds)

- [ ] **Step 4: Verify endpoint against live DB**

Start the API, then run:

```bash
curl -s http://localhost:8001/api/v1/health/connectors | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('connector count:', d['meta']['count'])
names = {c['name'] for c in d['data']}
expected = {'bmkg','usgs','gdacs_fl','gdacs_vo','nasa_firms',
            'antara','detik','cnn','tempo','republika','sindo','okezone',
            'aisstream','vesselfinder','opensky'}
missing = expected - names
extra = names - expected
print('missing:', missing)
print('extra:', extra)
print('statuses:', {c['name']: c['status'] for c in d['data']})
"
```

Expected:
- `connector count: 15`
- `missing: set()` (no missing connectors)
- `extra: set()`
- All statuses `"stale"` if worker hasn't run yet, or a mix of `"ok"/"stale"/"error"` after a worker poll

- [ ] **Step 5: Commit**

```bash
git add apps/api/internal/http/connector_health.go apps/api/cmd/server/main.go
git commit -m "feat: GET /api/v1/health/connectors — connector health endpoint"
```

---

### Task 5: Frontend Source Health Page

**Files:**
- Modify: `apps/web/src/lib/api/client.ts`
- Create: `apps/web/src/features/health/SourceHealthPage.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/health/connectors` from Task 4
- `ConnectorHealth` type from `client.ts`
- `getConnectorHealth(): Promise<ConnectorHealth[]>` from `client.ts`

- [ ] **Step 1: Add type and fetch function to `client.ts`**

Open `apps/web/src/lib/api/client.ts`. Append at the end of the file:

```typescript
export type ConnectorHealth = {
  name: string
  status: 'ok' | 'stale' | 'error'
  last_polled_at: string | null
  items_fetched: number
  error_message: string | null
  threshold_seconds: number
  updated_at: string | null
}

export async function getConnectorHealth(): Promise<ConnectorHealth[]> {
  const res = await request<{ data: ConnectorHealth[]; meta: { count: number } }>(
    '/health/connectors',
  )
  return res.data
}
```

- [ ] **Step 2: Create `SourceHealthPage.tsx`**

Create directory `apps/web/src/features/health/` and create `SourceHealthPage.tsx`:

```typescript
import { useCallback, useEffect, useState } from 'react'
import { getConnectorHealth, type ConnectorHealth } from '../../lib/api/client'

const REFRESH_INTERVAL_MS = 30_000

const CATEGORIES = [
  {
    label: 'Hazard',
    names: ['bmkg', 'usgs', 'gdacs_fl', 'gdacs_vo', 'nasa_firms'],
  },
  {
    label: 'News',
    names: ['antara', 'detik', 'cnn', 'tempo', 'republika', 'sindo', 'okezone'],
  },
  {
    label: 'Vessel & Aircraft',
    names: ['aisstream', 'vesselfinder', 'opensky'],
  },
] as const

const statusConfig = {
  ok: { dot: '●', label: 'OK', dotClass: 'text-emerald-400', textClass: 'text-emerald-300' },
  stale: { dot: '◐', label: 'STALE', dotClass: 'text-amber-400', textClass: 'text-amber-300' },
  error: { dot: '✕', label: 'ERROR', dotClass: 'text-rose-400', textClass: 'text-rose-300' },
} as const

function relativeTime(isoStr: string | null): string {
  if (!isoStr) return '—'
  const diffMs = Date.now() - new Date(isoStr).getTime()
  const secs = Math.floor(diffMs / 1000)
  if (secs < 60) return 'baru saja'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} mnt lalu`
  const hours = Math.floor(mins / 60)
  return `${hours} jam lalu`
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text
}

function ConnectorRow({ connector }: { connector: ConnectorHealth }) {
  const cfg = statusConfig[connector.status]
  return (
    <tr className="border-t border-slate-800">
      <td className="py-3 pr-4 font-mono text-sm text-slate-200">{connector.name}</td>
      <td className="py-3 pr-4">
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${cfg.textClass}`}>
          <span className={cfg.dotClass}>{cfg.dot}</span>
          {cfg.label}
        </span>
      </td>
      <td className="py-3 pr-4 text-xs text-slate-400">{relativeTime(connector.last_polled_at)}</td>
      <td className="py-3 pr-4 text-xs text-slate-400">{connector.items_fetched} item</td>
      <td className="py-3 text-xs text-slate-500">
        {connector.error_message ? (
          <span title={connector.error_message} className="cursor-help text-rose-400">
            {truncate(connector.error_message, 80)}
          </span>
        ) : (
          <span className="text-slate-700">—</span>
        )}
      </td>
    </tr>
  )
}

function CategoryCard({
  label,
  names,
  byName,
}: {
  label: string
  names: readonly string[]
  byName: Map<string, ConnectorHealth>
}) {
  const connectors = names.map((n) => byName.get(n)).filter(Boolean) as ConnectorHealth[]
  const errorCount = connectors.filter((c) => c.status === 'error').length
  const staleCount = connectors.filter((c) => c.status === 'stale').length

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-indigo-400">
            Connectors
          </p>
          <h3 className="mt-1 text-lg font-semibold text-slate-50">{label}</h3>
        </div>
        <div className="flex gap-2">
          {errorCount > 0 && (
            <span className="inline-flex rounded-full bg-rose-500/15 px-3 py-1 text-xs font-semibold text-rose-300 ring-1 ring-inset ring-rose-400/30">
              {errorCount} error
            </span>
          )}
          {staleCount > 0 && (
            <span className="inline-flex rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300 ring-1 ring-inset ring-amber-400/30">
              {staleCount} stale
            </span>
          )}
          {errorCount === 0 && staleCount === 0 && (
            <span className="inline-flex rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
              all ok
            </span>
          )}
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left">
          <thead>
            <tr>
              <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Connector
              </th>
              <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Status
              </th>
              <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Last Poll
              </th>
              <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Items
              </th>
              <th className="pb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Error
              </th>
            </tr>
          </thead>
          <tbody>
            {connectors.map((c) => (
              <ConnectorRow key={c.name} connector={c} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="space-y-3 md:hidden">
        {connectors.map((c) => {
          const cfg = statusConfig[c.status]
          return (
            <div
              key={c.name}
              className="rounded-xl border border-slate-800 bg-slate-950/40 p-4"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-medium text-slate-200">{c.name}</span>
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${cfg.textClass}`}>
                  <span className={cfg.dotClass}>{cfg.dot}</span>
                  {cfg.label}
                </span>
              </div>
              <div className="mt-2 flex gap-4 text-xs text-slate-400">
                <span>{relativeTime(c.last_polled_at)}</span>
                <span>{c.items_fetched} item</span>
              </div>
              {c.error_message && (
                <p className="mt-2 break-words text-xs text-rose-400">
                  {truncate(c.error_message, 80)}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default function SourceHealthPage() {
  const [connectors, setConnectors] = useState<ConnectorHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const data = await getConnectorHealth()
      setConnectors(data)
      setLastUpdated(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load connector health.')
    } finally {
      if (mode === 'initial') setLoading(false)
      else setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load('initial')
  }, [load])

  useEffect(() => {
    const id = window.setInterval(() => void load('refresh'), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [load])

  const byName = new Map(connectors.map((c) => [c.name, c]))

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-indigo-400">
              Source Health
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-50">Connector Status</h3>
            <p className="mt-2 text-sm text-slate-400">
              Status setiap data connector. Auto-refresh setiap 30 detik.
              {lastUpdated && (
                <span className="ml-2 text-slate-500">
                  Terakhir diperbarui: {lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load('refresh')}
            disabled={loading || refreshing}
            className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-indigo-400 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </section>

      {error ? (
        <section className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 shadow-2xl shadow-slate-950/40">
          <p className="text-sm font-semibold text-rose-100">Failed to load connector health</p>
          <p className="mt-2 break-words text-sm text-rose-300/80">{error}</p>
        </section>
      ) : null}

      {loading ? (
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
          <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-400">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400" />
            Loading connector health…
          </div>
        </section>
      ) : (
        CATEGORIES.map((cat) => (
          <CategoryCard key={cat.label} label={cat.label} names={cat.names} byName={byName} />
        ))
      )}
    </div>
  )
}
```

- [ ] **Step 3: Update `App.tsx`**

Open `apps/web/src/App.tsx`.

**3a.** Add the import for `SourceHealthPage` after the existing imports (line 7):

```typescript
import SourceHealthPage from './features/health/SourceHealthPage'
```

**3b.** Add `'Source Health'` to the `sections` array (after `'Briefing'`):

```typescript
const sections = [
  { label: 'Executive Overview', icon: '◼' },
  { label: 'Map', icon: '◉' },
  { label: 'Events', icon: '●' },
  { label: 'Exposures', icon: '▲' },
  { label: 'Alerts', icon: '◆' },
  { label: 'Claims', icon: '■' },
  { label: 'Briefing', icon: '◇' },
  { label: 'Source Health', icon: '◈' },
] as const
```

**3c.** Add `'Source Health'` to `moreSections` (after `'Briefing'`):

```typescript
const moreSections: { label: string; section: Section; icon: string }[] = [
  { label: 'Exposures', section: 'Exposures', icon: '▲' },
  { label: 'Claims', section: 'Claims', icon: '■' },
  { label: 'Briefing', section: 'Briefing', icon: '◇' },
  { label: 'Source Health', section: 'Source Health', icon: '◈' },
]
```

**3d.** Add the render case in the main content switch (after the `'Briefing'` branch, before the fallback `<section>`):

```typescript
          ) : activeSection === 'Briefing' ? (
            <BriefingPage />
          ) : activeSection === 'Source Health' ? (
            <SourceHealthPage />
          ) : (
```

- [ ] **Step 4: Verify TypeScript build**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (no type errors)

- [ ] **Step 5: Verify the page renders**

Start the dev server if not running:

```bash
cd apps/web && npm run dev
```

Navigate to `http://localhost:3001`. Click "Source Health" in the sidebar (desktop) or in the More sheet (mobile).

Verify:
- Three category cards appear: Hazard, News, Vessel & Aircraft
- Each connector shows a status badge (all "STALE" if worker hasn't run, mix otherwise)
- Desktop: table layout with Connector / Status / Last Poll / Items / Error columns
- Mobile: card list layout
- "Refresh" button triggers a spinner and updates the timestamp

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/api/client.ts \
        apps/web/src/features/health/SourceHealthPage.tsx \
        apps/web/src/App.tsx
git commit -m "feat: Source Health dashboard page — connector status per category"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered by task |
|---|---|
| DB migration `connector_health` table | Task 1 |
| `upsert_connector_health(pool, name, items_fetched, error_message)` | Task 2 |
| `_ingest_cycle` health tracking per sub-connector | Task 3 step 5b |
| `_news_poll_cycle` health via `fetch_all()` tuple | Task 3 steps 3, 5c |
| `_asset_poll_cycle` health for aisstream/vesselfinder/opensky | Task 3 step 5d |
| `ConnectorHealthHandler` Go handler with 15 connectors | Task 4 step 1 |
| Route `GET /api/v1/health/connectors` | Task 4 step 2 |
| `ConnectorHealth` TypeScript type | Task 5 step 1 |
| `getConnectorHealth()` fetch function | Task 5 step 1 |
| `SourceHealthPage.tsx` — category cards, status badges, relative time | Task 5 step 2 |
| Error message truncated to 80 chars with `title` tooltip | Task 5 step 2 (truncate + `title` attr) |
| Auto-refresh 30 seconds | Task 5 step 2 |
| Sidebar entry + More sheet + render case in App.tsx | Task 5 step 3 |

All spec requirements covered. No gaps found.

**Type consistency check:**

- `upsert_connector_health(pool, name, items_fetched, error_message)` — defined in Task 2, used in Tasks 3 (main.py) ✓
- `fetch_all() -> tuple[list[NewsItem], dict[str, int | str]]` — defined in Task 3 step 3, consumed in Task 3 step 5c ✓
- `ConnectorHealth` struct fields in Go match JSON tags consumed by TypeScript type in Task 5 ✓
- `getConnectorHealth(): Promise<ConnectorHealth[]>` — defined in Task 5 step 1, imported in SourceHealthPage ✓
- `statusConfig` keys are `'ok' | 'stale' | 'error'` — matches Go handler output and TypeScript `status` type ✓
