# Mobile-Responsive Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat semua halaman aplikasi Risk Monitor dapat digunakan sepenuhnya di perangkat mobile (≥ 320px) tanpa merusak tampilan desktop.

**Architecture:** Tailwind breakpoint `md` (768px) digunakan sebagai satu-satunya breakpoint pemisah. Di bawah `md` → bottom tab bar + card list. Di atas `md` → sidebar permanen + tabel data. Tidak ada library baru, tidak ada perubahan logic/types.

**Tech Stack:** React 18, TypeScript, Tailwind CSS v3, Vite

## Global Constraints

- Breakpoint utama: `md` (768px) — gunakan konsisten, jangan campur `sm:` untuk hal yang sama
- Tidak ada perubahan pada logic data-fetching, state, atau TypeScript types
- Tidak ada file baru — semua perubahan di file yang sudah ada
- Desktop tampilan harus pixel-perfect identik dengan sebelum perubahan
- Semua Tailwind class sudah tersedia tanpa konfigurasi tambahan

---

### Task 1: App.tsx — Layout Shell, Bottom Tab Bar, More Sheet

**Files:**
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Produces: `activeSection: Section` tetap tersedia untuk semua child pages (tidak berubah)

- [ ] **Step 1: Ganti seluruh isi `App.tsx` dengan versi responsif**

```tsx
import { useState } from 'react'
import AlertsPage from './features/alerts/AlertsPage'
import BriefingPage from './features/briefing/BriefingPage'
import EventsPage from './features/events/EventsPage'
import ExecutiveOverview from './features/executive/ExecutiveOverview'
import ExposuresPage from './features/exposures/ExposuresPage'
import MapPage from './features/map/MapPage'

const sections = [
  { label: 'Executive Overview', icon: '◼' },
  { label: 'Map', icon: '◉' },
  { label: 'Events', icon: '●' },
  { label: 'Exposures', icon: '▲' },
  { label: 'Alerts', icon: '◆' },
  { label: 'Claims', icon: '■' },
  { label: 'Briefing', icon: '◇' },
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
]

function App() {
  const [activeSection, setActiveSection] = useState<Section>('Executive Overview')
  const [moreOpen, setMoreOpen] = useState(false)

  const navigate = (section: Section) => {
    setActiveSection(section)
    setMoreOpen(false)
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Desktop sidebar — hidden on mobile */}
      <aside className="fixed inset-y-0 left-0 z-10 hidden w-64 flex-col border-r border-slate-800 bg-slate-900 md:flex">
        <div className="border-b border-slate-800 px-6 py-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-400">PT Tugure</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-50">Risk Monitor</h1>
        </div>

        <nav className="flex-1 px-4 py-6">
          <ul className="space-y-2">
            {sections.map((section) => {
              const isActive = section.label === activeSection
              return (
                <li key={section.label}>
                  <button
                    type="button"
                    onClick={() => setActiveSection(section.label)}
                    className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition ${
                      isActive
                        ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-inset ring-indigo-400/40'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
                    }`}
                  >
                    <span className={`text-xs ${isActive ? 'text-indigo-300' : 'text-slate-500'}`}>{section.icon}</span>
                    <span>{section.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex min-h-screen flex-col md:ml-64">
        <header className="border-b border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur md:px-8 md:py-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-400">
            PT Tugure · Reinsurance Intelligence
          </p>
          <h2 className="mt-1 text-xl font-semibold text-slate-50 md:mt-2 md:text-3xl">
            <span className="md:hidden">{activeSection}</span>
            <span className="hidden md:inline">Reinsurance Risk Monitor</span>
          </h2>
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
          ) : (
            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl shadow-slate-950/40">
              <p className="text-lg font-medium text-slate-100">{activeSection} — coming soon</p>
            </section>
          )}
        </main>
      </div>

      {/* Mobile bottom tab bar */}
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

- [ ] **Step 2: Verifikasi TypeScript tidak error**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Jalankan dev server dan verifikasi di browser**

```bash
npm run dev --workspace apps/web
```

Buka `http://localhost:5173` di Chrome DevTools:
- **375px (iPhone SE):** Sidebar tidak terlihat. Bottom tab bar muncul di bawah. Header hanya tampil nama section aktif. Tidak ada overflow horizontal.
- **768px (iPad):** Sidebar muncul. Bottom tab bar tidak terlihat. Header tampil "Reinsurance Risk Monitor".
- **1280px:** Identik dengan tampilan sebelum perubahan.

Tap tab "More" → sheet muncul dari bawah. Tap backdrop → sheet tutup.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat: mobile layout shell — bottom tab bar + more sheet"
```

---

### Task 2: EventsPage.tsx — Filter Stack Vertikal + Card List Mobile

**Files:**
- Modify: `apps/web/src/features/events/EventsPage.tsx`

**Interfaces:**
- Consumes: `Event` type dari `../../lib/api/client` (tidak berubah)
- Consumes: `severityClasses`, `severityFor` (sudah ada di file)

- [ ] **Step 1: Ganti filter bar container dan kontrol**

Cari baris ini (sekitar line 147):
```tsx
<div className="mt-6 flex flex-col gap-3 border-t border-slate-800 pt-6 sm:flex-row sm:items-center sm:justify-between">
  <MagnitudeFilter value={minMagnitude} onChange={setMinMagnitude} />

  <label className="inline-flex items-center gap-3 text-sm text-slate-300">
    <span className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
      Region
    </span>
    <select
      value={regionFilter}
      onChange={(e) => setRegionFilter(e.target.value)}
      className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 shadow-inner shadow-slate-950/40 outline-none transition focus:border-indigo-400 focus:ring-1 focus:ring-inset focus:ring-indigo-400"
    >
```

Ganti dengan:
```tsx
<div className="mt-6 flex flex-col gap-3 border-t border-slate-800 pt-6 md:flex-row md:items-center md:justify-between">
  <MagnitudeFilter value={minMagnitude} onChange={setMinMagnitude} />

  <label className="inline-flex items-center gap-3 text-sm text-slate-300">
    <span className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
      Region
    </span>
    <select
      value={regionFilter}
      onChange={(e) => setRegionFilter(e.target.value)}
      className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 shadow-inner shadow-slate-950/40 outline-none transition focus:border-indigo-400 focus:ring-1 focus:ring-inset focus:ring-indigo-400 md:w-auto"
    >
```

- [ ] **Step 2: Tambah `w-full md:w-auto` pada select Source dan input Location**

Cari select Source (sekitar line 170) — tambah `w-full md:w-auto` ke className:
```tsx
      className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 shadow-inner shadow-slate-950/40 outline-none transition focus:border-indigo-400 focus:ring-1 focus:ring-inset focus:ring-indigo-400 md:w-auto"
```

Cari input Location (sekitar line 194) — ganti `w-48` dengan `w-full md:w-48`:
```tsx
      className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 shadow-inner shadow-slate-950/40 outline-none transition placeholder:text-slate-500 focus:border-indigo-400 focus:ring-1 focus:ring-inset focus:ring-indigo-400 md:w-48"
```

- [ ] **Step 3: Ganti tabel dengan dual-representation (desktop table + mobile card list)**

Cari blok `filteredEvents.length > 0` yang berisi `<section>` dengan tabel (sekitar line 242). Ganti seluruh `<section>` tersebut dengan:

```tsx
      ) : (
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-6">
          {/* Desktop table */}
          <div className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
                <thead>
                  <tr className="text-slate-400">
                    <th className="pb-3 pr-6 font-medium">Event</th>
                    <th className="pb-3 pr-6 font-medium">Magnitude</th>
                    <th className="pb-3 pr-6 font-medium">Severity</th>
                    <th className="pb-3 pr-6 font-medium">Source</th>
                    <th className="pb-3 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredEvents.map((row) => {
                    const severity = severityFor(row.magnitude)
                    return (
                      <tr key={row.id} className="text-slate-200">
                        <td className="py-4 pr-6">
                          <p className="font-medium text-slate-100">{row.place}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {row.event_type} · {row.latitude.toFixed(2)}, {row.longitude.toFixed(2)}
                          </p>
                        </td>
                        <td className="py-4 pr-6">
                          <span className="font-semibold text-slate-100">
                            M {row.magnitude.toFixed(1)}
                          </span>
                        </td>
                        <td className="py-4 pr-6">
                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${severityClasses[severity]}`}>
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
          </div>

          {/* Mobile card list */}
          <div className="space-y-3 md:hidden">
            {filteredEvents.map((row) => {
              const severity = severityFor(row.magnitude)
              return (
                <article key={row.id} className="rounded-xl border border-slate-800 bg-slate-800/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${severityClasses[severity]}`}>
                          {severity}
                        </span>
                        <span className="text-xs font-semibold text-slate-300">
                          M {row.magnitude.toFixed(1)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-medium text-slate-100">{row.place}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {row.event_type} · {row.latitude.toFixed(2)}, {row.longitude.toFixed(2)}
                      </p>
                    </div>
                  </div>
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
        </section>
      )}
```

- [ ] **Step 4: Verifikasi TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 5: Verifikasi di browser — buka halaman Events**

Di **375px:** Filter controls stack vertikal, full width. Daftar tampil sebagai cards, tidak ada tabel horizontal.
Di **1280px:** Filter horizontal, tabel tampil normal.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/events/EventsPage.tsx
git commit -m "feat: EventsPage — card list mobile + filter stack vertikal"
```

---

### Task 3: ExecutiveOverview.tsx — Watchlist Card List Mobile

**Files:**
- Modify: `apps/web/src/features/executive/ExecutiveOverview.tsx`

**Interfaces:**
- Consumes: `Event`, `severityClasses`, `severityFor` (sudah ada di file)

- [ ] **Step 1: Ganti blok tabel watchlist dengan dual-representation**

Cari `<div className="overflow-x-auto">` di dalam section watchlist (sekitar line 165). Ganti blok `overflow-x-auto` + tabel di dalamnya dengan:

```tsx
          {/* Desktop table */}
          <div className="hidden md:block">
            <div className="overflow-x-auto">
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
                    return (
                      <tr key={row.id} className="text-slate-200">
                        <td className="py-4 pr-6">{row.place}</td>
                        <td className="py-4 pr-6">
                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${severityClasses[severity]}`}>
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
          </div>

          {/* Mobile card list */}
          <div className="space-y-3 md:hidden">
            {filteredEvents.map((row) => {
              const severity = severityFor(row.magnitude)
              return (
                <article key={row.id} className="rounded-xl border border-slate-800 bg-slate-800/50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${severityClasses[severity]}`}>
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
```

- [ ] **Step 2: Tambah padding responsif pada container watchlist section**

Cari `className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40"` pada div watchlist (sekitar line 112). Ganti `p-6` → `p-4 md:p-6`:

```tsx
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-6">
```

- [ ] **Step 3: Verifikasi TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Verifikasi di browser — buka Executive Overview**

Di **375px:** KPI cards stack 1-2 kolom, watchlist tampil sebagai cards.
Di **1280px:** KPI cards 4 kolom, watchlist tabel normal.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/executive/ExecutiveOverview.tsx
git commit -m "feat: ExecutiveOverview — watchlist card list mobile"
```

---

### Task 4: ExposuresPage.tsx — Exposure Rules Card List Mobile

**Files:**
- Modify: `apps/web/src/features/exposures/ExposuresPage.tsx`

**Interfaces:**
- Consumes: `ExposureRule`, `formatCurrency`, `multiplierClasses` (sudah ada di file)

- [ ] **Step 1: Ganti blok tabel exposure rules dengan dual-representation**

Cari `<div className="overflow-x-auto">` (sekitar line 154). Ganti blok `overflow-x-auto` + tabel dengan:

```tsx
          {/* Desktop table */}
          <div className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
                <thead>
                  <tr className="text-slate-400">
                    <th className="pb-3 pr-6 font-medium">Region</th>
                    <th className="pb-3 pr-6 font-medium">Portfolio</th>
                    <th className="pb-3 pr-6 font-medium">Total Exposure</th>
                    <th className="pb-3 pr-6 font-medium">Multiplier</th>
                    <th className="pb-3 font-medium">Estimated Impact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {rules.map((rule) => (
                    <tr key={rule.id} className="text-slate-200">
                      <td className="py-4 pr-6">
                        <p className="font-medium text-slate-100">{rule.region_name}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {rule.region_keywords.join(', ')}
                        </p>
                      </td>
                      <td className="py-4 pr-6 text-slate-300">{rule.portfolio_name}</td>
                      <td className="py-4 pr-6 text-slate-300">
                        {formatCurrency(rule.total_exposure, rule.currency)}
                      </td>
                      <td className="py-4 pr-6">
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${multiplierClasses(rule.risk_multiplier)}`}>
                          × {rule.risk_multiplier.toFixed(2)}
                        </span>
                      </td>
                      <td className="py-4 pr-6 font-semibold text-slate-100">
                        {formatCurrency(rule.estimated_impact, rule.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile card list */}
          <div className="space-y-3 md:hidden">
            {rules.map((rule) => (
              <article key={rule.id} className="rounded-xl border border-slate-800 bg-slate-800/50 p-4">
                <p className="font-medium text-slate-100">{rule.region_name}</p>
                <p className="mt-0.5 text-xs text-slate-500">{rule.region_keywords.join(', ')}</p>
                <p className="mt-1 text-xs text-slate-400">{rule.portfolio_name}</p>
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-700 pt-3">
                  <div>
                    <p className="text-xs text-slate-500">Total Exposure</p>
                    <p className="mt-0.5 text-sm font-medium text-slate-200">
                      {formatCurrency(rule.total_exposure, rule.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Estimated Impact</p>
                    <p className="mt-0.5 text-sm font-semibold text-slate-100">
                      {formatCurrency(rule.estimated_impact, rule.currency)}
                    </p>
                  </div>
                </div>
                <div className="mt-2">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${multiplierClasses(rule.risk_multiplier)}`}>
                    × {rule.risk_multiplier.toFixed(2)}
                  </span>
                </div>
              </article>
            ))}
          </div>
```

- [ ] **Step 2: Tambah padding responsif pada section container**

Cari `className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40"` yang membungkus tabel (sekitar line 153). Ganti `p-6` → `p-4 md:p-6`:

```tsx
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-6">
```

- [ ] **Step 3: Verifikasi TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Verifikasi di browser — buka Exposures (via More sheet)**

Di **375px:** Tap "More" → tap "Exposures". Rules tampil sebagai cards dengan 2-kolom grid untuk angka.
Di **1280px:** Tabel 5 kolom normal.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/exposures/ExposuresPage.tsx
git commit -m "feat: ExposuresPage — exposure rules card list mobile"
```

---

### Task 5: AlertsPage.tsx — Filter Bar Konsisten Mobile

**Files:**
- Modify: `apps/web/src/features/alerts/AlertsPage.tsx`

**Interfaces:**
- Tidak ada perubahan interface

- [ ] **Step 1: Ubah filter bar container agar stack vertikal di mobile**

Cari baris (sekitar line 196):
```tsx
        <div className="mt-6 flex flex-col gap-3 border-t border-slate-800 pt-6 sm:flex-row sm:items-center">
```

Ganti `sm:flex-row sm:items-center` dengan `md:flex-row md:items-center`:
```tsx
        <div className="mt-6 flex flex-col gap-3 border-t border-slate-800 pt-6 md:flex-row md:items-center">
```

- [ ] **Step 2: Ubah `ml-auto` pada source filter label menjadi `md:ml-auto`**

Cari (sekitar line 220):
```tsx
          <label className="ml-auto inline-flex items-center gap-3 text-sm text-slate-300">
```

Ganti dengan:
```tsx
          <label className="inline-flex items-center gap-3 text-sm text-slate-300 md:ml-auto">
```

- [ ] **Step 3: Tambah `w-full md:w-auto` pada select Source**

Cari select source (sekitar line 224):
```tsx
              className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 shadow-inner shadow-slate-950/40 outline-none transition focus:border-indigo-400 focus:ring-1 focus:ring-inset focus:ring-indigo-400"
```

Ganti dengan:
```tsx
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 shadow-inner shadow-slate-950/40 outline-none transition focus:border-indigo-400 focus:ring-1 focus:ring-inset focus:ring-indigo-400 md:w-auto"
```

- [ ] **Step 4: Verifikasi TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 5: Verifikasi di browser — buka Alerts**

Di **375px:** Filter status toggle dan source select stack vertikal, full width. Alert cards sudah responsif, tidak ada overflow.
Di **1280px:** Filter horizontal, identical dengan sebelum perubahan.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/alerts/AlertsPage.tsx
git commit -m "feat: AlertsPage — filter bar responsif mobile"
```

---

### Task 6: MapPage.tsx — Map Height Responsif + Stat Wrap

**Files:**
- Modify: `apps/web/src/features/map/MapPage.tsx`

**Interfaces:**
- Tidak ada perubahan interface

- [ ] **Step 1: Ubah tinggi map menjadi responsif**

Cari (sekitar line 131):
```tsx
        <div style={{ height: '600px', width: '100%' }}>
```

Ganti dengan:
```tsx
        <div style={{ height: 'clamp(300px, 50vh, 600px)', width: '100%' }}>
```

- [ ] **Step 2: Ubah stat cards agar flex-wrap**

Cari (sekitar line 98):
```tsx
        <div className="flex gap-4">
```

Ganti dengan:
```tsx
        <div className="flex flex-wrap gap-2 md:gap-4">
```

- [ ] **Step 3: Verifikasi TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Verifikasi di browser — buka Map**

Di **375px:** Peta mengisi sekitar 50% tinggi viewport (min 300px). Stat cards (Gempa, Kapal, Pesawat) wrap ke baris berikutnya jika tidak muat.
Di **1280px:** Peta 600px tinggi, stat cards satu baris.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/map/MapPage.tsx
git commit -m "feat: MapPage — map height responsif + stat wrap mobile"
```

---

### Task 7: BriefingPage.tsx — Padding Responsif

**Files:**
- Modify: `apps/web/src/features/briefing/BriefingPage.tsx`

**Interfaces:**
- Tidak ada perubahan interface

- [ ] **Step 1: Tambah padding responsif pada section header**

Cari section header pertama (sekitar line 83):
```tsx
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
```

Ganti `p-6` → `p-4 md:p-6`:
```tsx
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-6">
```

- [ ] **Step 2: Tambah padding responsif pada loading skeleton cards**

Cari dua div loading skeleton (sekitar line 113 dan 122), ganti `p-6` → `p-4 md:p-6`:
```tsx
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-6">
```
(ada dua div, keduanya diubah)

- [ ] **Step 3: Tambah padding responsif pada briefing content articles**

Cari dua `<article>` saat data tersedia (sekitar line 139 dan 157), ganti `p-6` → `p-4 md:p-6`:
```tsx
          <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-6">
```
(ada dua article, keduanya diubah)

- [ ] **Step 4: Verifikasi TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 5: Verifikasi di browser — buka Briefing (via More sheet)**

Di **375px:** Konten briefing (summary + top events) stack vertikal, padding lebih kompak. Tidak ada overflow horizontal.
Di **1280px:** Dua kolom `xl:grid-cols-[...]` tampil normal.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/briefing/BriefingPage.tsx
git commit -m "feat: BriefingPage — padding responsif mobile"
```

---

### Task 8: Final Verification

**Files:** Tidak ada perubahan file

- [ ] **Step 1: Pastikan semua TypeScript bersih**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 2: Build production untuk verifikasi tidak ada error build**

```bash
npm run build --workspace apps/web
```
Expected: `✓ built in Xs` tanpa error

- [ ] **Step 3: Full mobile walkthrough di Chrome DevTools 375px (iPhone SE)**

Jalankan `npm run dev --workspace apps/web`, buka DevTools → device toolbar → 375px:

1. **Home (Overview):** KPI cards 1-2 kolom. Watchlist tampil sebagai cards. Tidak ada horizontal scroll.
2. **Tap Map:** Peta muncul, tinggi sekitar 50vh. Stat cards wrap. Layer toggles visible.
3. **Tap Events:** Filter stack vertikal. Event list tampil sebagai cards.
4. **Tap Alerts:** Alert cards, filter stack vertikal. Acknowledge button accessible.
5. **Tap More:** Sheet muncul dari bawah. Tap Exposures → exposure rules sebagai cards. Kembali, tap More → Briefing → konten stacked.
6. **Tidak ada halaman** yang memiliki horizontal scrollbar pada 375px.

- [ ] **Step 4: Desktop regression check di 1280px**

Ganti ke 1280px:
1. Sidebar muncul, bottom tab bar tidak terlihat.
2. Semua halaman menampilkan tabel (bukan cards).
3. Header "Reinsurance Risk Monitor" tampil.
4. Filter horizontal pada semua page.

- [ ] **Step 5: iPad check di 768px**

768px harus menampilkan layout desktop (sidebar, tabel), bukan layout mobile.
