# Map Animation Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan tiered pulse events, directional vessel/aircraft icons, flyToBounds on load, countdown bar refresh, dan stats counter pop — semuanya tanpa library baru.

**Architecture:** Semua perubahan dalam satu file `MapPage.tsx`. CSS `@keyframes` diinjeksi sekali ke `<head>` via `useEffect`. `CircleMarker` diganti `Marker` + `L.divIcon()` untuk semua tiga layer. `MapController` (child of `MapContainer`) mengakses `useMap()` untuk `flyToBounds`. `refreshKey` state men-trigger countdown bar restart.

**Tech Stack:** React 18, TypeScript, react-leaflet v4, Leaflet v1.9, Tailwind CSS v3, Vite

## Global Constraints

- Satu file dimodifikasi: `apps/web/src/features/map/MapPage.tsx`
- Zero dependency baru — tidak ada `npm install`
- Tidak ada perubahan pada API types, data-fetching, atau file lain
- TypeScript harus bersih (`npx tsc --noEmit`) setelah setiap task
- Desktop dan mobile layout tidak boleh berubah
- Semua `CircleMarker` diganti `Marker` + DivIcon — tidak ada `CircleMarker` tersisa

---

### Task 1: CSS Injection — Semua Keyframes & Animation Classes

**Files:**
- Modify: `apps/web/src/features/map/MapPage.tsx`

**Interfaces:**
- Produces: `<style id="map-animations">` tersedia di DOM saat MapPage mounted. CSS classes: `.event-dot`, `.pulse-critical`, `.pulse-high`, `.pulse-medium`, `.vessel-moving`, `.vessel-anchor`, `.aircraft-airborne`, `.stat-value`. Keyframes: `ring-expand`, `breathe`, `aircraft-pulse`, `count-pop`, `countdown`.

- [ ] **Step 1: Tambah konstanta `MAP_ANIMATION_CSS` di atas fungsi `magnitudeColor`**

Buka `apps/web/src/features/map/MapPage.tsx`. Setelah baris `import` (sebelum baris `function magnitudeColor`), sisipkan:

```tsx
const MAP_ANIMATION_CSS = `
  .event-dot {
    position: relative;
    border-radius: 50%;
    background: var(--color);
    opacity: 0.9;
  }
  .event-dot::before,
  .event-dot::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 100%;
    height: 100%;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    border: 2px solid var(--color);
    animation: ring-expand 2s ease-out infinite;
    pointer-events: none;
  }
  .event-dot::after { display: none; }
  .pulse-critical::before { animation-duration: 1.2s; }
  .pulse-critical::after  { display: block; animation-duration: 1.2s; animation-delay: 0.6s; }
  .pulse-high::before     { animation-duration: 2s; }
  .pulse-medium           { animation: breathe 3s ease-in-out infinite; }
  @keyframes ring-expand {
    0%   { transform: translate(-50%, -50%) scale(1);   opacity: 0.8; }
    100% { transform: translate(-50%, -50%) scale(3.5); opacity: 0;   }
  }
  @keyframes breathe {
    0%, 100% { transform: scale(1);   opacity: 0.85; }
    50%      { transform: scale(1.3); opacity: 0.5;  }
  }
  .vessel-moving { filter: drop-shadow(0 0 4px #06b6d4); }
  .aircraft-airborne { animation: aircraft-pulse 4s ease-in-out infinite; }
  @keyframes aircraft-pulse {
    0%, 100% { opacity: 1;   transform: scale(1);    }
    50%      { opacity: 0.6; transform: scale(0.85); }
  }
  .stat-value { animation: count-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
  @keyframes count-pop {
    0%   { transform: scale(1.25); opacity: 0.4; }
    100% { transform: scale(1);    opacity: 1;   }
  }
  @keyframes countdown {
    from { transform: scaleX(1); }
    to   { transform: scaleX(0); }
  }
  .leaflet-popup-content-wrapper {
    background: #1e293b !important;
    color: #cbd5e1 !important;
    border: 1px solid #334155 !important;
    border-radius: 8px !important;
    box-shadow: 0 4px 24px rgba(0,0,0,0.6) !important;
  }
  .leaflet-popup-tip { background: #1e293b !important; }
  .leaflet-popup-content { margin: 10px 14px !important; }
`
```

- [ ] **Step 2: Hapus fungsi `sourceColor` dan `Recenter` yang tidak digunakan**

Hapus baris 15–28 saat ini (fungsi `sourceColor` dan `Recenter`). Keduanya tidak digunakan di JSX.

File setelah dihapus seharusnya tidak memiliki `function sourceColor` maupun `function Recenter`.

- [ ] **Step 3: Tambah `useEffect` CSS injection di dalam `MapPage`**

Di dalam `export default function MapPage()`, setelah semua `useState` (sekitar baris 43 saat ini), tambahkan:

```tsx
  useEffect(() => {
    const existing = document.getElementById('map-animations')
    if (existing) return
    const style = document.createElement('style')
    style.id = 'map-animations'
    style.textContent = MAP_ANIMATION_CSS
    document.head.appendChild(style)
    return () => {
      document.getElementById('map-animations')?.remove()
    }
  }, [])
```

- [ ] **Step 4: Update imports — tambah `L`, ganti `CircleMarker` → `Marker`, hapus `useMap` sementara jika belum dipakai**

Ubah baris import di bagian atas file menjadi:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { getEvents, type Event } from '../../lib/api/client'
import { getVessels, getAircraft, type Vessel, type Aircraft } from '../../lib/api/assets'
```

- [ ] **Step 5: Verifikasi TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors (mungkin ada warning tentang `Marker` belum digunakan — diabaikan sampai Task 2).

- [ ] **Step 6: Verifikasi CSS diinjeksi**

```bash
npm run dev --workspace apps/web
```

Buka `http://localhost:5173` di browser → DevTools → Elements → `<head>`. Pastikan `<style id="map-animations">` ada dan berisi keyframes.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/map/MapPage.tsx
git commit -m "feat: MapPage — inject CSS keyframes untuk animasi marker"
```

---

### Task 2: createEventIcon — Tiered Pulse Events

**Files:**
- Modify: `apps/web/src/features/map/MapPage.tsx`

**Interfaces:**
- Consumes: `MAP_ANIMATION_CSS` classes dari Task 1 (`.event-dot`, `.pulse-critical`, `.pulse-high`, `.pulse-medium`)
- Consumes: `magnitudeColor(mag: number): string` (sudah ada)
- Consumes: `L` from 'leaflet' (Task 1)
- Produces: `createEventIcon(magnitude: number): L.DivIcon` — digunakan di events layer JSX

- [ ] **Step 1: Tambah fungsi `createEventIcon` setelah `magnitudeColor`**

```tsx
function createEventIcon(magnitude: number): L.DivIcon {
  const color = magnitudeColor(magnitude)
  const size = Math.round(6 + magnitude * 1.8)
  const pulseClass =
    magnitude >= 7 ? 'pulse-critical' :
    magnitude >= 6 ? 'pulse-high' :
    magnitude >= 5 ? 'pulse-medium' : ''
  const spread = size * 5
  return L.divIcon({
    className: '',
    iconSize: [spread, spread],
    iconAnchor: [spread / 2, spread / 2],
    html: `<div
      class="event-dot ${pulseClass}"
      style="--color:${color};width:${size}px;height:${size}px;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)"
    ></div>`,
  })
}
```

- [ ] **Step 2: Ganti `CircleMarker` events → `Marker` + `createEventIcon`**

Cari blok JSX events layer (sekitar baris `{activeLayers.has('events') && events.map...`). Ganti seluruh blok tersebut:

```tsx
              {/* Earthquake events */}
              {activeLayers.has('events') &&
                events.map((ev) => (
                  <Marker
                    key={ev.event_id}
                    position={[ev.latitude, ev.longitude]}
                    icon={createEventIcon(ev.magnitude)}
                  >
                    <Popup>
                      <div style={{ minWidth: '180px' }}>
                        <strong>M{ev.magnitude.toFixed(1)} — {ev.place}</strong>
                        <br />
                        <span>Sumber: {ev.source}</span>
                        <br />
                        <span>Waktu: {new Date(ev.event_time).toLocaleString('id-ID')}</span>
                        <br />
                        <span>Kedalaman tersedia di detail</span>
                      </div>
                    </Popup>
                  </Marker>
                ))}
```

- [ ] **Step 3: Verifikasi TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Verifikasi visual di browser**

Buka halaman Map. Aktifkan layer Gempa:
- Event M7+: harus ada 2 ring memuai bergantian berwarna merah
- Event M6–6.9: 1 ring memuai berwarna oranye
- Event M5–5.9: dot kuning yang "bernafas" (scale up-down)
- Event M4–: dot hijau statis

Klik marker → popup tampil dengan teks gelap di background slate-800.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/map/MapPage.tsx
git commit -m "feat: MapPage — tiered pulse DivIcon untuk event gempa"
```

---

### Task 3: createVesselIcon — Directional Arrow

**Files:**
- Modify: `apps/web/src/features/map/MapPage.tsx`

**Interfaces:**
- Consumes: `Vessel` type dari `../../lib/api/assets`
- Consumes: CSS classes `.vessel-moving`, `.vessel-anchor` dari Task 1
- Consumes: `L` from 'leaflet'
- Produces: `createVesselIcon(vessel: Vessel): L.DivIcon`

- [ ] **Step 1: Tambah fungsi `createVesselIcon` setelah `createEventIcon`**

```tsx
function createVesselIcon(vessel: Vessel): L.DivIcon {
  const rotation = vessel.cog ?? vessel.heading ?? 0
  const isMoving = (vessel.sog ?? 0) > 0.5

  if (isMoving) {
    return L.divIcon({
      className: '',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      html: `<div class="vessel-moving" style="width:24px;height:24px">
        <div style="transform:rotate(${rotation}deg);width:100%;height:100%">
          <svg viewBox="0 0 20 20" fill="#06b6d4" xmlns="http://www.w3.org/2000/svg" width="24" height="24">
            <polygon points="10,2 18,18 10,14 2,18"/>
          </svg>
        </div>
      </div>`,
    })
  }

  return L.divIcon({
    className: '',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html: `<div class="vessel-anchor" style="width:16px;height:16px;opacity:0.45">
      <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
        <circle cx="8" cy="4" r="2" stroke="#06b6d4" stroke-width="1.5" fill="none"/>
        <line x1="8" y1="6" x2="8" y2="13" stroke="#06b6d4" stroke-width="1.5"/>
        <line x1="3" y1="9" x2="13" y2="9" stroke="#06b6d4" stroke-width="1.5"/>
        <line x1="3" y1="13" x2="5" y2="11" stroke="#06b6d4" stroke-width="1.5"/>
        <line x1="13" y1="13" x2="11" y2="11" stroke="#06b6d4" stroke-width="1.5"/>
      </svg>
    </div>`,
  })
}
```

- [ ] **Step 2: Ganti `CircleMarker` vessels → `Marker` + `createVesselIcon`**

Cari blok `{activeLayers.has('vessels') && vessels.map...`. Ganti seluruh blok:

```tsx
              {/* Vessels */}
              {activeLayers.has('vessels') &&
                vessels.map((v) => (
                  <Marker
                    key={`v-${v.mmsi}`}
                    position={[v.latitude, v.longitude]}
                    icon={createVesselIcon(v)}
                  >
                    <Popup>
                      <div>
                        <strong>⚓ {v.name || v.mmsi}</strong>
                        <br />
                        {v.ship_type && <span>Tipe: {v.ship_type}</span>}
                        <br />
                        <span>SOG: {v.sog?.toFixed(1) ?? '?'} kn</span>
                        <br />
                        <span>Update: {new Date(v.timestamp).toLocaleTimeString('id-ID')}</span>
                      </div>
                    </Popup>
                  </Marker>
                ))}
```

- [ ] **Step 3: Verifikasi TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Verifikasi visual di browser**

Aktifkan layer Kapal:
- Kapal bergerak (SOG > 0.5): chevron cyan mengarah sesuai COG, ada cyan glow
- Kapal berlabuh: ikon jangkar cyan redup

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/map/MapPage.tsx
git commit -m "feat: MapPage — directional vessel icon (chevron + jangkar)"
```

---

### Task 4: createAircraftIcon — Directional Airplane

**Files:**
- Modify: `apps/web/src/features/map/MapPage.tsx`

**Interfaces:**
- Consumes: `Aircraft` type dari `../../lib/api/assets`
- Consumes: CSS class `.aircraft-airborne` dari Task 1
- Consumes: `L` from 'leaflet'
- Produces: `createAircraftIcon(aircraft: Aircraft): L.DivIcon`

- [ ] **Step 1: Tambah fungsi `createAircraftIcon` setelah `createVesselIcon`**

```tsx
function createAircraftIcon(aircraft: Aircraft): L.DivIcon {
  const rotation = aircraft.heading ?? 0
  const isAirborne = !aircraft.on_ground && (aircraft.altitude ?? 0) > 0
  const color = isAirborne ? '#f59e0b' : '#94a3b8'
  const opacity = isAirborne ? '1' : '0.5'
  const animClass = isAirborne ? 'aircraft-airborne' : ''

  return L.divIcon({
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<div class="${animClass}" style="width:20px;height:20px;opacity:${opacity}">
      <div style="transform:rotate(${rotation}deg);width:100%;height:100%">
        <svg viewBox="0 0 18 18" fill="${color}" xmlns="http://www.w3.org/2000/svg" width="20" height="20">
          <path d="M9,1 L11,7 L17,8 L11,11 L12,17 L9,15 L6,17 L7,11 L1,8 L7,7 Z"/>
        </svg>
      </div>
    </div>`,
  })
}
```

- [ ] **Step 2: Ganti `CircleMarker` aircraft → `Marker` + `createAircraftIcon`**

Cari blok `{activeLayers.has('aircraft') && aircraft.map...`. Ganti seluruh blok:

```tsx
              {/* Aircraft */}
              {activeLayers.has('aircraft') &&
                aircraft.map((a) => (
                  <Marker
                    key={`a-${a.icao24}`}
                    position={[a.latitude, a.longitude]}
                    icon={createAircraftIcon(a)}
                  >
                    <Popup>
                      <div>
                        <strong>✈ {a.callsign?.trim() || a.icao24}</strong>
                        <br />
                        <span>{a.origin_country}</span>
                        <br />
                        <span>Alt: {a.altitude != null ? `${a.altitude.toFixed(0)}m` : 'N/A'}</span>
                        <br />
                        <span>Vel: {a.velocity != null ? `${a.velocity.toFixed(0)} m/s` : 'N/A'}</span>
                      </div>
                    </Popup>
                  </Marker>
                ))}
```

- [ ] **Step 3: Verifikasi TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors. Pada titik ini `CircleMarker` sudah tidak digunakan — TypeScript akan mengingatkan, tapi tidak error karena masih di-import.

- [ ] **Step 4: Bersihkan import `CircleMarker` yang tidak lagi digunakan**

Pada baris import react-leaflet, hapus `CircleMarker` dari daftar:

```tsx
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
```

- [ ] **Step 5: Verifikasi TypeScript lagi**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Verifikasi visual di browser**

Aktifkan layer Pesawat:
- Pesawat terbang: ikon amber dirotasi sesuai heading, pulse scale halus
- Pesawat di darat: ikon abu-abu, opacity 50%, statis

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/map/MapPage.tsx
git commit -m "feat: MapPage — directional aircraft icon (amber/abu-abu)"
```

---

### Task 5: MapController — flyToBounds on First Load

**Files:**
- Modify: `apps/web/src/features/map/MapPage.tsx`

**Interfaces:**
- Consumes: `useMap` dari react-leaflet (sudah di-import)
- Consumes: `useRef`, `useEffect` dari react (sudah di-import dari Task 1)
- Consumes: `L` dari 'leaflet' (sudah di-import)
- Consumes: `Event` type (sudah ada)
- Produces: `<MapController events={events} />` — dirender sebagai child pertama `<MapContainer>`

- [ ] **Step 1: Tambah komponen `MapController` setelah fungsi `createAircraftIcon`**

```tsx
function MapController({ events }: { events: Event[] }) {
  const map = useMap()
  const hasFlown = useRef(false)

  useEffect(() => {
    if (events.length === 0 || hasFlown.current) return
    const lats = events.map((e) => e.latitude)
    const lngs = events.map((e) => e.longitude)
    const bounds: L.LatLngBoundsExpression = [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ]
    map.flyToBounds(bounds, { padding: [40, 40], animate: true, duration: 1.5, maxZoom: 7 })
    hasFlown.current = true
  }, [events.length]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
```

- [ ] **Step 2: Tambahkan `<MapController>` sebagai child pertama `<MapContainer>`**

Cari `<MapContainer ...>` di JSX. Tambahkan `<MapController events={events} />` sebagai elemen pertama di dalamnya, sebelum `<TileLayer>`:

```tsx
            <MapContainer
              center={INDONESIA_CENTER}
              zoom={5}
              scrollWheelZoom
              style={{ height: '100%', width: '100%', background: '#0f172a' }}
            >
              <MapController events={events} />
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url='https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
              />
              {/* ... rest of layers */}
```

- [ ] **Step 3: Verifikasi TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Verifikasi visual di browser**

Refresh halaman Map. Saat data events pertama kali masuk, peta harus "fly" dengan animasi smooth ke bounding box seluruh event (zoom maks 7). Setelah itu, scroll/zoom manual tetap bisa dilakukan.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/map/MapPage.tsx
git commit -m "feat: MapPage — flyToBounds smooth animation saat data pertama masuk"
```

---

### Task 6: Countdown Bar — Indikator Refresh 60 Detik

**Files:**
- Modify: `apps/web/src/features/map/MapPage.tsx`

**Interfaces:**
- Consumes: `useState` dari react (sudah di-import)
- Consumes: `@keyframes countdown` dari CSS Task 1
- Produces: state `refreshKey: number` — diincrement setiap `loadAll()` dipanggil; `<div key={refreshKey}>` countdown bar di dalam map container

- [ ] **Step 1: Tambah state `refreshKey`**

Di dalam `MapPage`, bersama state lainnya:

```tsx
  const [refreshKey, setRefreshKey] = useState(0)
```

- [ ] **Step 2: Increment `refreshKey` di awal `loadAll`**

Cari fungsi `loadAll`. Tambahkan `setRefreshKey((k) => k + 1)` sebagai baris **pertama** di dalam `async () => {`:

```tsx
  const loadAll = useCallback(async () => {
    setRefreshKey((k) => k + 1)
    try {
      const [ev, vs, ac] = await Promise.allSettled([
        getEvents(),
        getVessels(),
        getAircraft(),
      ])
      if (ev.status === 'fulfilled') setEvents(ev.value)
      if (vs.status === 'fulfilled') setVessels(vs.value)
      if (ac.status === 'fulfilled') setAircraft(ac.value)
      if (ev.status === 'rejected') setError('Gagal memuat data gempa')
    } catch {
      setError('Gagal memuat data')
    } finally {
      setLoading(false)
    }
  }, [])
```

- [ ] **Step 3: Tambah countdown bar dan jadikan inner container `position: relative`**

Cari div dengan `style={{ height: 'clamp(300px, 50vh, 600px)', width: '100%' }}`. Tambah `position: 'relative'` ke style-nya dan masukkan countdown bar div sebelum kondisional loading/MapContainer:

```tsx
        <div style={{ height: 'clamp(300px, 50vh, 600px)', width: '100%', position: 'relative' }}>
          {/* Countdown bar */}
          <div
            key={refreshKey}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '2px',
              background: '#4f46e5',
              transformOrigin: 'left',
              animation: 'countdown 60s linear forwards',
              zIndex: 1000,
              pointerEvents: 'none',
            }}
          />
          {loading ? (
            <div className='flex h-full items-center justify-center text-slate-400'>
              Loading map…
            </div>
          ) : (
            <MapContainer
              {/* ... */}
```

- [ ] **Step 4: Verifikasi TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Verifikasi visual di browser**

Buka halaman Map. Di tepi atas peta harus ada garis tipis indigo (2px) yang bergerak dari kanan ke kiri selama 60 detik. Saat interval 60 detik berlalu dan `loadAll` dipanggil ulang, bar restart dari kiri penuh.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/map/MapPage.tsx
git commit -m "feat: MapPage — countdown bar indigo indikator refresh 60 detik"
```

---

### Task 7: Stats Counter Pop Animation

**Files:**
- Modify: `apps/web/src/features/map/MapPage.tsx`

**Interfaces:**
- Consumes: CSS class `.stat-value` + `@keyframes count-pop` dari Task 1
- Modifies: `Stat` component (di bawah file, baris 228–236)

- [ ] **Step 1: Update komponen `Stat` untuk menambah animasi pop saat value berubah**

Cari fungsi `Stat` di bagian bawah file (saat ini baris ~228). Ganti seluruhnya dengan:

```tsx
function Stat({ label, value, sub, color }: { label: string; value: number; sub?: string; color: string }) {
  return (
    <div className='rounded-xl border border-slate-800 bg-slate-900 px-4 py-2'>
      <p className='text-xs uppercase tracking-wider text-slate-500'>{label}</p>
      <p className={`text-2xl font-bold ${color}`}>
        <span key={value} className='stat-value inline-block'>{value}</span>
      </p>
      {sub && (
        <p className='text-xs text-slate-500'>
          <span key={sub} className='stat-value inline-block'>{sub}</span>
        </p>
      )}
    </div>
  )
}
```

`key={value}` pada `<span>` menyebabkan React unmount+remount elemen saat nilai berubah, memicu CSS animation `count-pop` dari awal.

- [ ] **Step 2: Verifikasi TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Verifikasi visual di browser**

Saat data refresh (tunggu 60 detik atau buka DevTools → Network → throttle → trigger manual), angka Gempa/Kapal/Pesawat harus melakukan scale-bounce kecil (1.25→1) saat nilai berubah.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/map/MapPage.tsx
git commit -m "feat: MapPage — stats counter pop animation saat nilai berubah"
```

---

### Task 8: Final Verification

**Files:** Tidak ada perubahan file

- [ ] **Step 1: TypeScript bersih**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no output (zero errors).

- [ ] **Step 2: Production build**

```bash
npm run build --workspace apps/web
```

Expected: `✓ built in Xs` tanpa error atau warning.

- [ ] **Step 3: Full walkthrough di browser — 1280px**

Buka `http://localhost:5173`, navigasi ke Map:

1. **flyToBounds**: Saat halaman pertama load, peta fly otomatis ke cluster event Indonesia
2. **Countdown bar**: Garis indigo 2px tipis di atas peta bergerak kiri→kanan depleting selama 60 detik
3. **Layer Gempa aktif**: M7+ punya 2 ring memuai merah cepat; M6+ 1 ring oranye; M5+ dot kuning bernafas; M4- dot hijau statis
4. **Toggle Kapal**: Kapal bergerak tampil sebagai chevron cyan mengarah ke arah pelayaran dengan glow; kapal berlabuh sebagai jangkar redup
5. **Toggle Pesawat**: Pesawat terbang tampil sebagai ikon amber dirotasi sesuai heading dengan pulse; pesawat di darat abu-abu statis
6. **Popup**: Klik marker mana saja → popup dengan background gelap slate-800, teks slate-300

- [ ] **Step 4: Mobile check di 375px**

DevTools → device toolbar → 375px:
- Peta mengisi ~50vh (clamp behavior)
- Countdown bar tetap visible
- Marker bisa diklik, popup muncul dengan benar
- Tidak ada overflow horizontal

- [ ] **Step 5: Verifikasi tidak ada regresi di halaman lain**

Klik tab Overview, Events, Alerts, Exposures, Briefing — pastikan semua halaman masih normal.

- [ ] **Step 6: Push ke remote**

```bash
git push origin main
```
