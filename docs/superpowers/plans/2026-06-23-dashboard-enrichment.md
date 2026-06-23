# Dashboard Enrichment — Top Nav + Worldmonitor Map + News Panel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the Executive Overview page with a top navigation bar, a worldmonitor-style interactive risk map with animated Critical event markers and peril layer toggles, and a news+YouTube panel fed by the existing `/api/v1/news` endpoint.

**Architecture:** `TopNav` replaces the left sidebar in `App.tsx`; `RiskMap` replaces the old mini-map; `NewsPanel` is a new component stacked below the map in the right column of `ExecutiveOverview`. State for `selectedEvent` and `activePerilFilter` lives in `ExecutiveOverview` and is passed as props to both new components.

**Tech Stack:** React 18, TypeScript, Tailwind CSS v3, Leaflet + react-leaflet v4, Vite — no new dependencies required.

## Global Constraints

- All files under `apps/web/src/`
- Dark theme: `slate-950` background, `slate-900` panels, `slate-800` borders — do not introduce light-mode classes
- Indonesian language for all user-visible labels (Semua, Gempa, Banjir, Angin, Lihat Berita, Hapus filter, Baca, dll.)
- No new npm packages — use only what is already in `apps/web/package.json`
- TypeScript strict mode is on — no `any`, no unused variables
- Verify with `cd apps/web && npx tsc --noEmit` after each task
- Mobile bottom tab bar in `App.tsx` must remain unchanged

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `apps/web/src/components/TopNav.tsx` | Desktop top navigation bar with primary tabs + overflow dropdown |
| Create | `apps/web/src/components/RiskMap.tsx` | Enhanced Leaflet map: layer toggle, pulse rings on Critical events, event click handler |
| Create | `apps/web/src/components/NewsPanel.tsx` | News cards from `/api/v1/news` with peril badges, relative timestamps, Baca link, YouTube deep link |
| Modify | `apps/web/src/App.tsx` | Remove left sidebar `<aside>`, add `<TopNav>`, change `md:ml-64` to `md:pt-14` |
| Modify | `apps/web/src/features/executive/ExecutiveOverview.tsx` | Add `news`/`newsLoading`/`selectedEvent`/`activePerilFilter` state; load `getNews()`; replace old map div with `<RiskMap>`+`<NewsPanel>`; add row click on watchlist |
| Modify | `apps/web/src/index.css` | Add `@keyframes rrm-ping` used by `RiskMap` pulse DivIcon |

---

## Task 1: TopNav Component + App.tsx Layout Refactor

**Files:**
- Create: `apps/web/src/components/TopNav.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Produces: `TopNav` — `({ activeSection: string, onNavigate: (section: string) => void }) => JSX.Element`
- Consumes: nothing from other tasks

---

- [ ] **Step 1: Create `TopNav.tsx`**

```tsx
// apps/web/src/components/TopNav.tsx
import { useState } from 'react'

const PRIMARY_TABS = [
  { label: 'Executive Overview', icon: '◼' },
  { label: 'Map', icon: '◉' },
  { label: 'Events', icon: '●' },
  { label: 'Alerts', icon: '◆' },
] as const

const OVERFLOW_TABS = [
  { label: 'Exposures', icon: '▲' },
  { label: 'Claims', icon: '■' },
  { label: 'Briefing', icon: '◇' },
  { label: 'AI Copilot', icon: '✦' },
  { label: 'Source Health', icon: '◈' },
] as const

interface TopNavProps {
  activeSection: string
  onNavigate: (section: string) => void
}

export default function TopNav({ activeSection, onNavigate }: TopNavProps) {
  const [overflowOpen, setOverflowOpen] = useState(false)
  const isOverflowActive = OVERFLOW_TABS.some((t) => t.label === activeSection)

  return (
    <header className="fixed inset-x-0 top-0 z-10 hidden border-b border-slate-800 bg-slate-900 md:flex md:h-14 md:items-center md:gap-0 md:px-6">
      {/* Logo */}
      <div className="flex flex-col border-r border-slate-800 py-3 pr-6 mr-2">
        <p className="text-[10px] font-semibold text-indigo-400">PT Tugure</p>
        <p className="text-sm font-semibold text-slate-50">Risk Monitor</p>
      </div>

      {/* Primary tabs */}
      <nav className="flex flex-1 items-stretch h-14">
        {PRIMARY_TABS.map((tab) => {
          const isActive = tab.label === activeSection
          return (
            <button
              key={tab.label}
              type="button"
              onClick={() => onNavigate(tab.label)}
              className={`flex items-center gap-2 border-b-2 px-4 text-sm font-medium transition ${
                isActive
                  ? 'border-indigo-400 text-indigo-300'
                  : 'border-transparent text-slate-400 hover:text-slate-100'
              }`}
            >
              <span className="text-xs">{tab.icon}</span>
              {tab.label}
            </button>
          )
        })}
      </nav>

      {/* Overflow dropdown */}
      <div className="relative h-14 flex items-stretch">
        <button
          type="button"
          onClick={() => setOverflowOpen((v) => !v)}
          className={`flex items-center gap-1 border-b-2 px-4 text-sm font-medium transition ${
            isOverflowActive || overflowOpen
              ? 'border-indigo-400 text-indigo-300'
              : 'border-transparent text-slate-400 hover:text-slate-100'
          }`}
        >
          ···
          <span className="text-[10px] ml-0.5">▾</span>
        </button>

        {overflowOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setOverflowOpen(false)}
            />
            <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border border-slate-700 bg-slate-900 py-2 shadow-2xl shadow-slate-950/60">
              {OVERFLOW_TABS.map((tab) => (
                <button
                  key={tab.label}
                  type="button"
                  onClick={() => {
                    onNavigate(tab.label)
                    setOverflowOpen(false)
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium transition ${
                    tab.label === activeSection
                      ? 'text-indigo-300'
                      : 'text-slate-300 hover:text-slate-100'
                  }`}
                >
                  <span className="text-xs text-slate-500">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Update `App.tsx`** — remove `<aside>` sidebar, add `<TopNav>`, replace `md:ml-64` with `md:pt-14`, remove desktop `<header>` (mobile header only)

Replace the entire file content:

```tsx
// apps/web/src/App.tsx
import { useState } from 'react'
import AlertsPage from './features/alerts/AlertsPage'
import BriefingPage from './features/briefing/BriefingPage'
import CopilotPage from './features/copilot/CopilotPage'
import EventsPage from './features/events/EventsPage'
import ExecutiveOverview from './features/executive/ExecutiveOverview'
import ExposuresPage from './features/exposures/ExposuresPage'
import MapPage from './features/map/MapPage'
import SourceHealthPage from './features/health/SourceHealthPage'
import TopNav from './components/TopNav'

const sections = [
  { label: 'Executive Overview', icon: '◼' },
  { label: 'Map', icon: '◉' },
  { label: 'Events', icon: '●' },
  { label: 'Exposures', icon: '▲' },
  { label: 'Alerts', icon: '◆' },
  { label: 'Claims', icon: '■' },
  { label: 'Briefing', icon: '◇' },
  { label: 'AI Copilot', icon: '✦' },
  { label: 'Source Health', icon: '◈' },
] as const

type Section = (typeof sections)[number]['label']

const bottomTabs = [
  { label: 'Overview', section: 'Executive Overview' as Section, icon: '◼' },
  { label: 'Map', section: 'Map' as Section, icon: '◉' },
  { label: 'Events', section: 'Events' as Section, icon: '●' },
  { label: 'Alerts', section: 'Alerts' as Section, icon: '◆' },
] as const

const moreSections: { label: string; section: Section; icon: string }[] = [
  { label: 'Exposures', section: 'Exposures', icon: '▲' },
  { label: 'Claims', section: 'Claims', icon: '■' },
  { label: 'Briefing', section: 'Briefing', icon: '◇' },
  { label: 'Source Health', section: 'Source Health', icon: '◈' },
]

function App() {
  const [activeSection, setActiveSection] = useState<Section>('Executive Overview')
  const [moreOpen, setMoreOpen] = useState(false)

  const navigate = (section: string) => {
    setActiveSection(section as Section)
    setMoreOpen(false)
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Desktop top nav — hidden on mobile */}
      <TopNav activeSection={activeSection} onNavigate={navigate} />

      {/* Main content */}
      <div className="flex min-h-screen flex-col md:pt-14">
        {/* Mobile-only header */}
        <header className="border-b border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur md:hidden">
          <h2 className="text-xl font-semibold text-slate-50">{activeSection}</h2>
        </header>

        <main className="flex-1 px-4 py-4 pb-24 md:px-8 md:py-8 md:pb-8">
          {activeSection === 'Executive Overview' ? (
            <ExecutiveOverview />
          ) : activeSection === 'Map' ? (
            <MapPage />
          ) : activeSection === 'Events' ? (
            <EventsPage />
          ) : activeSection === 'Exposures' ? (
            <ExposuresPage />
          ) : activeSection === 'Alerts' ? (
            <AlertsPage />
          ) : activeSection === 'Briefing' ? (
            <BriefingPage />
          ) : activeSection === 'AI Copilot' ? (
            <CopilotPage />
          ) : activeSection === 'Source Health' ? (
            <SourceHealthPage />
          ) : (
            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl shadow-slate-950/40">
              <p className="text-lg font-medium text-slate-100">{activeSection} — coming soon</p>
            </section>
          )}
        </main>
      </div>

      {/* Mobile bottom tab bar — unchanged */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-800 bg-slate-900 md:hidden">
        {bottomTabs.map((tab) => {
          const isActive = tab.section === activeSection
          return (
            <button
              key={tab.section}
              type="button"
              onClick={() => navigate(tab.section)}
              className={`flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition ${
                isActive ? 'text-indigo-300' : 'text-slate-500'
              }`}
            >
              <span className="text-base leading-none">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={`flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition ${
            moreSections.some((s) => s.section === activeSection) ? 'text-indigo-300' : 'text-slate-500'
          }`}
        >
          <span className="text-base leading-none">···</span>
          <span>More</span>
        </button>
      </nav>

      {/* More sheet */}
      {moreOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/60 md:hidden"
            onClick={() => setMoreOpen(false)}
          />
          <div className="fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-slate-800 bg-slate-900 p-6 md:hidden">
            <div className="space-y-2">
              {moreSections.map((item) => (
                <button
                  key={item.section}
                  type="button"
                  onClick={() => navigate(item.section)}
                  className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition ${
                    activeSection === item.section
                      ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-inset ring-indigo-400/40'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <span className="text-xs text-slate-500">{item.icon}</span>
                  <span>{item.section}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setMoreOpen(false)}
              className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-800 py-3 text-sm font-medium text-slate-300 transition hover:border-slate-600"
            >
              Tutup
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default App
```

- [ ] **Step 3: Type-check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Manual verify in browser**

```bash
cd apps/web && npm run dev
```

Open `http://localhost:3001`. Confirm:
- Left sidebar is gone on desktop
- Top nav bar appears with tabs: Overview, Map, Events, Alerts, and `···` dropdown
- Clicking each tab navigates to correct page
- Mobile: bottom tab bar still works, top nav is hidden

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/TopNav.tsx apps/web/src/App.tsx
git commit -m "feat: ganti sidebar kiri dengan top nav bar desktop"
```

---

## Task 2: Pulse Keyframe + RiskMap Component

**Files:**
- Modify: `apps/web/src/index.css`
- Create: `apps/web/src/components/RiskMap.tsx`

**Interfaces:**
- Consumes: `Event` type from `../../lib/api/client`
- Produces: `RiskMap` — `({ events: Event[], activePerilFilter: string, onFilterChange: (filter: string) => void, onEventClick: (event: Event) => void }) => JSX.Element`

---

- [ ] **Step 1: Add pulse keyframe to `index.css`**

Append to the end of `apps/web/src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@keyframes rrm-ping {
  75%, 100% {
    transform: scale(2.5);
    opacity: 0;
  }
}
```

- [ ] **Step 2: Create `RiskMap.tsx`**

```tsx
// apps/web/src/components/RiskMap.tsx
import { useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, Marker } from 'react-leaflet'
import L from 'leaflet'
import type { Event } from '../lib/api/client'

const INDONESIA_CENTER: [number, number] = [-2.5, 118]

const LAYER_FILTERS = [
  { key: 'all', label: 'Semua' },
  { key: 'earthquake', label: 'Gempa' },
  { key: 'flood', label: 'Banjir' },
  { key: 'wind', label: 'Angin' },
] as const

function magnitudeColor(mag: number): string {
  if (mag >= 7) return '#dc2626'
  if (mag >= 6) return '#f97316'
  if (mag >= 5) return '#eab308'
  return '#22c55e'
}

function createPulseIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `<div style="position:relative;width:24px;height:24px;">
      <div style="position:absolute;inset:0;border-radius:9999px;background:${color};opacity:0.35;animation:rrm-ping 1.5s cubic-bezier(0,0,0.2,1) infinite;"></div>
      <div style="position:absolute;top:6px;left:6px;width:12px;height:12px;border-radius:9999px;background:${color};"></div>
    </div>`,
  })
}

interface RiskMapProps {
  events: Event[]
  activePerilFilter: string
  onFilterChange: (filter: string) => void
  onEventClick: (event: Event) => void
}

export default function RiskMap({
  events,
  activePerilFilter,
  onFilterChange,
  onEventClick,
}: RiskMapProps) {
  const visibleEvents = useMemo(() => {
    if (activePerilFilter === 'all') return events
    return events.filter((e) => {
      const type = (e.event_type ?? '').toLowerCase()
      if (activePerilFilter === 'earthquake') return type.includes('earthquake') || type.includes('quake')
      if (activePerilFilter === 'flood') return type.includes('flood')
      if (activePerilFilter === 'wind') return type.includes('wind') || type.includes('storm') || type.includes('cyclone')
      return false
    })
  }, [events, activePerilFilter])

  return (
    <div className="relative">
      {/* Layer toggle buttons — overlaid on map top-left */}
      <div className="absolute left-2 top-2 z-[400] flex flex-wrap gap-1">
        {LAYER_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => onFilterChange(f.key)}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
              activePerilFilter === f.key
                ? 'bg-indigo-500/30 text-indigo-200 ring-1 ring-inset ring-indigo-400/40'
                : 'bg-slate-900/80 text-slate-400 hover:text-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div
        className="overflow-hidden rounded-xl border border-slate-800"
        style={{ height: '380px' }}
      >
        <MapContainer
          center={INDONESIA_CENTER}
          zoom={4}
          scrollWheelZoom={false}
          zoomControl={false}
          attributionControl={false}
          style={{ height: '100%', width: '100%', background: '#0f172a' }}
        >
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />

          {visibleEvents.map((ev) => {
            const isCritical = ev.magnitude >= 6
            const color = magnitudeColor(ev.magnitude)

            const popupContent = (
              <Popup>
                <div style={{ minWidth: '160px' }}>
                  <strong>
                    M{ev.magnitude.toFixed(1)} — {ev.place}
                  </strong>
                  <br />
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                    {new Date(ev.event_time).toLocaleString('id-ID')}
                  </span>
                  <br />
                  <button
                    onClick={() => onEventClick(ev)}
                    style={{
                      marginTop: '8px',
                      color: '#818cf8',
                      cursor: 'pointer',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      fontSize: '12px',
                    }}
                  >
                    Lihat Berita →
                  </button>
                </div>
              </Popup>
            )

            if (isCritical) {
              return (
                <Marker
                  key={ev.event_id}
                  position={[ev.latitude, ev.longitude]}
                  icon={createPulseIcon(color)}
                >
                  {popupContent}
                </Marker>
              )
            }

            return (
              <CircleMarker
                key={ev.event_id}
                center={[ev.latitude, ev.longitude]}
                radius={3 + ev.magnitude * 1.2}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: 0.65,
                  weight: 1,
                }}
              >
                {popupContent}
              </CircleMarker>
            )
          })}
        </MapContainer>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit** (component ready for wiring in Task 4)

```bash
git add apps/web/src/index.css apps/web/src/components/RiskMap.tsx
git commit -m "feat: tambah RiskMap dengan animated pulse dan layer toggle"
```

---

## Task 3: NewsPanel Component

**Files:**
- Create: `apps/web/src/components/NewsPanel.tsx`

**Interfaces:**
- Consumes: `Event`, `NewsItem` types from `../lib/api/client`
- Produces: `NewsPanel` — `({ news: NewsItem[], loading: boolean, selectedEvent: Event | null, onClearSelection: () => void }) => JSX.Element`

---

- [ ] **Step 1: Create `NewsPanel.tsx`**

```tsx
// apps/web/src/components/NewsPanel.tsx
import { useMemo } from 'react'
import type { Event, NewsItem } from '../lib/api/client'

const PERIL_COLORS: Record<string, string> = {
  earthquake: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-400/30',
  flood: 'bg-blue-500/15 text-blue-300 ring-1 ring-inset ring-blue-400/30',
  wind: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/30',
  storm: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/30',
  tsunami: 'bg-purple-500/15 text-purple-300 ring-1 ring-inset ring-purple-400/30',
}
const PERIL_COLOR_DEFAULT = 'bg-slate-500/15 text-slate-300 ring-1 ring-inset ring-slate-400/30'

const PERIL_LABELS: Record<string, string> = {
  earthquake: 'Gempa',
  flood: 'Banjir',
  wind: 'Angin',
  storm: 'Angin',
  tsunami: 'Tsunami',
}

const PERIL_QUERY_PREFIX: Record<string, string> = {
  earthquake: 'gempa bumi',
  flood: 'banjir',
  wind: 'angin topan',
  storm: 'angin topan',
  tsunami: 'tsunami',
}

function buildYouTubeUrl(item: NewsItem, selectedEvent: Event | null): string {
  let query: string
  if (selectedEvent) {
    const type = (selectedEvent.event_type ?? '').toLowerCase()
    const prefix = PERIL_QUERY_PREFIX[type] ?? selectedEvent.event_type ?? 'bencana'
    const place = selectedEvent.place?.split(',')[0] ?? ''
    const mag = selectedEvent.magnitude.toFixed(1)
    query = `${prefix} ${place} M${mag}`.trim()
  } else {
    const peril = (item.perils[0] ?? '').toLowerCase()
    const prefix = PERIL_QUERY_PREFIX[peril] ?? peril
    const place = item.place_name ?? ''
    query = `${prefix} ${place}`.trim()
  }
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 1) return 'Baru saja'
  if (hours < 24) return `${hours} jam lalu`
  const days = Math.floor(hours / 24)
  return `${days} hari lalu`
}

interface NewsPanelProps {
  news: NewsItem[]
  loading: boolean
  selectedEvent: Event | null
  onClearSelection: () => void
}

export default function NewsPanel({
  news,
  loading,
  selectedEvent,
  onClearSelection,
}: NewsPanelProps) {
  const filteredNews = useMemo(() => {
    if (!selectedEvent) return news.slice(0, 5)

    const eventPeril = (selectedEvent.event_type ?? '').toLowerCase()
    const eventPlace = (selectedEvent.place ?? '').toLowerCase()

    const scored = news.map((item) => {
      const perilMatch = item.perils.some(
        (p) =>
          p.toLowerCase().includes(eventPeril) ||
          eventPeril.includes(p.toLowerCase()),
      )
      const placeMatch = item.place_name
        ? eventPlace.includes(item.place_name.toLowerCase()) ||
          item.place_name.toLowerCase().includes(eventPlace.split(',')[0].toLowerCase())
        : false
      return { item, score: (perilMatch ? 2 : 0) + (placeMatch ? 1 : 0) }
    })

    const relevant = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)

    return relevant.length > 0
      ? relevant.map((s) => s.item).slice(0, 5)
      : news.slice(0, 5)
  }, [news, selectedEvent])

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        {selectedEvent ? (
          <>
            <p className="text-xs font-semibold text-slate-300">
              Berita terkait:{' '}
              <span className="text-indigo-300">
                M{selectedEvent.magnitude.toFixed(1)} {selectedEvent.place?.split(',')[0]}
              </span>
            </p>
            <button
              type="button"
              onClick={onClearSelection}
              className="text-xs text-slate-500 transition hover:text-slate-300"
            >
              ✕ Hapus filter
            </button>
          </>
        ) : (
          <p className="text-xs font-semibold text-slate-400">Berita Risiko Terbaru</p>
        )}
      </div>

      {/* Cards */}
      <div className="max-h-[360px] divide-y divide-slate-800 overflow-y-auto">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2 p-4">
              <div className="h-3 w-20 animate-pulse rounded bg-slate-800" />
              <div className="h-4 w-full animate-pulse rounded bg-slate-800" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-slate-800" />
            </div>
          ))
        ) : filteredNews.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">
            Belum ada berita tersedia.
          </div>
        ) : (
          filteredNews.map((item) => {
            const peril = (item.perils[0] ?? '').toLowerCase()
            const perilColor = PERIL_COLORS[peril] ?? PERIL_COLOR_DEFAULT
            const perilLabel = PERIL_LABELS[peril] ?? item.perils[0] ?? 'Risiko'

            return (
              <article key={item.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${perilColor}`}
                  >
                    {perilLabel}
                  </span>
                  {item.place_name && (
                    <span className="text-[10px] text-slate-500">{item.place_name}</span>
                  )}
                  <span className="ml-auto text-[10px] text-slate-600">
                    {formatRelativeTime(item.published_at)}
                  </span>
                </div>

                <p className="line-clamp-2 text-sm font-semibold text-slate-100">
                  {item.title}
                </p>

                {item.summary && (
                  <p className="line-clamp-2 text-xs text-slate-400">{item.summary}</p>
                )}

                <div className="flex items-center gap-3 pt-1">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo-400 transition hover:text-indigo-300"
                  >
                    Baca ↗
                  </a>
                  <a
                    href={buildYouTubeUrl(item, selectedEvent)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-rose-400 transition hover:text-rose-300"
                  >
                    ▶ YouTube
                  </a>
                </div>
              </article>
            )
          })
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/NewsPanel.tsx
git commit -m "feat: tambah NewsPanel dengan hybrid filter dan YouTube deep link"
```

---

## Task 4: Wire ExecutiveOverview — Map + News State

**Files:**
- Modify: `apps/web/src/features/executive/ExecutiveOverview.tsx`

**Interfaces:**
- Consumes: `RiskMap` from `../../components/RiskMap`
- Consumes: `NewsPanel` from `../../components/NewsPanel`
- Consumes: `getNews`, `NewsItem` from `../../lib/api/client`

---

- [ ] **Step 1: Replace `ExecutiveOverview.tsx`**

Replace the entire file:

```tsx
// apps/web/src/features/executive/ExecutiveOverview.tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import SourceBadge from '../../components/SourceBadge'
import MagnitudeFilter from '../../components/MagnitudeFilter'
import RiskMap from '../../components/RiskMap'
import NewsPanel from '../../components/NewsPanel'
import { getEvents, getMeta, getNews, type Event, type Meta, type NewsItem } from '../../lib/api/client'

type Severity = 'Critical' | 'High' | 'Medium' | 'Low'

const severityClasses: Record<Severity, string> = {
  Low: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30',
  Medium: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/30',
  High: 'bg-orange-500/15 text-orange-300 ring-1 ring-inset ring-orange-400/30',
  Critical: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-400/30',
}

function severityFor(magnitude: number): Severity {
  if (magnitude >= 6) return 'Critical'
  if (magnitude >= 5) return 'High'
  if (magnitude >= 4) return 'Medium'
  return 'Low'
}

export default function ExecutiveOverview() {
  const [events, setEvents] = useState<Event[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [newsLoading, setNewsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [minMagnitude, setMinMagnitude] = useState(0)
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [activePerilFilter, setActivePerilFilter] = useState('all')

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const [eventsData, metaData] = await Promise.all([getEvents(), getMeta()])
      setEvents(eventsData)
      setMeta(metaData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data.')
    } finally {
      if (mode === 'initial') setLoading(false)
      else setRefreshing(false)
    }
  }, [])

  const loadNews = useCallback(async () => {
    setNewsLoading(true)
    try {
      const data = await getNews()
      setNews(data)
    } catch {
      // News failure is non-blocking — panel shows empty state
    } finally {
      setNewsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load('initial')
    void loadNews()
  }, [load, loadNews])

  const handleRefresh = useCallback(() => {
    void load('refresh')
    void loadNews()
  }, [load, loadNews])

  const handleEventClick = useCallback((event: Event) => {
    setSelectedEvent(event)
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelectedEvent(null)
  }, [])

  const filteredEvents = useMemo(
    () => events.filter((e) => e.magnitude >= minMagnitude),
    [events, minMagnitude],
  )

  const kpis = useMemo(() => {
    const maxMagnitude =
      events.length > 0 ? Math.max(...events.map((e) => e.magnitude)).toFixed(1) : '—'
    const topSource = events.length > 0 ? events[0].source.toUpperCase() : '—'
    return [
      {
        label: 'Active Events',
        value: events.length.toString(),
        caption: 'Catastrophe events currently ingested into the monitor.',
      },
      {
        label: 'Max Magnitude',
        value: maxMagnitude,
        caption: 'Strongest event magnitude across the active set.',
      },
      {
        label: 'Top Source',
        value: topSource,
        caption: 'Primary ingest source feeding the current watchlist.',
      },
      {
        label: 'API Status',
        value: meta ? 'Connected' : 'Offline',
        caption: meta
          ? `${meta.service} · ${meta.environment} · v${meta.version}`
          : 'Backend unreachable. Check that the API service is running.',
      },
    ]
  }, [events, meta])

  return (
    <div className="space-y-8">
      {/* KPI cards */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {kpis.map((item) => (
          <article
            key={item.label}
            className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40"
          >
            <p className="text-[11px] font-medium text-slate-500 leading-none">{item.label}</p>
            <p className="mt-4 text-4xl font-bold text-slate-50">{item.value}</p>
            <p className="mt-3 text-sm text-slate-400">{item.caption}</p>
          </article>
        ))}
      </section>

      {/* Main two-column area */}
      <section className="grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        {/* Left — Watchlist */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-6">
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <h3 className="text-xl font-semibold text-slate-50">Priority Event Watchlist</h3>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <MagnitudeFilter value={minMagnitude} onChange={setMinMagnitude} />
              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading || refreshing}
                className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-indigo-400 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-400">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400" />
              Loading events...
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-6 text-sm text-rose-200">
              <p className="font-semibold text-rose-100">Failed to load events</p>
              <p className="mt-2 break-words text-rose-300/80">{error}</p>
              <p className="mt-3 text-rose-300/60">
                Verify the API is running and reachable via the Vite proxy.
              </p>
            </div>
          ) : events.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-800/50 p-8 text-center">
              <p className="text-sm font-medium text-slate-200">No events ingested yet</p>
              <p className="mt-2 text-sm text-slate-400">
                Trigger an ingest run via{' '}
                <code className="rounded bg-slate-900 px-1.5 py-0.5 text-xs text-indigo-300">
                  POST /api/v1/worker/ingest
                </code>{' '}
                to populate the watchlist.
              </p>
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-800/50 p-8 text-center">
              <p className="text-sm font-medium text-slate-200">No events match this magnitude filter</p>
              <p className="mt-2 text-sm text-slate-400">
                Lower the minimum magnitude to show more watchlist events.
              </p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="pb-3 pr-6 font-medium">Event</th>
                      <th className="pb-3 pr-6 font-medium">Severity</th>
                      <th className="pb-3 pr-6 font-medium">Source</th>
                      <th className="pb-3 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredEvents.map((row) => {
                      const severity = severityFor(row.magnitude)
                      const isSelected = selectedEvent?.id === row.id
                      return (
                        <tr
                          key={row.id}
                          className={`cursor-pointer text-slate-200 transition hover:bg-slate-800/50 ${
                            isSelected ? 'bg-indigo-500/10 ring-1 ring-inset ring-indigo-400/20' : ''
                          }`}
                          onClick={() => handleEventClick(row)}
                        >
                          <td className="py-4 pr-6">{row.place}</td>
                          <td className="py-4 pr-6">
                            <span
                              className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${severityClasses[severity]}`}
                            >
                              {severity}
                            </span>
                          </td>
                          <td className="py-4 pr-6 align-top">
                            <SourceBadge source={row.source} timestamp={row.created_at} />
                          </td>
                          <td className="py-4 pr-6 text-slate-400">
                            {new Date(row.event_time).toLocaleString()}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile card list */}
              <div className="space-y-3 md:hidden">
                {filteredEvents.map((row) => {
                  const severity = severityFor(row.magnitude)
                  const isSelected = selectedEvent?.id === row.id
                  return (
                    <article
                      key={row.id}
                      className={`rounded-xl border border-slate-800 bg-slate-800/50 p-4 cursor-pointer transition ${
                        isSelected ? 'ring-1 ring-indigo-400/40' : ''
                      }`}
                      onClick={() => handleEventClick(row)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${severityClasses[severity]}`}
                        >
                          {severity}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-medium text-slate-100">{row.place}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-700 pt-3">
                        <SourceBadge source={row.source} timestamp={row.created_at} />
                        <span className="text-xs text-slate-400">
                          {new Date(row.event_time).toLocaleString()}
                        </span>
                      </div>
                    </article>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Right column — Map + News */}
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-300">Peta Risiko</p>
              {events.length > 0 && (
                <span className="text-xs text-slate-500">{events.length} events</span>
              )}
            </div>

            {loading ? (
              <div
                className="flex items-center justify-center gap-3 rounded-xl border border-slate-800 text-sm text-slate-400"
                style={{ height: '380px' }}
              >
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400" />
                Loading map…
              </div>
            ) : (
              <RiskMap
                events={events}
                activePerilFilter={activePerilFilter}
                onFilterChange={setActivePerilFilter}
                onEventClick={handleEventClick}
              />
            )}
          </div>

          <NewsPanel
            news={news}
            loading={newsLoading}
            selectedEvent={selectedEvent}
            onClearSelection={handleClearSelection}
          />
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual verify in browser**

```bash
cd apps/web && npm run dev
```

Open `http://localhost:3001`. Verify all success criteria:

1. Desktop top nav visible, left sidebar gone
2. Executive Overview shows 4 KPI cards at top
3. Map is 380px tall, dark tile, layer toggle buttons (Semua/Gempa/Banjir/Angin) visible top-left
4. Critical events (M≥6) show animated pulse ring; M<5 events show plain circle
5. Clicking layer toggle filters visible markers
6. News panel below map shows cards with peril badge, title, "Baca ↗" and "▶ YouTube" links
7. Clicking a watchlist row highlights that row (indigo tint) and updates news panel header
8. News panel header shows "Berita terkait: M6.x <place>" when event selected
9. "✕ Hapus filter" clears selection and restores "Berita Risiko Terbaru"
10. Clicking "Lihat Berita →" in map popup also selects that event
11. Navigating to other pages (Map, Events, Alerts, Briefing, Copilot, Source Health) still works
12. Mobile: bottom tab bar works, top nav hidden

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/executive/ExecutiveOverview.tsx
git commit -m "feat: integrasikan RiskMap + NewsPanel ke ExecutiveOverview dengan hybrid filter"
```
