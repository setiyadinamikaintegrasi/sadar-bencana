# Dashboard Enrichment — Top Nav + Worldmonitor-Style Map + News Panel

**Date:** 2026-06-23
**Scope:** `apps/web` — Executive Overview page and app shell navigation

---

## Goals

Enrich the first page (Executive Overview) of the Reinsurance Risk Monitor with:
1. Top navigation bar replacing the left sidebar (worldmonitor.app-inspired)
2. Worldmonitor-style interactive risk map with animated critical event markers and peril layer toggles
3. News cards panel (from existing `/api/v1/news` API) with YouTube deep links per news item / event
4. Hybrid filter: news panel shows latest news by default; clicking an event in the watchlist filters news by peril + location

---

## Architecture

### Files Modified

| File | Change |
|------|--------|
| `apps/web/src/App.tsx` | Remove left sidebar, add `<TopNav>`, remove `md:ml-64` from layout, keep mobile bottom tabs unchanged |
| `apps/web/src/features/executive/ExecutiveOverview.tsx` | Add `news` state (from `getNews()`), `selectedEvent` state, `activePerilFilter` state; wire `RiskMap` + `NewsPanel` |

### New Components

| File | Purpose |
|------|---------|
| `apps/web/src/components/TopNav.tsx` | Desktop top navigation bar |
| `apps/web/src/components/RiskMap.tsx` | Enhanced Leaflet map with pulse rings, layer toggles, event click |
| `apps/web/src/components/NewsPanel.tsx` | News cards stack with YouTube deep link builder |

---

## Section 1: Top Navigation Bar (`TopNav.tsx`)

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  ◼ PT Tugure  Risk Monitor  │ Overview │ Map │ Events │ Alerts │ ··· ▾ │
└─────────────────────────────────────────────────────────────────┘
```

- Fixed at top, full-width, `z-10`
- Background: `slate-900`, border-bottom: `slate-800`
- Left: logo mark + "PT Tugure" label (indigo-400, 10px) + "Risk Monitor" title
- Center-left: primary tabs — Overview, Map, Events, Alerts
- Right: overflow dropdown `···` containing: Exposures, Claims, Briefing, AI Copilot, Source Health
- Active tab style: indigo underline (`border-b-2 border-indigo-400 text-indigo-300`)
- Inactive tab: `text-slate-400 hover:text-slate-100`
- Desktop only (`hidden md:flex`). Mobile keeps existing bottom tab bar.

### Props

```ts
interface TopNavProps {
  activeSection: string
  onNavigate: (section: string) => void
}
```

`string` digunakan (bukan `Section` type dari `App.tsx`) agar `TopNav` tidak tightly coupled ke type internal App.

### Primary tabs (always visible)
`Executive Overview`, `Map`, `Events`, `Alerts`

### Overflow tabs (in dropdown)
`Exposures`, `Claims`, `Briefing`, `AI Copilot`, `Source Health`

---

## Section 2: Executive Overview Layout

### Three-zone vertical layout

**Zone 1 — KPI Cards Row** (unchanged, 4 cards)

**Zone 2 — Two-column main area**
- Left column (`flex-1`): Priority Event Watchlist (existing table/mobile cards, unchanged logic)
- Right column (`w-[420px]` on xl, `w-full` below): stacked vertically:
  1. `RiskMap` — height `380px`
  2. `NewsPanel` — scrollable, max-height `400px`

**State added to `ExecutiveOverview`:**
```ts
const [news, setNews] = useState<NewsItem[]>([])
const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
const [activePerilFilter, setActivePerilFilter] = useState<string>('all')
```

News is loaded once on mount alongside events, using `getNews()` from the existing API client.

---

## Section 3: Worldmonitor-Style Risk Map (`RiskMap.tsx`)

### Props

```ts
interface RiskMapProps {
  events: Event[]
  activePerilFilter: string
  onFilterChange: (filter: string) => void
  onEventClick: (event: Event) => void
}
```

### Features

**Layer toggle buttons** — rendered inside map container, top-left overlay:
```
[Semua] [Gempa] [Banjir] [Angin]
```
Clicking filters which `CircleMarker` / `DivIcon` markers are visible.
Active button: `bg-indigo-500/30 text-indigo-200 ring-1 ring-indigo-400/40`
Inactive: `bg-slate-900/80 text-slate-400`

**Event type → peril mapping:**
```ts
const PERIL_MAP: Record<string, string> = {
  earthquake: 'Gempa',
  flood: 'Banjir',
  wind: 'Angin',
  storm: 'Angin',
  tsunami: 'Tsunami',
}
```

**Marker rendering:**
- M < 6: `CircleMarker` (existing logic, color from `magnitudeColor()`)
- M ≥ 6 (Critical): Leaflet `DivIcon` containing two overlapping divs:
  - Outer: pulse ring dengan inline CSS `animation: ping 1.5s cubic-bezier(0,0,0.2,1) infinite` (bukan Tailwind class — Leaflet DivIcon render di luar React tree sehingga Tailwind purge bisa membuang class `animate-ping`)
  - Inner: solid rose circle (12px)
  - Both absolute-positioned within a 24×24px container

**Popup on marker click:**
- Place, magnitude badge, event time
- Button "Lihat Berita" → calls `onEventClick(event)` which sets `selectedEvent` in parent, scrolling to news panel

**Map tile:** same dark CartoDB tile as current
**Height:** 380px (up from 320px)
**Center:** Indonesia `[-2.5, 118]`, zoom 4

---

## Section 4: News + Video Panel (`NewsPanel.tsx`)

### Props

```ts
interface NewsPanelProps {
  news: NewsItem[]
  selectedEvent: Event | null
  onClearSelection: () => void
}
```

### Filter logic

```ts
const filteredNews = useMemo(() => {
  if (!selectedEvent) return news.slice(0, 5)

  const eventPeril = selectedEvent.event_type?.toLowerCase() ?? ''
  const eventPlace = selectedEvent.place?.toLowerCase() ?? ''

  const scored = news.map((item) => {
    const perilMatch = item.perils.some((p) =>
      p.toLowerCase().includes(eventPeril) || eventPeril.includes(p.toLowerCase())
    )
    const placeMatch = item.place_name
      ? eventPlace.includes(item.place_name.toLowerCase()) ||
        item.place_name.toLowerCase().includes(eventPlace.split(',')[0].toLowerCase())
      : false
    return { item, score: (perilMatch ? 2 : 0) + (placeMatch ? 1 : 0) }
  })

  const relevant = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score)
  return relevant.length > 0 ? relevant.map((s) => s.item).slice(0, 5) : news.slice(0, 5)
}, [news, selectedEvent])
```

### YouTube deep link builder

```ts
function buildYouTubeQuery(item: NewsItem, selectedEvent: Event | null): string {
  const PERIL_QUERY_PREFIX: Record<string, string> = {
    earthquake: 'gempa bumi',
    flood: 'banjir',
    wind: 'angin topan',
    storm: 'angin topan',
    tsunami: 'tsunami',
  }

  if (selectedEvent) {
    const prefix = PERIL_QUERY_PREFIX[selectedEvent.event_type?.toLowerCase() ?? ''] ?? selectedEvent.event_type ?? ''
    const place = selectedEvent.place?.split(',')[0] ?? ''
    const mag = selectedEvent.magnitude.toFixed(1)
    return `${prefix} ${place} M${mag}`.trim()
  }

  const peril = item.perils[0] ?? ''
  const prefix = PERIL_QUERY_PREFIX[peril.toLowerCase()] ?? peril
  const place = item.place_name ?? ''
  return `${prefix} ${place}`.trim()
}

function buildYouTubeUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
}
```

### Card design (per `NewsItem`)

```
┌─────────────────────────────────────────────┐
│ [🔴 Gempa]  [Jakarta]   2 jam lalu          │
│ Judul berita dua baris maksimal...           │
│ Ringkasan singkat dua baris...               │
│                          [Baca ↗] [▶ YouTube]│
└─────────────────────────────────────────────┘
```

- Peril badge: colored by peril type (rose=gempa, blue=banjir, amber=angin, purple=tsunami)
- Place badge: `slate-700` background
- Title: `text-sm font-semibold text-slate-100 line-clamp-2`
- Summary: `text-xs text-slate-400 line-clamp-2`
- "Baca" button: opens `item.url` in new tab
- "▶ YouTube" button: opens YouTube search in new tab

### Panel header

When `selectedEvent` is set:
```
Berita terkait: M6.2 Aceh    [✕ Hapus filter]
```
When no selection:
```
Berita Risiko Terbaru
```

### Empty state

If `news.length === 0`: show skeleton loaders (3 cards) or "Belum ada berita tersedia."

---

## Peril Color Mapping

```ts
const PERIL_COLORS: Record<string, string> = {
  earthquake: 'bg-rose-500/15 text-rose-300 ring-rose-400/30',
  flood:      'bg-blue-500/15 text-blue-300 ring-blue-400/30',
  wind:       'bg-amber-500/15 text-amber-300 ring-amber-400/30',
  storm:      'bg-amber-500/15 text-amber-300 ring-amber-400/30',
  tsunami:    'bg-purple-500/15 text-purple-300 ring-purple-400/30',
}
const PERIL_DEFAULT = 'bg-slate-500/15 text-slate-300 ring-slate-400/30'
```

---

## Data Flow Summary

```
App.tsx
  └── TopNav (activeSection, onNavigate)
  └── ExecutiveOverview
        ├── load: getEvents() + getNews() on mount
        ├── state: events, news, selectedEvent, activePerilFilter
        │
        ├── KPI cards (unchanged)
        │
        ├── [Left] Watchlist table
        │     └── onRowClick → setSelectedEvent(event)
        │
        └── [Right column]
              ├── RiskMap
              │     props: events, activePerilFilter
              │     events: onFilterChange, onEventClick → setSelectedEvent
              │
              └── NewsPanel
                    props: news, selectedEvent
                    events: onClearSelection → setSelectedEvent(null)
```

---

## Out of Scope

- Embedding actual YouTube videos (requires YouTube Data API key — deferred)
- Changing any page other than `App.tsx` and `ExecutiveOverview.tsx` logic
- Backend API changes — `getNews()` already exists
- Mobile layout changes — bottom tab bar stays as-is

---

## Success Criteria

1. Desktop nav moves from left sidebar to top bar, all sections still navigable
2. Executive Overview shows enhanced map (380px, pulse rings on Critical, layer toggles)
3. News panel loads real data from `/api/v1/news` on page load
4. Clicking event in watchlist filters news panel and updates header label
5. Every news card has a working "▶ YouTube" deep link that opens correct search
6. Clearing filter restores "5 berita terbaru" view
7. No regressions on other pages (Map, Events, Alerts, Briefing, Copilot, Source Health)
