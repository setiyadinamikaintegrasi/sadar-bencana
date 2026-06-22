# Data Completeness Fix — Design Spec

**Date:** 2026-06-22
**Scope:** `apps/api/internal/http/events.go`, `apps/api/internal/http/news.go`
**Dependencies added:** none
**Constraints:** No schema migrations, no new endpoints, no frontend changes, no new npm/Go packages

---

## Problem

### 1. Events API cap

The events endpoint returns the 100 most recent rows globally:

```sql
ORDER BY event_time DESC NULLS LAST LIMIT 100
```

The DB currently holds:

| event_type | rows |
|------------|------|
| wildfire   | 312  |
| earthquake | 34   |
| volcano    | 4    |
| flood      | 2    |

Because wildfire hotspots are added in batches of hundreds, a single FIRMS poll fills most of the 100-row window. The map ends up showing ~43 wildfires and only 7 earthquakes — flood and volcano markers can disappear entirely.

### 2. News panel shows "0 cocok"

The news endpoint returns the 100 most recently published items. The frontend filters these client-side by active map layers. Because hazard-tagged items are sparse in the latest batch, the panel shows "0 cocok" even though hazard news exists further back in the `news_items` table.

---

## Solution

### Part 1 — Per-type limits in events.go

Replace the single global query with a `UNION ALL` of four per-type subqueries. Each type gets its own `LIMIT`, ensuring every peril is represented regardless of ingest volume.

**Limits:**

| event_type | LIMIT | Rationale |
|------------|-------|-----------|
| earthquake | 50    | Seismic events are sparse (34 in DB); 50 is comfortable headroom |
| wildfire   | 200   | FIRMS generates 100s of hotspots; 200 gives good Indonesia coverage |
| flood      | 30    | GDACS bbox-filtered — stays sparse |
| volcano    | 30    | GDACS bbox-filtered — stays sparse |

Total max rows returned: **310**.

**New query:**

```sql
(SELECT id, event_id, source, event_type, magnitude, latitude, longitude,
        place, event_time, url, severity, created_at
 FROM events WHERE event_type = 'earthquake'
 ORDER BY event_time DESC NULLS LAST LIMIT 50)
UNION ALL
(SELECT id, event_id, source, event_type, magnitude, latitude, longitude,
        place, event_time, url, severity, created_at
 FROM events WHERE event_type = 'wildfire'
 ORDER BY event_time DESC NULLS LAST LIMIT 200)
UNION ALL
(SELECT id, event_id, source, event_type, magnitude, latitude, longitude,
        place, event_time, url, severity, created_at
 FROM events WHERE event_type = 'flood'
 ORDER BY event_time DESC NULLS LAST LIMIT 30)
UNION ALL
(SELECT id, event_id, source, event_type, magnitude, latitude, longitude,
        place, event_time, url, severity, created_at
 FROM events WHERE event_type = 'volcano'
 ORDER BY event_time DESC NULLS LAST LIMIT 30)
ORDER BY event_time DESC NULLS LAST
```

The response envelope (`{ "data": [...], "meta": { "count": N } }`) is unchanged. Frontend receives the same `Event[]` type — no client changes needed.

### Part 2 — Hazard-first ordering in news.go

Add `(perils != '{}') DESC` as the primary sort key. Hazard-tagged items sort to the top of the 100-row window. If no hazard news exists at all, recents fill the panel — no "0 cocok" on a fresh feed.

**Change:**

```sql
-- before
ORDER BY published_at DESC NULLS LAST LIMIT 100

-- after
ORDER BY (perils != '{}') DESC, published_at DESC NULLS LAST LIMIT 100
```

No other changes to `news.go`.

---

## Files Changed

| File | Change |
|------|--------|
| `apps/api/internal/http/events.go` | Replace `eventsQuery` const with UNION ALL per-type query |
| `apps/api/internal/http/news.go`   | Add `(perils != '{}') DESC` as primary ORDER BY key |

---

## Non-Goals

- No pagination — per-type limits are sufficient for current data volumes
- No frontend changes — existing `Event[]` and `NewsItem[]` types handle the new response
- No new event types — if a new `event_type` is added later, it appears in the global tail until a per-type clause is added
- No alert threshold changes
