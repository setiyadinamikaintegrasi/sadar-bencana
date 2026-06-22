# Data Completeness Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the events API returning too few events (all types share one LIMIT) and fix the news panel showing "0 cocok" by ordering hazard-tagged items first.

**Architecture:** Two independent query changes in the Go API. `events.go` gets a UNION ALL replacing the global LIMIT. `news.go` gains a hazard-first ORDER BY. No schema changes, no frontend changes, no new packages.

**Tech Stack:** Go 1.21, Gin, `database/sql`, PostgreSQL 16

## Global Constraints

- Only two files modified: `apps/api/internal/http/events.go`, `apps/api/internal/http/news.go`
- No new Go packages, no schema migrations, no frontend changes
- `go build ./...` must pass after every task
- API server runs on port 8001; env loaded from `/tmp/rrm-runtime.env`
- Restart API after each task to verify against the live DB:
  ```bash
  # In apps/api directory:
  set -a && . /tmp/rrm-runtime.env && set +a && go run ./cmd/server
  ```

---

### Task 1: events.go — per-type UNION ALL query

**Files:**
- Modify: `apps/api/internal/http/events.go`

**Interfaces:**
- Produces: `GET /api/v1/events` returns up to 310 rows (50 earthquake + 200 wildfire + 30 flood + 30 volcano), same `Event` struct, same `{ "data": [...], "meta": { "count": N, "limit": 310 } }` envelope

- [ ] **Step 1: Replace `eventsQuery` const in `events.go`**

Open `apps/api/internal/http/events.go`. Replace lines 27–34 (the `eventsQuery` const) with:

```go
// eventsQuery returns per-type capped events via UNION ALL so no single
// event type can crowd out others. Limits: earthquake 50, wildfire 200,
// flood 30, volcano 30 — total max 310 rows.
const eventsQuery = `
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
`
```

- [ ] **Step 2: Update initial slice capacity and meta limit in the handler**

In the `Events` handler (lines 59 and 97):

Change line 59:
```go
events := make([]Event, 0, 310)
```

Change line 97:
```go
"meta": gin.H{
    "count": len(events),
    "limit": 310,
},
```

- [ ] **Step 3: Verify build**

```bash
cd apps/api && go build ./...
```

Expected: no output (build succeeds).

- [ ] **Step 4: Verify query against live DB**

Restart the API, then:

```bash
curl -s http://localhost:8001/api/v1/events \
  | python3 -c "
import json, sys
from collections import Counter
d = json.load(sys.stdin)
print('total:', d['meta']['count'])
print(Counter(e['event_type'] for e in d['data']))
"
```

Expected output (exact counts vary by live data):
```
total: <number up to 310>
Counter({'wildfire': <up to 200>, 'earthquake': <up to 50>, 'volcano': <up to 30>, 'flood': <up to 30>})
```

All four event types must appear. `wildfire` must exceed 50 (previously crowded out).

- [ ] **Step 5: Commit**

```bash
git add apps/api/internal/http/events.go
git commit -m "fix: events API — per-type UNION ALL limits (eq:50 wf:200 fl:30 vo:30)"
```

---

### Task 2: news.go — hazard-first ORDER BY

**Files:**
- Modify: `apps/api/internal/http/news.go`

**Interfaces:**
- Produces: `GET /api/v1/news` returns up to 100 rows with hazard-tagged items (`perils != '{}'`) sorted before untagged ones, then by `published_at DESC`. Same `NewsItem` struct, same response envelope.

- [ ] **Step 1: Update `newsQuery` ORDER BY in `news.go`**

Open `apps/api/internal/http/news.go`. Replace lines 42–43 (the ORDER BY + LIMIT lines):

```go
ORDER BY (perils != '{}') DESC, published_at DESC NULLS LAST
LIMIT 100
```

The full updated `newsQuery` const (lines 28–44) becomes:

```go
const newsQuery = `
SELECT id,
       item_id,
       source,
       title,
       summary,
       url,
       published_at,
       COALESCE(array_to_json(perils), '[]'::json),
       lat,
       lon,
       place_name,
       created_at
FROM news_items
ORDER BY (perils != '{}') DESC, published_at DESC NULLS LAST
LIMIT 100
`
```

- [ ] **Step 2: Verify build**

```bash
cd apps/api && go build ./...
```

Expected: no output.

- [ ] **Step 3: Verify hazard items appear first in live response**

Restart the API, then:

```bash
curl -s http://localhost:8001/api/v1/news \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
items = d['data']
hazard = [i for i in items if i['perils']]
non_hazard = [i for i in items if not i['perils']]
print('hazard items:', len(hazard))
print('non-hazard items:', len(non_hazard))
if hazard and non_hazard:
    # First non-hazard item should appear after all hazard items
    first_non_hazard_idx = next(i for i, x in enumerate(items) if not x['perils'])
    last_hazard_idx = max(i for i, x in enumerate(items) if x['perils'])
    print('last hazard index:', last_hazard_idx)
    print('first non-hazard index:', first_non_hazard_idx)
    print('order correct:', last_hazard_idx < first_non_hazard_idx)
"
```

Expected: `hazard items` > 0, `order correct: True`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/internal/http/news.go
git commit -m "fix: news API — hazard-tagged items sort first (perils != '{}' DESC)"
```

---

### Task 3: Final verification

**Files:** No changes

- [ ] **Step 1: Build check**

```bash
cd apps/api && go build ./...
```

Expected: no output.

- [ ] **Step 2: End-to-end event type check**

```bash
curl -s http://localhost:8001/api/v1/events \
  | python3 -c "
import json, sys
from collections import Counter
d = json.load(sys.stdin)
c = Counter(e['event_type'] for e in d['data'])
print(c)
assert c.get('wildfire', 0) > 50, 'wildfire still capped at 50!'
assert c.get('earthquake', 0) > 0, 'no earthquakes!'
print('PASS')
"
```

Expected: `PASS`.

- [ ] **Step 3: End-to-end news hazard order check**

```bash
curl -s http://localhost:8001/api/v1/news \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
items = d['data']
hazard_count = sum(1 for i in items if i['perils'])
print('hazard items in top 100:', hazard_count)
assert hazard_count > 0, 'no hazard items!'
print('PASS')
"
```

Expected: `hazard items in top 100: <N>` where N > 0, then `PASS`.

- [ ] **Step 4: Open map in browser**

Navigate to `http://localhost:3001` → Map page. Verify:
- Wildfire layer (🔥 Kebakaran) shows significantly more markers than before
- News panel (📰 Berita) shows hazard-tagged items when panel is open
