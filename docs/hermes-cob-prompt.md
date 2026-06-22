# Hermes Agent Prompt — OJK COB Multi-Hazard Feature

**Project:** Reinsurance Risk Monitor — PT Tugure  
**Date issued:** 2026-06-22  
**Scope:** Add Banjir (Flood), Gunung Api (Volcano), dan Kebakaran Hutan (Wildfire/Hotspot) as new monitored perils alongside the existing Earthquake layer, aligned with OJK (Otoritas Jasa Keuangan) Class of Business classification.

---

## Context — What This Project Is

Reinsurance Risk Monitor is a dashboard that PT Tugure's reinsurance underwriters use to monitor catastrophe events in Indonesia and the surrounding region in real-time. The system currently monitors:

- **Gempa Bumi (Earthquake):** via BMKG + USGS feeds, stored as `event_type = "earthquake"` in the `events` PostgreSQL table
- **Kapal (Vessels):** via AISStream WebSocket + VesselFinder REST, stored in `vessel_positions` table
- **Pesawat (Aircraft):** via OpenSky REST, stored in `aircraft_positions` table

The dashboard has a **Map page** that renders all three on a Leaflet map. You need to add three new peril layers to this same pipeline:

| Peril | Indonesian Name | OJK COB | `event_type` value | Data Source |
|-------|----------------|---------|-------------------|------------|
| Flood | Banjir | Harta Benda / Marine Cargo | `"flood"` | BMKG Cuaca / BNPB InfoBencana |
| Volcano | Gunung Api | Rekayasa / Properti | `"volcano"` | PVMBG MAGMA Indonesia API |
| Wildfire/Hotspot | Kebakaran Hutan | Harta Benda | `"wildfire"` | NASA FIRMS VIIRS/MODIS |

---

## Repository Layout

```
reinsurance-risk-monitor/
├── apps/
│   ├── api/                        # Go API server (Gin), port 8001
│   │   └── internal/http/          # Route handlers (events.go, assets.go, etc.)
│   ├── worker/                     # Python FastAPI worker, port 8002
│   │   ├── main.py                 # FastAPI app + schedulers + endpoints
│   │   ├── connectors/
│   │   │   ├── base.py             # BaseConnector ABC
│   │   │   ├── bmkg.py             # BMKG earthquake connector
│   │   │   ├── usgs.py             # USGS earthquake connector
│   │   │   ├── multi_source.py     # Merges BMKG + USGS with geo-routing
│   │   │   ├── aisstream.py        # AISStream WebSocket vessel connector
│   │   │   ├── opensky.py          # OpenSky aircraft REST connector
│   │   │   └── vesselfinder.py     # VesselFinder REST connector
│   │   ├── models/
│   │   │   └── event.py            # EarthquakeEvent Pydantic model
│   │   ├── normalizers/
│   │   │   └── bmkg.py             # BMKG JSON → EarthquakeEvent normalizer
│   │   ├── db/
│   │   │   ├── events.py           # upsert_events(), fetch_top_events()
│   │   │   ├── assets.py           # upsert_vessels(), upsert_aircraft()
│   │   │   ├── briefings.py        # save_briefing()
│   │   │   └── pool.py             # asyncpg pool management
│   │   ├── schedulers/
│   │   │   ├── ingest.py           # IngestScheduler (5 min interval)
│   │   │   ├── briefing.py         # BriefingScheduler (6 hr interval)
│   │   │   └── assets.py           # AssetScheduler (60s interval)
│   │   ├── scoring/
│   │   │   └── risk.py             # classify_severity(), score_events()
│   │   └── alerts.py               # evaluate_and_create_alerts()
│   └── web/                        # React 18 + TypeScript + Tailwind + Vite
│       └── src/
│           ├── lib/api/
│           │   ├── client.ts        # API types + fetch functions (events, alerts, etc.)
│           │   └── assets.ts        # Vessel + Aircraft types + fetch functions
│           └── features/map/
│               └── MapPage.tsx      # THE MAP PAGE — main target for frontend work
├── db/schema/
│   ├── 001_init.sql                # events, alerts, risk_scores tables
│   ├── 002_briefings.sql           # briefings table
│   ├── 003_exposure_rules.sql      # exposure_rules table
│   ├── 004_alerts_and_exposure_rule_extensions.sql
│   └── 005_assets_marine_aviation.sql  # vessel_positions, aircraft_positions tables
└── docker-compose.yml
```

---

## Existing Code Patterns — Follow These Exactly

### 1. `EarthquakeEvent` Pydantic model (`apps/worker/models/event.py`)

The `event_type` field is already generic — the same model handles all perils. **Do NOT create separate models for flood/volcano/wildfire.** Reuse `EarthquakeEvent` with the appropriate `event_type` value and sensible field mappings:

```python
class EarthquakeEvent(BaseModel):
    event_id: str = Field(description="Unique event identifier in canonical namespaced form.")
    source: str = Field(default="usgs")
    event_type: str = Field(default="earthquake")  # ← set to "flood", "volcano", "wildfire"
    magnitude: float = Field(default=0.0)           # ← map intensity/level/frp to this
    latitude: float
    longitude: float
    place: str = Field(default="")
    time: str                                        # ISO 8601 string
    url: str = Field(default="")
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
```

`magnitude` is repurposed per peril:
- **Flood:** alert level (1–4, where 4 = Siaga IV / highest)
- **Volcano:** activity level (1–4: Normal, Waspada, Siaga, Awas)
- **Wildfire:** Fire Radiative Power (FRP) in MW, clamped to 0–10 for display

### 2. `BaseConnector` ABC (`apps/worker/connectors/base.py`)

Every new connector must extend this:

```python
from abc import ABC, abstractmethod

class BaseConnector(ABC):
    @abstractmethod
    async def fetch_recent(self) -> list:
        """Fetch the most recent events from the upstream source."""
```

### 3. Existing `BMKGConnector` pattern (`apps/worker/connectors/bmkg.py`)

This is the canonical connector pattern. Mirror it exactly:

```python
class BMKGConnector(BaseConnector):
    BASE_URL = "https://data.bmkg.go.id/DataMKG/TEWS"

    def __init__(self, http_client: httpx.AsyncClient | None = None, timeout: float = 30.0):
        self._client = http_client
        self._timeout = timeout
        self._owns_client = http_client is None

    async def fetch_recent(self) -> list[EarthquakeEvent]:
        # ... fetch, normalize, de-duplicate, return list
        pass

    async def close(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _fetch_json(self, url: str) -> dict:
        client = self._client
        if client is None:
            client = httpx.AsyncClient(timeout=self._timeout)
            self._client = client
        response = await client.get(url)
        response.raise_for_status()
        return response.json()
```

### 4. `upsert_events` (`apps/worker/db/events.py`)

The `events` table already has `event_type VARCHAR(64)` — no schema migration needed. The upsert conflict key is `(source, event_id)`. New connectors write to the same table via the same `upsert_events()` function — no new DB functions needed.

```sql
-- events table (existing, 001_init.sql)
CREATE TABLE IF NOT EXISTS events (
    id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id     VARCHAR(255) NOT NULL,
    source       VARCHAR(64)  NOT NULL,   -- e.g. "bmkg_flood", "pvmbg", "nasa_firms"
    event_type   VARCHAR(64)  NOT NULL,   -- "earthquake" | "flood" | "volcano" | "wildfire"
    magnitude    FLOAT,
    latitude     FLOAT,
    longitude    FLOAT,
    place        TEXT,
    event_time   TIMESTAMPTZ,
    url          TEXT,
    severity     VARCHAR(32),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_events_source_event_id UNIQUE (source, event_id)
);
```

### 5. `classify_severity` (`apps/worker/scoring/risk.py`)

Currently uses magnitude thresholds tuned for earthquakes. You need to add peril-aware severity classification. **Do not break existing earthquake logic.** Add an `event_type` parameter and map appropriately:

```python
def classify_severity(magnitude: float, event_type: str = "earthquake") -> str:
    if event_type == "volcano":
        # magnitude = activity level 1-4
        if magnitude >= 4: return "Critical"   # Awas
        if magnitude >= 3: return "High"        # Siaga
        if magnitude >= 2: return "Moderate"    # Waspada
        return "Low"
    if event_type == "flood":
        # magnitude = BNPB/BMKG alert level 1-4
        if magnitude >= 3: return "Critical"
        if magnitude >= 2: return "High"
        return "Moderate"
    if event_type == "wildfire":
        # magnitude = FRP proxy (0-10 scale)
        if magnitude >= 7: return "Critical"
        if magnitude >= 4: return "High"
        if magnitude >= 2: return "Moderate"
        return "Low"
    # Default: earthquake
    if magnitude >= 6.0: return "Critical"
    if magnitude >= 5.0: return "High"
    if magnitude >= 4.0: return "Moderate"
    if magnitude >= 3.0: return "Low"
    return "Minor"
```

Update the call site in `db/events.py`:
```python
severity = classify_severity(event.magnitude, event.event_type)
```

### 6. Worker ingest integration (`apps/worker/main.py`)

The current `_ingest_cycle()` uses `MultiSourceConnector` (BMKG + USGS only). You need to extend it to also fetch flood/volcano/wildfire events in the same cycle:

```python
async def _ingest_cycle(pool: asyncpg.Pool) -> dict[str, int]:
    connector = MultiSourceConnector()          # existing: earthquake only
    hazard_connector = HazardConnector()        # new: flood + volcano + wildfire

    try:
        events = await connector.fetch_recent()
    finally:
        await connector.close()

    try:
        hazard_events = await hazard_connector.fetch_recent()
    finally:
        await hazard_connector.close()

    all_events = events + hazard_events
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

`HazardConnector` is a new multi-source connector (analogous to `MultiSourceConnector`) that owns three sub-connectors and merges their output.

### 7. Go API handler pattern (`apps/api/internal/http/events.go`)

The Go API serves all events from the `events` table via `GET /api/v1/events`. It already reads `event_type` from the DB and returns it in the JSON response. **No change to the Go API is needed** — the existing `eventsQuery` selects all rows without filtering by `event_type`, so new perils appear automatically.

If you want a filtered endpoint, follow this exact Go handler pattern:

```go
// Event mirrors a row of the events table.
type Event struct {
    ID        string    `json:"id"`
    EventID   string    `json:"event_id"`
    Source    string    `json:"source"`
    EventType string    `json:"event_type"`   // ← already present
    Magnitude float64   `json:"magnitude"`
    Latitude  float64   `json:"latitude"`
    Longitude float64   `json:"longitude"`
    Place     string    `json:"place"`
    EventTime time.Time `json:"event_time"`
    URL       string    `json:"url"`
    Severity  *string   `json:"severity"`
    CreatedAt time.Time `json:"created_at"`
}
```

### 8. Frontend API type (`apps/web/src/lib/api/client.ts`)

The `Event` type already has `event_type: string`. No change to the API client needed — all perils share the same type:

```typescript
export type Event = {
  id: string
  event_id: string
  source: string
  event_type: string      // "earthquake" | "flood" | "volcano" | "wildfire"
  magnitude: number
  latitude: number
  longitude: number
  place: string
  event_time: string
  url: string
  severity: string | null
  created_at: string
}
```

### 9. MapPage.tsx DivIcon pattern (`apps/web/src/features/map/MapPage.tsx`)

The Map page injects CSS once on mount via `<style id="map-animations">` in `document.head`. All markers use `L.DivIcon` with helper functions. The current pattern:

```typescript
function createEventIcon(magnitude: number): L.DivIcon {
  const color = magnitudeColor(magnitude)
  const size = Math.round(6 + magnitude * 1.8)
  const pulseClass = magnitude >= 7 ? 'pulse-critical' : magnitude >= 6 ? 'pulse-high' : magnitude >= 5 ? 'pulse-medium' : ''
  const spread = size * 5
  return L.divIcon({
    className: '',
    iconSize: [spread, spread],
    iconAnchor: [spread / 2, spread / 2],
    html: `<div class="event-dot ${pulseClass}" style="--color:${color};width:${size}px;height:${size}px;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)"></div>`,
  })
}
```

Layer toggles are a `Set<LayerToggle>` state variable:
```typescript
type LayerToggle = 'events' | 'vessels' | 'aircraft'
const [activeLayers, setActiveLayers] = useState<Set<LayerToggle>>(new Set(['events']))
```

The layers are rendered conditionally inside `<MapContainer>`:
```typescript
{activeLayers.has('events') && events.map((ev) => (
  <Marker key={ev.event_id} position={[ev.latitude, ev.longitude]} icon={createEventIcon(ev.magnitude)}>
    <Popup>...</Popup>
  </Marker>
))}
```

---

## Target Data APIs (Free, No Auth Required)

### A. Banjir (Flood) — BNPB / BMKG

**BNPB InfoBencana (primary):**
```
GET https://inarisk.bnpb.go.id/api/...
```
Note: BNPB API requires investigation. Use the **BMKG Prakiraan Cuaca / Peringatan Dini** as primary:

```
GET https://data.bmkg.go.id/DataMKG/MEWS/DigitalForecast/DigitalForecast-Indonesia.xml
```

Simpler alternative — **BNPB Dibi** RSS/JSON feeds or **GDACS** flood alerts:
```
GET https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=FL&fromDate=2024-01-01&toDate=2024-12-31
GET https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=FL&country=IDN
```

**Recommended: GDACS for flood** — JSON API, no auth, Indonesia-filtered:
```
GET https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=FL&country=IDN&limit=50
```

GDACS response fields to map:
- `eventid` → `event_id` (prefixed `gdacs_fl_`)
- `alertscore` (0-100) → `magnitude` (scale to 0-4)
- `latitude`, `longitude`
- `todate` → `time`
- `htmldescription` → `place`
- `url` → `url`

### B. Gunung Api (Volcano) — PVMBG MAGMA Indonesia

```
GET https://magma.esdm.go.id/api/v1/gunung-api/
GET https://magma.esdm.go.id/api/v1/vona/
```

MAGMA API (check current docs at https://magma.esdm.go.id). If the API requires auth, fall back to **GVP Smithsonian / GDACS volcano**:
```
GET https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=VO&country=IDN
```

GDACS volcano fields:
- `eventid` → `event_id` (prefixed `gdacs_vo_`)
- `alertlevel` (GREEN=1, ORANGE=2, RED=3) → `magnitude` (map: green=1, orange=3, red=4)
- `latitude`, `longitude`, `name` → `place`
- `todate` → `time`

### C. Kebakaran Hutan (Wildfire) — NASA FIRMS

**NASA FIRMS NRT API (no auth needed for CSV, JSON requires token):**

Use the **CSV endpoint** (no token required):
```
GET https://firms.modaps.eosdis.nasa.gov/api/country/csv/FIRMS_API_KEY/VIIRS_SNPP_NRT/IDN/1
```

If API key is required, use the **public active fire map data** via WMS or the **FIRMS archive CSV**. Best no-auth option:
```
GET https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_SouthEast_Asia_24h.csv
```

Filter by Indonesia bounding box (`lat: -12.0..8.0, lon: 92.0..142.0`).

FIRMS CSV columns: `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight`

Map to `EarthquakeEvent`:
- `event_id` = `f"firms_{acq_date}_{acq_time}_{lat:.3f}_{lon:.3f}"`
- `source` = `"nasa_firms"`
- `event_type` = `"wildfire"`
- `magnitude` = `min(frp / 50.0, 10.0)` (FRP in MW → 0-10 proxy scale)
- `latitude`, `longitude`
- `place` = `f"Hotspot {lat:.2f}°S {lon:.2f}°E"` (or reverse geocode if available)
- `time` = ISO string from `acq_date` + `acq_time`

**Important:** NASA FIRMS returns many hotspots (100s to 1000s). Filter to `confidence >= 70` and cap at 200 events per fetch.

---

## Implementation Tasks

### Sub-Project A — Backend: Three New Connectors + HazardConnector

**Files to create:**
- `apps/worker/connectors/gdacs_flood.py` — GDACS FL feed
- `apps/worker/connectors/gdacs_volcano.py` — GDACS VO feed  
- `apps/worker/connectors/nasa_firms.py` — NASA FIRMS CSV (Southeast Asia 24h)
- `apps/worker/connectors/hazard.py` — HazardConnector (owns the three above, merges output)
- `apps/worker/normalizers/gdacs.py` — GDACS JSON → EarthquakeEvent normalizer
- `apps/worker/normalizers/firms.py` — FIRMS CSV → EarthquakeEvent normalizer

**Files to modify:**
- `apps/worker/scoring/risk.py` — add `event_type` param to `classify_severity()`
- `apps/worker/db/events.py` — update `upsert_events` call to pass `event.event_type` to `classify_severity()`
- `apps/worker/main.py` — extend `_ingest_cycle()` to also call `HazardConnector`

**Tests to write:**
- `apps/worker/tests/connectors/test_gdacs_flood.py`
- `apps/worker/tests/connectors/test_gdacs_volcano.py`
- `apps/worker/tests/connectors/test_nasa_firms.py`
- `apps/worker/tests/connectors/test_hazard.py`
- `apps/worker/tests/scoring/test_risk_cob.py` — new peril severity classification

Existing test pattern: look at `apps/worker/tests/` for how BMKG/USGS tests are structured (mock `httpx` responses).

### Sub-Project B — Frontend: New Map Layers

**File to modify:** `apps/web/src/features/map/MapPage.tsx` (only this file)

Add three new layer toggles and DivIcon helper functions:

**Layer toggle type extension:**
```typescript
type LayerToggle = 'events' | 'vessels' | 'aircraft' | 'flood' | 'volcano' | 'wildfire'
```

**New state derived from the existing `events` state (no new API calls):**
```typescript
const floodEvents = useMemo(() => events.filter(e => e.event_type === 'flood'), [events])
const volcanoEvents = useMemo(() => events.filter(e => e.event_type === 'volcano'), [events])
const wildfireEvents = useMemo(() => events.filter(e => e.event_type === 'wildfire'), [events])
```

The existing `getEvents()` already fetches from `/api/v1/events` which returns ALL event types — no backend API changes needed.

**Icon specifications (add to `MAP_ANIMATION_CSS` and create helper functions):**

*Flood icon* (`createFloodIcon`):
- Color: `#3b82f6` (blue-500)
- Shape: SVG raindrop / water drop
- Level 3-4: `pulse-high` animation (same CSS class as earthquake high)
- Level 1-2: `pulse-medium` (breathe)
- Size: `iconSize: [24, 24]`, `iconAnchor: [12, 12]`

*Volcano icon* (`createVolcanoIcon`):
- Color: `#ef4444` (red-500) for active, `#6b7280` for normal
- Shape: SVG triangle (mountain silhouette) with eruption dot
- Level 4 (Awas): `pulse-critical` animation
- Level 3 (Siaga): `pulse-high`
- Level 2 (Waspada): `pulse-medium`
- Level 1 (Normal): static, grey #6b7280

*Wildfire icon* (`createWildfireIcon`):
- Color: `#f97316` (orange-500)
- Shape: SVG flame
- FRP proxy ≥ 7: `pulse-critical`
- FRP proxy ≥ 4: `pulse-high`
- FRP proxy ≥ 2: `pulse-medium`
- FRP proxy < 2: static, low opacity 0.5

**Layer toggle button labels:**
```typescript
layer === 'flood'    ? '🌊 Banjir'    :
layer === 'volcano'  ? '🌋 Gunung Api' :
layer === 'wildfire' ? '🔥 Kebakaran'  : ...
```

**Stats row extension:**
```typescript
const stats = useMemo(() => {
  const critical = events.filter((e) => e.event_type === 'earthquake' && e.magnitude >= 6).length
  return {
    total: events.filter(e => e.event_type === 'earthquake').length,
    critical,
    vessels: vessels.length,
    aircraft: aircraft.length,
    floods: floodEvents.length,
    volcanoes: volcanoEvents.length,
    wildfires: wildfireEvents.length,
  }
}, [events, vessels, aircraft, floodEvents, volcanoEvents, wildfireEvents])
```

Add `Stat` components for the three new perils in the header row.

### Sub-Project C — No database schema changes for hazard events

The `events` table already supports all new perils via `event_type VARCHAR(64)`. No new tables or migrations needed for flood/volcano/wildfire.

The Go API `events.go` already returns `event_type` and needs no changes for hazard events.

The alerting system (`apps/worker/alerts.py`) uses `event.magnitude` for threshold checks — it will automatically process new peril events at their mapped magnitude values. You may want to review alert thresholds but this is not required for MVP.

---

## Sub-Project D — RSS News Feed

### Overview

A parallel news ingestion pipeline that polls RSS feeds from Indonesian and international news sources every 15 minutes, stores headlines with peril tags in a new `news_items` table, exposes them via a Go API endpoint, and displays them in a collapsible side panel on the Map page.

### D1. Database Schema — New Migration

**Create `db/schema/006_news_items.sql`:**

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS news_items (
    id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_id      VARCHAR(512) NOT NULL,     -- deterministic: sha256(source + url)[:16]
    source       VARCHAR(64)  NOT NULL,     -- "antara" | "bnpb" | "bmkg" | "detik" | "kompas" | "tribun" | "reuters"
    title        TEXT         NOT NULL,
    summary      TEXT,
    url          TEXT,
    published_at TIMESTAMPTZ,
    perils       TEXT[]       NOT NULL DEFAULT '{}',  -- inferred tags: "earthquake","flood","volcano","wildfire"
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_news_source_item UNIQUE (source, item_id)
);

CREATE INDEX IF NOT EXISTS idx_news_published_at ON news_items (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_perils ON news_items USING GIN (perils);

COMMIT;
```

Apply this migration inside `db/init-db.sh` (or however existing migrations are applied — look at how `005_assets_marine_aviation.sql` is wired up and follow the same pattern).

### D2. RSS Sources and Feed URLs

| Source | `source` value | RSS URL | Notes |
|--------|---------------|---------|-------|
| ANTARA News | `"antara"` | `https://www.antaranews.com/rss/terkini.rss` | Berita terkini, authoritative |
| BNPB | `"bnpb"` | `https://bnpb.go.id/berita?format=feed&type=rss` | Rilis pers BNPB |
| BMKG | `"bmkg"` | `https://www.bmkg.go.id/berita/?tag=&p=rss` | Berita resmi BMKG |
| Detik | `"detik"` | `https://rss.detik.com/index.php/detikcom` | Portal berita utama |
| Kompas | `"kompas"` | `https://rss.kompas.com/` | Portal berita utama |
| Tribun | `"tribun"` | `https://rss.tribunnews.com/` | Coverage bencana luas |
| Reuters | `"reuters"` | `https://feeds.reuters.com/reuters/topNews` | International wire, English |

**Fallback:** If a feed URL returns 404 or is unreachable, log a warning and skip that source — do not crash the poll cycle.

**Note on Reuters:** Reuters has restricted some RSS endpoints. If `feeds.reuters.com` is unreachable, try `https://www.reutersagency.com/feed/?best-topics=political-general&post_type=best` as fallback. If both fail, skip gracefully.

### D3. Backend — RSS Connector (`apps/worker/connectors/rss_news.py`)

Parse RSS XML with Python stdlib `xml.etree.ElementTree` — **no new packages**.

```python
"""RSS news feed connector — parses standard RSS 2.0 feeds into NewsItem records."""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import xml.etree.ElementTree as ET

import httpx
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

PERIL_KEYWORDS: dict[str, list[str]] = {
    "earthquake": ["gempa", "seisme", "earthquake", "richter"],
    "flood": ["banjir", "banjir bandang", "banjir rob", "flood", "genangan", "luapan"],
    "volcano": ["gunung api", "erupsi", "letusan", "volcanic", "eruption", "magma", "lava"],
    "wildfire": ["kebakaran hutan", "karhutla", "kebakaran lahan", "hotspot", "wildfire", "forest fire"],
}


class NewsItem(BaseModel):
    item_id: str = Field(description="Deterministic 16-char hex ID from sha256(source+url)")
    source: str
    title: str
    summary: str = ""
    url: str = ""
    published_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    perils: list[str] = Field(default_factory=list)


def _make_item_id(source: str, url: str) -> str:
    return hashlib.sha256(f"{source}:{url}".encode()).hexdigest()[:16]


def _infer_perils(title: str, summary: str) -> list[str]:
    text = (title + " " + summary).lower()
    return [peril for peril, keywords in PERIL_KEYWORDS.items() if any(k in text for k in keywords)]


def _parse_rss(source: str, xml_text: str) -> list[NewsItem]:
    items: list[NewsItem] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        logger.warning("RSS parse error for %s: %s", source, exc)
        return []

    channel = root.find("channel")
    raw_items = channel.findall("item") if channel is not None else root.findall("entry")

    for item in raw_items[:50]:
        def get(tag: str, default: str = "") -> str:
            el = item.find(tag)
            return (el.text or default).strip() if el is not None else default

        title = get("title")
        url = get("link") or get("guid")
        if not title or not url:
            continue

        summary = get("description") or get("summary")
        pub_raw = get("pubDate") or get("published")
        try:
            pub_dt = parsedate_to_datetime(pub_raw) if pub_raw else datetime.now(timezone.utc)
        except Exception:
            pub_dt = datetime.now(timezone.utc)

        items.append(NewsItem(
            item_id=_make_item_id(source, url),
            source=source,
            title=title,
            summary=summary[:500],
            url=url,
            published_at=pub_dt.isoformat(),
            perils=_infer_perils(title, summary),
        ))

    return items


RSS_SOURCES: list[dict[str, str]] = [
    {"source": "antara",  "url": "https://www.antaranews.com/rss/terkini.rss"},
    {"source": "bnpb",    "url": "https://bnpb.go.id/berita?format=feed&type=rss"},
    {"source": "bmkg",    "url": "https://www.bmkg.go.id/berita/?tag=&p=rss"},
    {"source": "detik",   "url": "https://rss.detik.com/index.php/detikcom"},
    {"source": "kompas",  "url": "https://rss.kompas.com/"},
    {"source": "tribun",  "url": "https://rss.tribunnews.com/"},
    {"source": "reuters", "url": "https://feeds.reuters.com/reuters/topNews"},
]


class RSSNewsConnector:
    """Polls multiple RSS feeds, parses, and returns tagged NewsItem list."""

    def __init__(self, timeout: float = 20.0) -> None:
        self._timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def fetch_all(self) -> list[NewsItem]:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self._timeout, follow_redirects=True)

        all_items: list[NewsItem] = []
        for feed in RSS_SOURCES:
            try:
                response = await self._client.get(feed["url"])
                response.raise_for_status()
                items = _parse_rss(feed["source"], response.text)
                logger.info("RSS %s: %d items", feed["source"], len(items))
                all_items.extend(items)
            except Exception as exc:
                logger.warning("RSS feed %s failed: %s", feed["source"], exc)

        return all_items

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
```

### D4. DB Module (`apps/worker/db/news.py`)

```python
"""Persistence helpers for the news_items table."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Sequence

import asyncpg

logger = logging.getLogger(__name__)

_UPSERT_SQL = """
INSERT INTO news_items (item_id, source, title, summary, url, published_at, perils)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (source, item_id) DO UPDATE
SET
    title        = EXCLUDED.title,
    summary      = EXCLUDED.summary,
    published_at = EXCLUDED.published_at,
    perils       = EXCLUDED.perils
RETURNING id
"""

_FETCH_SQL = """
SELECT id, item_id, source, title, summary, url, published_at, perils, created_at
FROM news_items
ORDER BY published_at DESC NULLS LAST
LIMIT $1
"""


async def upsert_news_items(pool: asyncpg.Pool, items: Sequence) -> int:
    if not items:
        return 0
    upserted = 0
    async with pool.acquire() as conn:
        for item in items:
            pub = datetime.fromisoformat(item.published_at.replace("Z", "+00:00"))
            row = await conn.fetchrow(
                _UPSERT_SQL,
                item.item_id,
                item.source,
                item.title,
                item.summary,
                item.url,
                pub,
                item.perils,
            )
            if row is not None:
                upserted += 1
    logger.info("Upserted %d/%d news items", upserted, len(items))
    return upserted


async def fetch_news(pool: asyncpg.Pool, limit: int = 100) -> list[dict]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(_FETCH_SQL, limit)
    return [dict(r) for r in rows]
```

### D5. News Scheduler (`apps/worker/schedulers/news.py`)

Follow the exact same pattern as `schedulers/ingest.py`:

```python
"""Background scheduler for RSS news polling (every 15 minutes)."""
from __future__ import annotations
import asyncio
import logging
from typing import Callable, Awaitable

logger = logging.getLogger(__name__)

DEFAULT_INTERVAL = 15 * 60  # 15 minutes


class NewsScheduler:
    def __init__(self, poll_fn: Callable[[], Awaitable[int]], interval_seconds: int = DEFAULT_INTERVAL):
        self._poll_fn = poll_fn
        self._interval = interval_seconds
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._loop())
        logger.info("NewsScheduler started (interval=%ds)", self._interval)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _loop(self) -> None:
        while True:
            try:
                count = await self._poll_fn()
                logger.info("NewsScheduler: upserted %d items", count)
            except Exception as exc:
                logger.warning("NewsScheduler error: %s", exc)
            await asyncio.sleep(self._interval)
```

### D6. Wire into `main.py`

Add the following to `main.py` — following the exact same pattern as the existing schedulers:

```python
from connectors.rss_news import RSSNewsConnector
from db.news import upsert_news_items, fetch_news
from schedulers.news import NewsScheduler

# Module-level variable (add alongside _scheduler, _briefing_scheduler, etc.)
_news_scheduler: NewsScheduler | None = None


async def _news_poll_cycle() -> int:
    pool = get_pool()
    connector = RSSNewsConnector()
    try:
        items = await connector.fetch_all()
        return await upsert_news_items(pool, items)
    finally:
        await connector.close()


# In startup_event() — add after existing scheduler starts:
_news_scheduler = NewsScheduler(poll_fn=_news_poll_cycle)
_news_scheduler.start()

# In shutdown_event() — add alongside existing stops:
if _news_scheduler is not None:
    await _news_scheduler.stop()
    _news_scheduler = None
```

**New worker endpoint** (add to `main.py`):
```python
@app.get("/api/v1/worker/news")
async def worker_news_latest() -> dict:
    """Return most recent 100 news items from the news_items table."""
    try:
        pool = get_pool()
        rows = await fetch_news(pool, limit=100)
        for r in rows:
            for k, v in r.items():
                if hasattr(v, 'isoformat'):
                    r[k] = v.isoformat()
        return {"data": rows, "meta": {"count": len(rows)}}
    except Exception as exc:
        return {"data": [], "meta": {"count": 0}, "error": str(exc)}
```

### D7. Go API Handler (`apps/api/internal/http/news.go`)

Follow the exact pattern of `events.go`. Use `pq.Array` to scan the `TEXT[]` perils column:

```go
package http

import (
    "database/sql"
    "net/http"
    "time"

    "github.com/gin-gonic/gin"
    "github.com/lib/pq"
)

type NewsItem struct {
    ID          string     `json:"id"`
    ItemID      string     `json:"item_id"`
    Source      string     `json:"source"`
    Title       string     `json:"title"`
    Summary     string     `json:"summary"`
    URL         string     `json:"url"`
    PublishedAt *time.Time `json:"published_at"`
    Perils      []string   `json:"perils"`
    CreatedAt   time.Time  `json:"created_at"`
}

const newsQuery = `
SELECT id, item_id, source, title, summary, url, published_at, perils, created_at
FROM news_items
ORDER BY published_at DESC NULLS LAST
LIMIT 100
`

func News(db *sql.DB) gin.HandlerFunc {
    return func(c *gin.Context) {
        if db == nil {
            c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable"})
            return
        }
        rows, err := db.QueryContext(c.Request.Context(), newsQuery)
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        defer rows.Close()

        items := make([]NewsItem, 0, 100)
        for rows.Next() {
            var n NewsItem
            if err := rows.Scan(
                &n.ID, &n.ItemID, &n.Source, &n.Title,
                &n.Summary, &n.URL, &n.PublishedAt,
                pq.Array(&n.Perils), &n.CreatedAt,
            ); err != nil {
                c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
                return
            }
            items = append(items, n)
        }
        c.JSON(http.StatusOK, gin.H{"data": items, "meta": gin.H{"count": len(items)}})
    }
}
```

Register in the Go router (find where other handlers are registered — likely `apps/api/main.go` or an internal router file):
```go
v1.GET("/news", http.News(db))
```

### D8. Frontend API Type + Fetch Function (`apps/web/src/lib/api/client.ts`)

Add to the existing `client.ts` (the ONLY change to this file):

```typescript
export type NewsItem = {
  id: string
  item_id: string
  source: string
  title: string
  summary: string
  url: string
  published_at: string | null
  perils: string[]      // ["earthquake", "flood", "volcano", "wildfire"]
  created_at: string
}

export type NewsResponse = {
  data: NewsItem[]
  meta: { count: number }
}

export async function getNews(): Promise<NewsItem[]> {
  const res = await request<NewsResponse>('/news')
  return res.data
}
```

### D9. Frontend News Panel in `MapPage.tsx`

**New import** (add `getNews` and `NewsItem` to the existing import from `client.ts`):
```typescript
import { getEvents, getNews, type Event, type NewsItem } from '../../lib/api/client'
```

**New state** (add to `MapPage` component):
```typescript
const [news, setNews] = useState<NewsItem[]>([])
const [showNews, setShowNews] = useState(false)
```

**Extend `loadAll()`** — add `getNews()` to the existing `Promise.allSettled` call:
```typescript
const [ev, vs, ac, nw] = await Promise.allSettled([
  getEvents(),
  getVessels(),
  getAircraft(),
  getNews(),
])
if (ev.status === 'fulfilled') setEvents(ev.value)
if (vs.status === 'fulfilled') setVessels(vs.value)
if (ac.status === 'fulfilled') setAircraft(ac.value)
if (nw.status === 'fulfilled') setNews(nw.value)
```

**Filtered news** derived from active layers — news with no peril tags show regardless:
```typescript
const filteredNews = useMemo(() => {
  const activePerils = new Set<string>()
  if (activeLayers.has('events'))   activePerils.add('earthquake')
  if (activeLayers.has('flood'))    activePerils.add('flood')
  if (activeLayers.has('volcano'))  activePerils.add('volcano')
  if (activeLayers.has('wildfire')) activePerils.add('wildfire')

  const filtered = news.filter(n =>
    n.perils.length === 0 || n.perils.some(p => activePerils.has(p))
  )
  return filtered.slice(0, 30)
}, [news, activeLayers])
```

**Layout** — add 📰 toggle button to the layer toggles row, then wrap the map div with a flex container for the side panel:

```tsx
{/* Add to layer toggle row: */}
<button
  type='button'
  onClick={() => setShowNews(v => !v)}
  className={`ml-auto rounded-lg px-3 py-1.5 text-xs font-medium transition ${
    showNews
      ? 'bg-slate-700 text-slate-100 ring-1 ring-inset ring-slate-500'
      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
  }`}
>
  {`📰 Berita${news.length > 0 ? ` (${news.length})` : ''}`}
</button>

{/* Replace the existing outer map wrapper div with: */}
<div className='overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-slate-950/40'>
  <div style={{ display: 'flex', height: 'clamp(300px, 50vh, 600px)', position: 'relative' }}>

    {/* Map column */}
    <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
      {/* countdown bar — unchanged, position: absolute inside this div */}
      {/* MapContainer — unchanged */}
    </div>

    {/* News panel — conditional right sidebar */}
    {showNews && (
      <div
        style={{ width: '280px', overflowY: 'auto', borderLeft: '1px solid #1e293b' }}
        className='bg-slate-950 p-3'
      >
        <p className='mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400'>
          Berita Terkini
        </p>
        {filteredNews.length === 0 ? (
          <p className='text-xs text-slate-500'>Belum ada berita relevan.</p>
        ) : (
          <div className='space-y-3'>
            {filteredNews.map((item) => (
              <a
                key={item.id}
                href={item.url}
                target='_blank'
                rel='noopener noreferrer'
                className='block rounded-lg border border-slate-800 bg-slate-900 p-2.5 hover:border-slate-600 transition'
              >
                <div className='mb-1 flex items-center gap-1.5'>
                  <span className='text-[10px] font-semibold uppercase tracking-wide text-indigo-400'>
                    {item.source}
                  </span>
                  {item.perils.map((p) => (
                    <span key={p} className='text-[10px]'>
                      {p === 'earthquake' ? '🔴' : p === 'flood' ? '🌊' : p === 'volcano' ? '🌋' : '🔥'}
                    </span>
                  ))}
                </div>
                <p className='line-clamp-3 text-xs leading-snug text-slate-200'>{item.title}</p>
                {item.published_at && (
                  <p className='mt-1 text-[10px] text-slate-500'>
                    {new Date(item.published_at).toLocaleString('id-ID')}
                  </p>
                )}
              </a>
            ))}
          </div>
        )}
      </div>
    )}
  </div>
</div>
```

### D10. Tests for RSS module

**`apps/worker/tests/connectors/test_rss_news.py`:**

```python
import pytest
from connectors.rss_news import _parse_rss, _infer_perils, _make_item_id

SAMPLE_RSS = """<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Gempa M5.8 Guncang Sulawesi Tengah</title>
    <link>https://example.com/article/1</link>
    <description>BMKG melaporkan gempa bumi berkekuatan M5.8.</description>
    <pubDate>Mon, 22 Jun 2026 08:00:00 +0700</pubDate>
  </item>
  <item>
    <title>Banjir Bandang Terjang Kalimantan Barat</title>
    <link>https://example.com/article/2</link>
    <description>Banjir merendam ratusan rumah.</description>
    <pubDate>Mon, 22 Jun 2026 09:00:00 +0700</pubDate>
  </item>
</channel></rss>"""

def test_parse_rss_returns_two_items():
    items = _parse_rss("test", SAMPLE_RSS)
    assert len(items) == 2

def test_parse_rss_tags_earthquake():
    items = _parse_rss("test", SAMPLE_RSS)
    eq_item = next(i for i in items if "Gempa" in i.title)
    assert "earthquake" in eq_item.perils

def test_parse_rss_tags_flood():
    items = _parse_rss("test", SAMPLE_RSS)
    fl_item = next(i for i in items if "Banjir" in i.title)
    assert "flood" in fl_item.perils

def test_infer_perils_volcano():
    assert "volcano" in _infer_perils("Erupsi Gunung Semeru", "Lava mengalir ke pemukiman")

def test_infer_perils_wildfire():
    assert "wildfire" in _infer_perils("Karhutla di Riau", "kebakaran lahan gambut meluas")

def test_make_item_id_deterministic():
    id1 = _make_item_id("antara", "https://example.com/1")
    id2 = _make_item_id("antara", "https://example.com/1")
    assert id1 == id2 and len(id1) == 16

def test_make_item_id_different_sources():
    id1 = _make_item_id("antara", "https://example.com/1")
    id2 = _make_item_id("detik", "https://example.com/1")
    assert id1 != id2

def test_parse_rss_malformed_xml():
    assert _parse_rss("test", "<broken>") == []

def test_parse_rss_caps_at_50_items():
    many_items = "".join(
        f"<item><title>News {i}</title><link>https://ex.com/{i}</link></item>"
        for i in range(60)
    )
    xml = f"<rss version='2.0'><channel>{many_items}</channel></rss>"
    items = _parse_rss("test", xml)
    assert len(items) <= 50
```

---

## Sub-Project E — News Geolocation & Alert Corroboration

Full design spec: `docs/superpowers/specs/2026-06-22-news-geolocation.md`

Builds on Sub-Project D. Must be implemented **after** Task 9 (news_items table) and Task 10 (RSSNewsConnector) are complete.

### E1. `NewsItem` Pydantic model — extend with geolocation fields

In `apps/worker/connectors/rss_news.py`, add three optional fields to `NewsItem`:

```python
lat:        float | None = None   # set by locator after parse
lon:        float | None = None
place_name: str | None   = None
```

### E2. Database migrations

**Update `db/schema/006_news_items.sql`** — add columns (before any data exists, Hermes writes this fresh):
```sql
lat        FLOAT,
lon        FLOAT,
place_name TEXT
```

**Create `db/schema/007_news_alerts_extension.sql`:**
```sql
BEGIN;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS news_item_id UUID REFERENCES news_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_count  INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS geo_bucket    VARCHAR(64);

-- One active alert per geo_bucket (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_geo_bucket_active
  ON alerts (geo_bucket)
  WHERE acknowledged = FALSE AND geo_bucket IS NOT NULL;

-- Cache for Nominatim geocoding results
CREATE TABLE IF NOT EXISTS geocode_cache (
    query_text  TEXT         PRIMARY KEY,
    lat         FLOAT,
    lon         FLOAT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMIT;
```

Apply this migration the same way as `006_news_items.sql`.

### E3. Geocoding module (`apps/worker/geo/`)

**New package — three files:**

**`apps/worker/geo/gazetteer.py`** — static dict of ~120 Indonesian locations (34 provinces + major cities + active volcanoes) with `(lat, lon)`. Longest-match algorithm: sort keys by length descending, return first match.

```python
GAZETTEER: dict[str, tuple[float, float]] = {
    # Provinces
    "aceh": (4.695, 96.749), "sumatera utara": (2.115, 99.535), "sumut": (2.115, 99.535),
    "sumatera barat": (-0.739, 100.800), "sumbar": (-0.739, 100.800),
    "riau": (0.293, 101.707), "kepulauan riau": (3.946, 108.142), "kepri": (3.946, 108.142),
    "jambi": (-1.610, 103.616), "sumatera selatan": (-3.320, 104.915), "sumsel": (-3.320, 104.915),
    "bangka belitung": (-2.741, 106.441), "babel": (-2.741, 106.441),
    "bengkulu": (-3.793, 102.261), "lampung": (-4.558, 105.405), "banten": (-6.406, 106.064),
    "dki jakarta": (-6.211, 106.845), "jakarta": (-6.211, 106.845),
    "jawa barat": (-6.889, 107.640), "jabar": (-6.889, 107.640),
    "jawa tengah": (-7.150, 110.140), "jateng": (-7.150, 110.140),
    "di yogyakarta": (-7.795, 110.369), "yogyakarta": (-7.795, 110.369), "jogja": (-7.795, 110.369),
    "jawa timur": (-7.537, 112.238), "jatim": (-7.537, 112.238),
    "bali": (-8.409, 115.189), "nusa tenggara barat": (-8.652, 117.361), "ntb": (-8.652, 117.361),
    "lombok": (-8.650, 116.324), "nusa tenggara timur": (-8.657, 121.079), "ntt": (-8.657, 121.079),
    "flores": (-8.600, 121.000), "kalimantan barat": (-0.733, 109.717), "kalbar": (-0.733, 109.717),
    "kalimantan tengah": (-1.681, 113.382), "kalteng": (-1.681, 113.382),
    "kalimantan selatan": (-3.093, 115.283), "kalsel": (-3.093, 115.283),
    "kalimantan timur": (0.539, 116.419), "kaltim": (0.539, 116.419),
    "kalimantan utara": (3.073, 116.041), "kaltara": (3.073, 116.041),
    "sulawesi utara": (0.627, 124.021), "sulut": (0.627, 124.021),
    "gorontalo": (0.699, 122.446), "sulawesi tengah": (-1.431, 121.445), "sulteng": (-1.431, 121.445),
    "sulawesi barat": (-2.840, 119.232), "sulbar": (-2.840, 119.232),
    "sulawesi selatan": (-3.668, 119.974), "sulsel": (-3.668, 119.974),
    "sulawesi tenggara": (-4.145, 122.174), "sultra": (-4.145, 122.174),
    "maluku utara": (1.571, 127.808), "malut": (1.571, 127.808),
    "maluku": (-3.237, 130.145), "papua barat": (-1.336, 133.174), "papua": (-4.270, 138.080),
    # Major cities
    "banda aceh": (5.549, 95.323), "medan": (3.595, 98.672), "padang": (-0.950, 100.354),
    "pekanbaru": (0.507, 101.447), "batam": (1.045, 104.030), "palembang": (-2.976, 104.775),
    "bandar lampung": (-5.453, 105.262), "serang": (-6.120, 106.150),
    "bandung": (-6.921, 107.607), "semarang": (-6.967, 110.418),
    "surabaya": (-7.257, 112.752), "malang": (-7.983, 112.621),
    "denpasar": (-8.670, 115.212), "mataram": (-8.584, 116.118), "kupang": (-10.175, 123.608),
    "pontianak": (-0.020, 109.343), "palangkaraya": (-2.208, 113.921),
    "banjarmasin": (-3.321, 114.590), "samarinda": (-0.502, 117.154),
    "balikpapan": (-1.267, 116.829), "tarakan": (3.297, 117.636),
    "manado": (1.487, 124.845), "palu": (-0.899, 119.878), "donggala": (-0.769, 119.745),
    "sigi": (-1.367, 119.849), "poso": (-1.394, 120.754), "mamuju": (-2.675, 118.888),
    "makassar": (-5.147, 119.432), "kendari": (-3.945, 122.499),
    "ambon": (-3.695, 128.183), "ternate": (0.794, 127.381),
    "jayapura": (-2.534, 140.717), "manokwari": (-0.861, 134.062),
    "sorong": (-0.876, 131.255), "timika": (-4.529, 136.887),
    # Active volcanoes
    "merapi": (-7.541, 110.446), "semeru": (-8.108, 112.922), "agung": (-8.343, 115.508),
    "sinabung": (3.170, 98.392), "krakatau": (-6.102, 105.423), "bromo": (-7.942, 112.953),
    "rinjani": (-8.412, 116.467), "tambora": (-8.246, 117.994), "kelud": (-7.930, 112.308),
    "raung": (-8.125, 114.042), "soputan": (1.112, 124.726), "lokon": (1.358, 124.793),
    "ibu": (1.488, 127.630), "dukono": (1.693, 127.894), "gamalama": (0.800, 127.325),
}

_SORTED_KEYS = sorted(GAZETTEER.keys(), key=len, reverse=True)

def gazetteer_match(text: str) -> tuple[str, float, float] | None:
    t = text.lower()
    for key in _SORTED_KEYS:
        if key in t:
            lat, lon = GAZETTEER[key]
            return (key.title(), lat, lon)
    return None
```

**`apps/worker/geo/nominatim.py`** — async Nominatim client with DB-backed cache:

```python
"""Nominatim geocoder with geocode_cache DB table as persistent cache."""
import asyncio
import logging
import re
import asyncpg
import httpx

logger = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "tugure-risk-monitor/1.0 (setiyadijoko@gmail.com)"

# Regex patterns for Indonesian location extraction from news headlines
_PLACE_PATTERNS = [
    r"di ([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?)",
    r"([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?) dilanda",
    r"([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?) terdampak",
    r"([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?) diterjang",
]

def extract_candidate_place(text: str) -> str | None:
    for pattern in _PLACE_PATTERNS:
        m = re.search(pattern, text)
        if m:
            return m.group(1)
    return None

async def nominatim_geocode(
    place: str, pool: asyncpg.Pool
) -> tuple[str, float, float] | None:
    async with pool.acquire() as conn:
        cached = await conn.fetchrow(
            "SELECT lat, lon FROM geocode_cache WHERE query_text = $1", place
        )
        if cached:
            if cached["lat"] is None:
                return None  # known-bad entry
            return (place, cached["lat"], cached["lon"])

    await asyncio.sleep(1.0)  # Nominatim rate limit: 1 req/sec
    try:
        async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, timeout=10.0) as client:
            resp = await client.get(NOMINATIM_URL, params={
                "q": place, "countrycodes": "id", "format": "json", "limit": 1
            })
            resp.raise_for_status()
            results = resp.json()
    except Exception as exc:
        logger.warning("Nominatim failed for '%s': %s", place, exc)
        return None

    lat = float(results[0]["lat"]) if results else None
    lon = float(results[0]["lon"]) if results else None

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO geocode_cache (query_text, lat, lon) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
            place, lat, lon,
        )

    return (place, lat, lon) if lat is not None else None
```

**`apps/worker/geo/locator.py`** — orchestrator:

```python
"""Location extraction orchestrator: gazetteer → Nominatim fallback."""
from __future__ import annotations
import asyncpg
from geo.gazetteer import gazetteer_match
from geo.nominatim import extract_candidate_place, nominatim_geocode

async def extract_location(
    title: str, summary: str, pool: asyncpg.Pool | None = None
) -> tuple[str, float, float] | None:
    text = title + " " + summary
    result = gazetteer_match(text)
    if result:
        return result
    candidate = extract_candidate_place(title)  # title only — less noise than summary
    if candidate and pool:
        return await nominatim_geocode(candidate, pool)
    return None
```

**`apps/worker/geo/__init__.py`**: empty file.

### E4. Integrate geolocation into `_news_poll_cycle()` (`main.py`)

After `_parse_rss()` and before `upsert_news_items()`, call `extract_location()` for each item. The pool is already available at this point:

```python
from geo.locator import extract_location

async def _news_poll_cycle() -> int:
    pool = get_pool()
    connector = RSSNewsConnector()
    try:
        items = await connector.fetch_all()
    finally:
        await connector.close()

    # Geolocate each item before upsert
    for item in items:
        result = await extract_location(item.title, item.summary, pool)
        if result:
            item.place_name, item.lat, item.lon = result

    id_map = await upsert_news_items(pool, items)  # returns {item_id: db_uuid}

    for item in items:
        db_uuid = id_map.get(item.item_id)
        if item.lat is not None and db_uuid:
            await process_news_alerts(pool, item, db_uuid)

    return len(items)
```

### E5. Update `upsert_news_items()` to return id_map and persist lat/lon/place_name

`apps/worker/db/news.py` — update upsert SQL and return type:

```python
_UPSERT_SQL = """
INSERT INTO news_items (item_id, source, title, summary, url, published_at, perils, lat, lon, place_name)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (source, item_id) DO UPDATE
SET title=EXCLUDED.title, summary=EXCLUDED.summary,
    published_at=EXCLUDED.published_at, perils=EXCLUDED.perils,
    lat=EXCLUDED.lat, lon=EXCLUDED.lon, place_name=EXCLUDED.place_name
RETURNING id, item_id
"""

async def upsert_news_items(pool: asyncpg.Pool, items) -> dict[str, str]:
    """Upsert items and return {item_id_str: db_uuid_str}."""
    id_map: dict[str, str] = {}
    async with pool.acquire() as conn:
        for item in items:
            pub = datetime.fromisoformat(item.published_at.replace("Z", "+00:00"))
            row = await conn.fetchrow(
                _UPSERT_SQL,
                item.item_id, item.source, item.title, item.summary,
                item.url, pub, item.perils, item.lat, item.lon, item.place_name,
            )
            if row:
                id_map[row["item_id"]] = str(row["id"])
    return id_map
```

Also update `fetch_news()` to include `lat`, `lon`, `place_name` in SELECT.

### E6. `apps/worker/news_alerts.py` (new file)

```python
"""Create or deduplicate alerts from geolocated news items."""
from __future__ import annotations
import logging
import asyncpg

logger = logging.getLogger(__name__)

PERIL_SEVERITY: dict[str, str] = {
    "volcano": "Critical", "flood": "High", "wildfire": "High", "earthquake": "High",
}

def _geo_bucket(peril: str, lat: float, lon: float) -> str:
    return f"{peril}:{round(lat, 1)}:{round(lon, 1)}"

async def process_news_alerts(pool: asyncpg.Pool, news_item, db_uuid: str) -> None:
    """For each peril tag on a geolocated item: insert alert or increment source_count."""
    if news_item.lat is None or not news_item.perils:
        return

    async with pool.acquire() as conn:
        for peril in news_item.perils:
            bucket = _geo_bucket(peril, news_item.lat, news_item.lon)
            severity = PERIL_SEVERITY.get(peril, "High")

            existing = await conn.fetchrow(
                "SELECT id FROM alerts WHERE geo_bucket = $1 AND acknowledged = FALSE",
                bucket,
            )
            if existing:
                await conn.execute(
                    "UPDATE alerts SET source_count = source_count + 1 WHERE id = $1",
                    existing["id"],
                )
            else:
                await conn.execute(
                    """INSERT INTO alerts
                         (news_item_id, alert_type, severity, message, geo_bucket, source_count)
                       VALUES ($1::uuid, 'news_signal', $2, $3, $4, 1)
                       ON CONFLICT DO NOTHING""",
                    db_uuid, severity,
                    f"[{news_item.source.upper()}] {news_item.title[:200]}",
                    bucket,
                )
                logger.info("Created news_signal alert for bucket %s", bucket)
```

### E7. Update Go `NewsItem` struct and query (`apps/api/internal/http/news.go`)

```go
type NewsItem struct {
    ID          string     `json:"id"`
    ItemID      string     `json:"item_id"`
    Source      string     `json:"source"`
    Title       string     `json:"title"`
    Summary     string     `json:"summary"`
    URL         string     `json:"url"`
    PublishedAt *time.Time `json:"published_at"`
    Perils      []string   `json:"perils"`
    Lat         *float64   `json:"lat"`         // new
    Lon         *float64   `json:"lon"`         // new
    PlaceName   *string    `json:"place_name"`  // new
    CreatedAt   time.Time  `json:"created_at"`
}

const newsQuery = `
SELECT id, item_id, source, title, summary, url, published_at, perils, lat, lon, place_name, created_at
FROM news_items
ORDER BY published_at DESC NULLS LAST
LIMIT 100
`
// rows.Scan: add &n.Lat, &n.Lon, &n.PlaceName after pq.Array(&n.Perils)
```

### E8. Frontend — geolocation fields + map layer + corroboration (`MapPage.tsx` + `client.ts`)

**`apps/web/src/lib/api/client.ts`** — extend `NewsItem` type (add to the type defined in D8):
```typescript
lat:        number | null
lon:        number | null
place_name: string | null
```

**`apps/web/src/features/map/MapPage.tsx`** changes (on top of D9):

1. Add `'news_locations'` to `LayerToggle` type
2. Add toggle button `📍 Berita Lokasi`
3. Derive `geolocatedNews` memo:
```typescript
const geolocatedNews = useMemo(
  () => news.filter(n => n.lat != null && n.lon != null),
  [news]
)
```

4. Add `haversineKm` utility function and `correlatedEventIds` memo:
```typescript
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const correlatedEventIds = useMemo(() => {
  const ids = new Set<string>()
  for (const n of geolocatedNews) {
    for (const e of events) {
      if (n.perils.includes(e.event_type) &&
          haversineKm(n.lat!, n.lon!, e.latitude, e.longitude) < 50) {
        ids.add(e.event_id)
      }
    }
  }
  return ids
}, [geolocatedNews, events])
```

5. Add CSS to `MAP_ANIMATION_CSS` for corroboration ring:
```css
@keyframes corroborate-ring {
  0%, 100% { box-shadow: 0 0 0 2px rgba(255,255,255,0.9), 0 0 8px rgba(255,255,255,0.4); }
  50%       { box-shadow: 0 0 0 3px rgba(255,255,255,0.6), 0 0 14px rgba(255,255,255,0.2); }
}
.news-corroborated { animation: corroborate-ring 2s ease-in-out infinite; }
```

6. Hazard marker icons gain `news-corroborated` class when `correlatedEventIds.has(ev.event_id)` — pass `correlatedEventIds` into `createEventIcon`:
```typescript
function createEventIcon(magnitude: number, corroborated = false): L.DivIcon {
  // ... existing logic
  html: `<div class="event-dot ${pulseClass}${corroborated ? ' news-corroborated' : ''}" ...>`
}
// Call site:
icon={createEventIcon(ev.magnitude, correlatedEventIds.has(ev.event_id))}
```

7. Add `createNewsIcon` helper:
```typescript
function createNewsIcon(item: NewsItem): L.DivIcon {
  const emoji = item.perils[0] === 'earthquake' ? '🔴'
    : item.perils[0] === 'flood' ? '🌊'
    : item.perils[0] === 'volcano' ? '🌋'
    : item.perils[0] === 'wildfire' ? '🔥' : '📰'
  return L.divIcon({
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<div style="width:20px;height:20px;border-radius:4px;background:#1e293b;
                       border:1px solid #475569;display:flex;align-items:center;
                       justify-content:center;font-size:11px;
                       box-shadow:0 1px 4px rgba(0,0,0,0.6)">${emoji}</div>`,
  })
}
```

8. Render news markers inside `MapContainer`:
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

### E9. Tests

**`apps/worker/tests/geo/test_gazetteer.py`:**
```python
from geo.gazetteer import gazetteer_match

def test_exact_province():
    assert gazetteer_match("Gempa di Sulawesi Tengah") is not None

def test_abbreviation():
    place, lat, lon = gazetteer_match("Banjir terjang Kaltim")
    assert "kaltim" in place.lower() or abs(lat - 0.539) < 0.1

def test_volcano_name():
    result = gazetteer_match("Erupsi Gunung Merapi memuntahkan lava")
    assert result is not None
    place, lat, lon = result
    assert abs(lat - (-7.541)) < 0.1

def test_longest_match_wins():
    # "jawa tengah" should win over "jawa"
    place, lat, lon = gazetteer_match("Banjir di Jawa Tengah")
    assert "tengah" in place.lower()

def test_no_match_returns_none():
    assert gazetteer_match("Breaking news from New York") is None
```

**`apps/worker/tests/geo/test_locator.py`:**
```python
import pytest
from geo.locator import extract_location

@pytest.mark.asyncio
async def test_gazetteer_hit_no_pool_needed():
    result = await extract_location("Gempa guncang Palu", "", pool=None)
    assert result is not None
    place, lat, lon = result
    assert abs(lat - (-0.899)) < 0.1

@pytest.mark.asyncio
async def test_no_location_returns_none():
    result = await extract_location("Cuaca cerah hari ini", "", pool=None)
    assert result is None
```

**`apps/worker/tests/test_news_alerts.py`:**
```python
import pytest
from unittest.mock import AsyncMock, MagicMock
from news_alerts import _geo_bucket, process_news_alerts

def test_geo_bucket_format():
    assert _geo_bucket("flood", -0.899, 119.878) == "flood:-0.9:119.9"

def test_geo_bucket_rounds_correctly():
    assert _geo_bucket("volcano", -7.541, 110.446) == "volcano:-7.5:110.4"

@pytest.mark.asyncio
async def test_skips_item_without_lat():
    pool = AsyncMock()
    item = MagicMock(lat=None, perils=["flood"])
    await process_news_alerts(pool, item, "some-uuid")
    pool.acquire.assert_not_called()

@pytest.mark.asyncio
async def test_skips_item_without_perils():
    pool = AsyncMock()
    item = MagicMock(lat=-0.9, lon=119.9, perils=[])
    await process_news_alerts(pool, item, "some-uuid")
    pool.acquire.assert_not_called()
```

---

## Global Constraints

- **Python packages:** `httpx`, `pydantic`, `asyncpg`, `asyncio`, Python stdlib only. No `feedparser`, no `aiohttp`, no `pandas`. Parse RSS XML with `xml.etree.ElementTree`.
- **Zero new npm packages** — SVG icons inline, no icon libraries. `line-clamp-3` is a Tailwind v3 utility.
- **Go API changes:** Add `news.go` + register `GET /api/v1/news`. Update `NewsItem` struct with `Lat`, `Lon`, `PlaceName` nullable fields. No other Go changes.
- **DB migrations:** `006_news_items.sql` (news_items table with lat/lon/place_name) + `007_news_alerts_extension.sql` (extend alerts + geocode_cache). The `events` table has no changes.
- **Frontend files to modify:** `apps/web/src/features/map/MapPage.tsx` and `apps/web/src/lib/api/client.ts` only.
- **`EarthquakeEvent` is the only hazard model** — do not create `FloodEvent`, `VolcanoEvent`, etc.
- **Indonesia bounding box filter** for FIRMS: lat -12.0..8.0, lon 92.0..142.0.
- **FIRMS cap:** max 200 hotspots per fetch, confidence >= 70.
- **RSS cap:** max 50 items per feed per poll, `LIMIT 100` in DB fetch.
- **Nominatim rate limit:** 1 req/sec enforced via `asyncio.sleep(1.0)`. Required `User-Agent` header: `tugure-risk-monitor/1.0`.
- **`event_id` / `item_id` must be deterministic** for upsert idempotency.
- **All connectors, RSS fetchers, and geocoding tolerate failures gracefully** — per-source failure logs a warning but does not crash the cycle.
- **Follow TDD:** write failing tests first, then implement, then verify tests pass.
- **Commit after each task** with a descriptive message.

---

## Execution Instructions

You are implementing this feature in the repository at the current working directory. The repo uses:
- **Python** for `apps/worker` (FastAPI + asyncpg + httpx + Pydantic v2)
- **Go** for `apps/api` (Gin + `lib/pq` for PostgreSQL arrays)
- **TypeScript + React 18 + Tailwind CSS v3** for `apps/web`
- **PostgreSQL 16** (running via docker-compose)

Use `superpowers:subagent-driven-development` to execute this work task-by-task.

Recommended task decomposition:

**Sub-Project A — Hazard Connectors:**
1. **Task 1:** `GDACSFloodConnector` + normalizer + tests
2. **Task 2:** `GDACSVolcanoConnector` + normalizer + tests
3. **Task 3:** `NASAFIRMSConnector` + normalizer + tests
4. **Task 4:** `HazardConnector` (owns 1+2+3, merges output) + tests
5. **Task 5:** Extend `classify_severity()` with `event_type` param + update call site in `db/events.py` + tests
6. **Task 6:** Extend `_ingest_cycle()` in `main.py` to call `HazardConnector`

**Sub-Project B — Hazard Map Layers:**
7. **Task 7:** Frontend — add flood/volcano/wildfire `DivIcon` helpers + CSS + layer toggles to `MapPage.tsx`
8. **Task 8:** Frontend — extend stats row and layer toggle buttons for new perils

**Sub-Project D — RSS News Feed:**
9. **Task 9:** `db/schema/006_news_items.sql` (with lat/lon/place_name) + `apps/worker/db/news.py` returning id_map + tests
10. **Task 10:** `RSSNewsConnector` with `lat/lon/place_name` fields on `NewsItem` + `NewsScheduler` + tests
11. **Task 11:** Wire `NewsScheduler` + `_news_poll_cycle()` + `GET /api/v1/worker/news` into `main.py`
12. **Task 12:** Go API — `news.go` with lat/lon/place_name fields + register `GET /api/v1/news`
13. **Task 13:** Frontend — `NewsItem` type (with lat/lon/place_name) + `getNews()` in `client.ts`; side panel in `MapPage.tsx`

**Sub-Project E — News Geolocation & Alert Corroboration:**
14. **Task 14:** `db/schema/007_news_alerts_extension.sql` + migration applied
15. **Task 15:** `apps/worker/geo/` package — `gazetteer.py` + `nominatim.py` + `locator.py` + tests
16. **Task 16:** `apps/worker/news_alerts.py` (`process_news_alerts`) + tests
17. **Task 17:** Integrate `extract_location()` + `process_news_alerts()` into `_news_poll_cycle()` in `main.py`
18. **Task 18:** Frontend — `news_locations` layer toggle, `createNewsIcon`, `haversineKm`, `correlatedEventIds`, `news-corroborated` CSS + markers in `MapPage.tsx`

For each task: write failing tests → implement → verify tests pass → commit.

---

## Quick Verification After Implementation

After all tasks complete, verify end-to-end:

```bash
# 1. Trigger hazard ingest
curl -X POST http://localhost:8002/api/v1/worker/ingest

# 2. Trigger news poll (fetches + geocodes + creates alerts)
curl -X POST http://localhost:8002/api/v1/worker/news

# 3. Check events by type in DB
psql -c "SELECT event_type, count(*) FROM events GROUP BY event_type ORDER BY count DESC;"

# 4. Check news items with geolocation
psql -c "SELECT source, place_name, lat, lon, perils FROM news_items WHERE lat IS NOT NULL LIMIT 10;"

# 5. Check news_signal alerts created
psql -c "SELECT alert_type, severity, geo_bucket, source_count, message FROM alerts WHERE alert_type='news_signal' LIMIT 10;"

# 6. Check Go API endpoints
curl http://localhost:8001/api/v1/events | jq '[.data[] | .event_type] | group_by(.) | map({type: .[0], count: length})'
curl http://localhost:8001/api/v1/news | jq '[.data[] | select(.lat != null)] | length'
curl http://localhost:8001/api/v1/alerts | jq '[.data[] | select(.alert_type == "news_signal")] | length'
```

Expected after full implementation:
- DB `events`: rows with `event_type IN ('earthquake', 'flood', 'volcano', 'wildfire')`
- DB `news_items`: rows with `lat/lon/place_name` populated for ~50–70% of items (gazetteer hit rate)
- DB `alerts`: `news_signal` rows with `geo_bucket` and `source_count ≥ 1`
- Map page: layer toggles 🌊 Banjir, 🌋 Gunung Api, 🔥 Kebakaran, 📍 Berita Lokasi, 📰 Berita
- Map page: geolocated news appears as small square emoji markers; hazard markers near news sources pulse with white corroboration ring
