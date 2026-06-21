# News Geolocation & Alert Corroboration — Design Spec

**Date:** 2026-06-22  
**Scope:** Sub-Project E — extends Sub-Project D (RSS News Feed)  
**Dependencies added:** none (zero new packages; Nominatim is a free REST API)  
**Constraints:** No PostGIS required; no changes to existing hazard event pipeline

---

## Goal

Geolocate news items from RSS feeds, display them as map markers, and automatically create alerts in the existing `alerts` table when a geolocated news item carries a peril tag — with deduplication by geographic area so one incident produces one alert regardless of how many news sources cover it.

---

## Architecture

```
RSS fetch → peril tagging → location extraction (gazetteer → Nominatim)
         → upsert news_items (with lat/lon/place_name)
         → process_news_alerts() → upsert/increment alerts
```

Map page fetches `/api/v1/news` (existing) and `/api/v1/alerts` (existing). No new API endpoints.  
Corroboration highlight computed client-side via Haversine — no backend round-trip.

---

## Section 1 — Geocoding Pipeline

### New files
- `apps/worker/geo/__init__.py`
- `apps/worker/geo/locator.py` — `extract_location(title, summary) -> tuple[str, float, float] | None`
- `apps/worker/geo/gazetteer.py` — static dict, ~120 entries
- `apps/worker/geo/nominatim.py` — async Nominatim client with DB-backed cache

### Gazetteer (`apps/worker/geo/gazetteer.py`)

Static dict keyed on lowercase location name variants → `(lat, lon)`. Covers:
- 34 Indonesian provinces (canonical + common abbreviations)
- ~50 major cities and kabupaten frequently cited in disaster news
- ~15 active volcanoes by name (Merapi, Semeru, Agung, Sinabung, Krakatau, etc.)

Matching: iterate all keys, check `key in text.lower()`. Return the **longest** match to avoid "Jawa" shadowing "Jawa Tengah".

```python
GAZETTEER: dict[str, tuple[float, float]] = {
    # Provinces
    "aceh": (4.695, 96.749),
    "sumatera utara": (2.115, 99.535),
    "sumut": (2.115, 99.535),
    "sumatera barat": (-0.739, 100.800),
    "sumbar": (-0.739, 100.800),
    "riau": (0.293, 101.707),
    "kepulauan riau": (3.946, 108.142),
    "kepri": (3.946, 108.142),
    "jambi": (-1.610, 103.616),
    "sumatera selatan": (-3.320, 104.915),
    "sumsel": (-3.320, 104.915),
    "bangka belitung": (-2.741, 106.441),
    "babel": (-2.741, 106.441),
    "bengkulu": (-3.793, 102.261),
    "lampung": (-4.558, 105.405),
    "banten": (-6.406, 106.064),
    "dki jakarta": (-6.211, 106.845),
    "jakarta": (-6.211, 106.845),
    "jawa barat": (-6.889, 107.640),
    "jabar": (-6.889, 107.640),
    "jawa tengah": (-7.150, 110.140),
    "jateng": (-7.150, 110.140),
    "di yogyakarta": (-7.795, 110.369),
    "yogyakarta": (-7.795, 110.369),
    "jogja": (-7.795, 110.369),
    "jawa timur": (-7.537, 112.238),
    "jatim": (-7.537, 112.238),
    "bali": (-8.409, 115.189),
    "nusa tenggara barat": (-8.652, 117.361),
    "ntb": (-8.652, 117.361),
    "lombok": (-8.650, 116.324),
    "nusa tenggara timur": (-8.657, 121.079),
    "ntt": (-8.657, 121.079),
    "flores": (-8.600, 121.000),
    "kalimantan barat": (-0.733, 109.717),
    "kalbar": (-0.733, 109.717),
    "kalimantan tengah": (-1.681, 113.382),
    "kalteng": (-1.681, 113.382),
    "kalimantan selatan": (-3.093, 115.283),
    "kalsel": (-3.093, 115.283),
    "kalimantan timur": (0.539, 116.419),
    "kaltim": (0.539, 116.419),
    "kalimantan utara": (3.073, 116.041),
    "kaltara": (3.073, 116.041),
    "sulawesi utara": (0.627, 124.021),
    "sulut": (0.627, 124.021),
    "gorontalo": (0.699, 122.446),
    "sulawesi tengah": (-1.431, 121.445),
    "sulteng": (-1.431, 121.445),
    "sulawesi barat": (-2.840, 119.232),
    "sulbar": (-2.840, 119.232),
    "sulawesi selatan": (-3.668, 119.974),
    "sulsel": (-3.668, 119.974),
    "sulawesi tenggara": (-4.145, 122.174),
    "sultra": (-4.145, 122.174),
    "maluku": (-3.237, 130.145),
    "maluku utara": (1.571, 127.808),
    "malut": (1.571, 127.808),
    "papua barat": (-1.336, 133.174),
    "papua": (-4.270, 138.080),
    # Major cities
    "banda aceh": (5.549, 95.323),
    "medan": (3.595, 98.672),
    "padang": (-0.950, 100.354),
    "pekanbaru": (0.507, 101.447),
    "batam": (1.045, 104.030),
    "palembang": (-2.976, 104.775),
    "bandar lampung": (-5.453, 105.262),
    "serang": (-6.120, 106.150),
    "bandung": (-6.921, 107.607),
    "semarang": (-6.967, 110.418),
    "surabaya": (-7.257, 112.752),
    "malang": (-7.983, 112.621),
    "denpasar": (-8.670, 115.212),
    "mataram": (-8.584, 116.118),
    "kupang": (-10.175, 123.608),
    "pontianak": (-0.020, 109.343),
    "palangkaraya": (-2.208, 113.921),
    "banjarmasin": (-3.321, 114.590),
    "samarinda": (-0.502, 117.154),
    "balikpapan": (-1.267, 116.829),
    "tarakan": (3.297, 117.636),
    "manado": (1.487, 124.845),
    "palu": (-0.899, 119.878),
    "donggala": (-0.769, 119.745),
    "sigi": (-1.367, 119.849),
    "poso": (-1.394, 120.754),
    "mamuju": (-2.675, 118.888),
    "makassar": (-5.147, 119.432),
    "kendari": (-3.945, 122.499),
    "ambon": (-3.695, 128.183),
    "ternate": (0.794, 127.381),
    "jayapura": (-2.534, 140.717),
    "manokwari": (-0.861, 134.062),
    "sorong": (-0.876, 131.255),
    "timika": (-4.529, 136.887),
    # Active volcanoes
    "merapi": (-7.541, 110.446),
    "semeru": (-8.108, 112.922),
    "agung": (-8.343, 115.508),
    "sinabung": (3.170, 98.392),
    "krakatau": (-6.102, 105.423),
    "bromo": (-7.942, 112.953),
    "rinjani": (-8.412, 116.467),
    "tambora": (-8.246, 117.994),
    "kelud": (-7.930, 112.308),
    "raung": (-8.125, 114.042),
    "soputan": (1.112, 124.726),
    "lokon": (1.358, 124.793),
    "ibu": (1.488, 127.630),
    "dukono": (1.693, 127.894),
    "gamalama": (0.800, 127.325),
}
```

### Nominatim fallback (`apps/worker/geo/nominatim.py`)

- Extracts candidate place name from title via regex: patterns like `"di ([A-Z][a-z]+ ?[A-Z]?[a-z]*)"`, `"([A-Z][a-z]+) dilanda"`, `"([A-Z][a-z]+) terdampak"`
- Queries `https://nominatim.openstreetmap.org/search?q={place}&countrycodes=id&format=json&limit=1`
- Required header: `User-Agent: tugure-risk-monitor/1.0`
- Rate limit: 1 request/second enforced via `asyncio.sleep(1.0)` between calls
- Cache: `geocode_cache(query_text TEXT PRIMARY KEY, lat FLOAT, lon FLOAT, created_at TIMESTAMPTZ)` — new table in `007_news_alerts_extension.sql`
- Cache miss → query Nominatim → store result. Cache hit → return immediately. Failed query → store `(query, None, None)` to avoid re-querying known-bad strings.

### `NewsItem` Pydantic model extension

The `NewsItem` model in `apps/worker/connectors/rss_news.py` must gain three optional fields (set by `locator` before upsert, `None` if location not found):

```python
lat:        float | None = None
lon:        float | None = None
place_name: str | None   = None
```

### Gazetteer longest-match algorithm

Sort all keys by length descending, iterate, return first match. This prevents `"jawa"` shadowing `"jawa tengah"`:

```python
_SORTED_KEYS = sorted(GAZETTEER.keys(), key=len, reverse=True)

def gazetteer_match(text: str) -> tuple[str, float, float] | None:
    t = text.lower()
    for key in _SORTED_KEYS:
        if key in t:
            lat, lon = GAZETTEER[key]
            return (key.title(), lat, lon)
    return None
```

### `locator.extract_location(title, summary) -> tuple[str, float, float] | None`

```python
async def extract_location(title: str, summary: str, pool=None) -> tuple[str, float, float] | None:
    text = title + " " + summary
    # 1. Gazetteer (sync, fastest)
    match = gazetteer_match(text)
    if match:
        return match  # (place_name, lat, lon)
    # 2. Nominatim (async, cached)
    candidate = extract_candidate_place(text)
    if candidate and pool:
        return await nominatim_geocode(candidate, pool)
    return None
```

### Schema additions to `news_items`

Added directly to `006_news_items.sql` (before any existing data — Hermes writes this fresh):

```sql
lat        FLOAT,
lon        FLOAT,
place_name TEXT
```

---

## Section 2 — Alert Creation & Deduplication

### Migration `007_news_alerts_extension.sql`

```sql
BEGIN;

-- Extend alerts table for news-triggered alerts
ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS news_item_id UUID REFERENCES news_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_count  INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS geo_bucket    VARCHAR(64);

-- Enforce one active alert per geo_bucket (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_geo_bucket_active
  ON alerts (geo_bucket)
  WHERE acknowledged = FALSE AND geo_bucket IS NOT NULL;

-- Cache for Nominatim results
CREATE TABLE IF NOT EXISTS geocode_cache (
    query_text  TEXT         PRIMARY KEY,
    lat         FLOAT,
    lon         FLOAT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMIT;
```

### `apps/worker/news_alerts.py`

```python
"""Create or increment alerts from geolocated news items."""

from __future__ import annotations

import logging
import asyncpg

logger = logging.getLogger(__name__)

PERIL_SEVERITY: dict[str, str] = {
    "volcano":   "Critical",
    "flood":     "High",
    "wildfire":  "High",
    "earthquake": "High",
}

def _geo_bucket(peril: str, lat: float, lon: float) -> str:
    return f"{peril}:{round(lat, 1)}:{round(lon, 1)}"

async def process_news_alerts(pool: asyncpg.Pool, news_item) -> None:
    """For each peril on a geolocated news item: upsert or increment alert."""
    if news_item.lat is None or not news_item.perils:
        return

    async with pool.acquire() as conn:
        for peril in news_item.perils:
            bucket = _geo_bucket(peril, news_item.lat, news_item.lon)
            severity = PERIL_SEVERITY.get(peril, "High")

            # Check for existing unacknowledged alert with same geo_bucket
            existing = await conn.fetchrow(
                "SELECT id, source_count FROM alerts WHERE geo_bucket = $1 AND acknowledged = FALSE",
                bucket,
            )

            if existing:
                await conn.execute(
                    "UPDATE alerts SET source_count = source_count + 1 WHERE id = $1",
                    existing["id"],
                )
                logger.info("Incremented alert %s source_count to %d", existing["id"], existing["source_count"] + 1)
            else:
                await conn.execute(
                    """
                    INSERT INTO alerts (news_item_id, alert_type, severity, message, geo_bucket, source_count)
                    VALUES ($1, 'news_signal', $2, $3, $4, 1)
                    ON CONFLICT DO NOTHING
                    """,
                    news_item.id,
                    severity,
                    f"[{news_item.source.upper()}] {news_item.title[:200]}",
                    bucket,
                )
                logger.info("Created news_signal alert for bucket %s", bucket)
```

### Integration with `_news_poll_cycle()`

`upsert_news_items()` must be extended to return a mapping of `item_id → db_uuid` from the `RETURNING id, item_id` clause so the caller can pass the DB UUID to `process_news_alerts()`:

```python
# db/news.py — updated return type
async def upsert_news_items(pool, items) -> dict[str, str]:
    """Returns {item_id: db_uuid_str} for all upserted rows."""
    ...
    # Use RETURNING id, item_id in the INSERT statement

# main.py — _news_poll_cycle()
id_map = await upsert_news_items(pool, items)
for item in items:
    db_uuid = id_map.get(item.item_id)
    if item.lat is not None and db_uuid:
        await process_news_alerts(pool, item, db_uuid)
```

`process_news_alerts()` signature:
```python
async def process_news_alerts(pool: asyncpg.Pool, news_item, db_uuid: str) -> None:
    ...
    # Use db_uuid (not news_item.item_id) for the news_item_id FK
    await conn.execute(
        "INSERT INTO alerts (news_item_id, ...) VALUES ($1::uuid, ...)",
        db_uuid, ...
    )
```

---

## Section 3 — Map Rendering

### Frontend — `apps/web/src/features/map/MapPage.tsx`

**New layer toggle:**
```typescript
type LayerToggle = 'events' | 'vessels' | 'aircraft' | 'flood' | 'volcano' | 'wildfire' | 'news_locations'
```

Toggle button label: `📍 Berita Lokasi`

**Derived state:**
```typescript
const geolocatedNews = useMemo(
  () => news.filter(n => n.lat != null && n.lon != null),
  [news]
)
```

**Corroboration set** (Haversine, client-side):
```typescript
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const correlatedEventIds = useMemo(() => {
  const ids = new Set<string>()
  for (const n of geolocatedNews) {
    for (const e of events) {
      if (n.perils.includes(e.event_type) && haversineKm(n.lat!, n.lon!, e.latitude, e.longitude) < 50) {
        ids.add(e.event_id)
      }
    }
  }
  return ids
}, [geolocatedNews, events])
```

**News marker icon** (add helper function):
```typescript
function createNewsIcon(item: NewsItem): L.DivIcon {
  const perilEmoji = item.perils[0] === 'earthquake' ? '🔴'
    : item.perils[0] === 'flood' ? '🌊'
    : item.perils[0] === 'volcano' ? '🌋'
    : item.perils[0] === 'wildfire' ? '🔥' : '📰'
  return L.divIcon({
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<div style="width:20px;height:20px;border-radius:4px;background:#1e293b;border:1px solid #475569;
                       display:flex;align-items:center;justify-content:center;font-size:11px;
                       box-shadow:0 1px 4px rgba(0,0,0,0.6)">${perilEmoji}</div>`,
  })
}
```

**CSS for corroboration ring** (add to `MAP_ANIMATION_CSS`):
```css
@keyframes corroborate-ring {
  0%, 100% { box-shadow: 0 0 0 2px rgba(255,255,255,0.9), 0 0 8px rgba(255,255,255,0.4); }
  50%       { box-shadow: 0 0 0 3px rgba(255,255,255,0.6), 0 0 14px rgba(255,255,255,0.2); }
}
.news-corroborated {
  animation: corroborate-ring 2s ease-in-out infinite;
}
```

Hazard marker DivIcon HTML gains the `news-corroborated` class when `correlatedEventIds.has(ev.event_id)`:
```typescript
html: `<div class="event-dot ${pulseClass}${correlatedEventIds.has(ev.event_id) ? ' news-corroborated' : ''}" ...>`
```

**Markers in MapContainer:**
```tsx
{activeLayers.has('news_locations') &&
  geolocatedNews.map((n) => (
    <Marker key={`news-${n.id}`} position={[n.lat!, n.lon!]} icon={createNewsIcon(n)}>
      <Popup>
        <div style={{ minWidth: '200px' }}>
          <div style={{ marginBottom: '6px' }}>
            <strong style={{ color: '#818cf8' }}>{n.source.toUpperCase()}</strong>
            {n.perils.map(p => (
              <span key={p} style={{ marginLeft: '4px' }}>
                {p === 'earthquake' ? '🔴' : p === 'flood' ? '🌊' : p === 'volcano' ? '🌋' : '🔥'}
              </span>
            ))}
          </div>
          <p style={{ fontSize: '13px', margin: '0 0 6px' }}>{n.title}</p>
          <p style={{ fontSize: '11px', color: '#94a3b8', margin: '0 0 4px' }}>
            {n.place_name} · {n.published_at ? new Date(n.published_at).toLocaleString('id-ID') : ''}
          </p>
          <a href={n.url} target="_blank" rel="noopener noreferrer"
             style={{ fontSize: '11px', color: '#6366f1' }}>Baca selengkapnya →</a>
        </div>
      </Popup>
    </Marker>
  ))
}
```

### Frontend API type additions (`apps/web/src/lib/api/client.ts`)

Add `lat`, `lon`, `place_name` to `NewsItem`:
```typescript
export type NewsItem = {
  // ... existing fields
  lat: number | null
  lon: number | null
  place_name: string | null
}
```

---

## Data Flow Summary

```
[RSS Poll every 15min]
  → RSSNewsConnector.fetch_all()
  → _parse_rss() → peril tagging
  → locator.extract_location() → (place_name, lat, lon) | None
  → upsert_news_items(pool, items)   ← news_items table
  → process_news_alerts(pool, item)  ← alerts table (upsert/increment)

[Map page load]
  → GET /api/v1/news    → news items with lat/lon
  → GET /api/v1/alerts  → includes news_signal alerts
  → client: Haversine corroboration → correlatedEventIds Set
  → render: news markers + corroboration rings on hazard markers
```

---

## File Changes Summary

| File | Action |
|------|--------|
| `db/schema/006_news_items.sql` | Add `lat`, `lon`, `place_name` columns |
| `db/schema/007_news_alerts_extension.sql` | New — extend `alerts`, add `geocode_cache` |
| `apps/worker/geo/__init__.py` | New |
| `apps/worker/geo/gazetteer.py` | New — ~120-entry static dict |
| `apps/worker/geo/nominatim.py` | New — async Nominatim client + DB cache |
| `apps/worker/geo/locator.py` | New — `extract_location()` orchestrator |
| `apps/worker/news_alerts.py` | New — `process_news_alerts()` |
| `apps/worker/connectors/rss_news.py` | Modify — call `extract_location()` after parse |
| `apps/worker/db/news.py` | Modify — persist `lat`, `lon`, `place_name` |
| `apps/worker/main.py` | Modify — call `process_news_alerts()` in `_news_poll_cycle()` |
| `apps/api/internal/http/news.go` | Modify — add `Lat`, `Lon`, `PlaceName` to `NewsItem` struct |
| `apps/web/src/lib/api/client.ts` | Modify — add `lat`, `lon`, `place_name` to `NewsItem` |
| `apps/web/src/features/map/MapPage.tsx` | Modify — news markers, corroboration, Haversine |

---

## Non-Goals

- Tidak ada reverse geocoding dari koordinat hazard event ke nama berita
- Tidak ada ML/NLP untuk entity extraction — hanya regex + gazetteer
- Tidak ada alert untuk news tanpa peril tag (berita umum tanpa kata kunci bencana)
- Tidak ada perubahan pada halaman Alerts — `news_signal` alert muncul otomatis karena menggunakan tabel dan endpoint yang sama
