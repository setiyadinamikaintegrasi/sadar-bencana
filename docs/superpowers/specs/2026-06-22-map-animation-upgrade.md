# Map Animation Upgrade — Design Spec

**Date:** 2026-06-22
**Scope:** `apps/web/src/features/map/MapPage.tsx` only
**Dependencies added:** none (zero new packages)
**Constraints:** No changes to data-fetching, API types, or backend

---

## Goal

Meningkatkan MapPage dengan tiga dimensi animasi menggunakan CSS `@keyframes` +
Leaflet `DivIcon` + Leaflet native API — tanpa library baru.

---

## Architecture

### CSS Injection (once on mount)

Satu `useEffect` di `MapPage` menginjeksi `<style id="map-animations">` ke
`document.head` pada mount pertama. Semua `@keyframes` dan class animasi
didefinisikan di sini. Cleanup pada unmount menghapus tag tersebut.

Keuntungan: tidak ada `<style>` duplikat di setiap marker, tidak ada konflik
dengan Tailwind, dapat di-hot-reload.

### DivIcon menggantikan CircleMarker

Semua tiga layer (events, vessels, aircraft) menggunakan `L.divIcon()` yang
menghasilkan elemen DOM biasa sehingga CSS class dapat langsung di-apply.
Helper function `createEventIcon`, `createVesselIcon`, `createAircraftIcon`
masing-masing mengembalikan `L.DivIcon`.

### MapController component

Komponen React kecil yang dirender di dalam `<MapContainer>` untuk mengakses
`useMap()`. Bertanggung jawab atas `flyToBounds` saat data pertama kali masuk.

---

## Section A — Danger Signaling (Tiered Pulse)

### Tier Matrix

| Class | Magnitudo | Animasi | Warna | Siklus |
|-------|-----------|---------|-------|--------|
| `pulse-critical` | M ≥ 7.0 | 2 ring memuai bergantian (`::before` + `::after`) | `#dc2626` merah | 1.2 detik |
| `pulse-high` | M 6.0–6.9 | 1 ring memuai (`::before` saja) | `#f97316` oranye | 2.0 detik |
| `pulse-medium` | M 5.0–5.9 | Dot scale 1→1.3→1 ("bernafas") | `#eab308` kuning | 3.0 detik |
| *(none)* | M < 5.0 | Statis, tidak ada animasi | `#22c55e` hijau | — |

### Keyframes

```css
@keyframes ring-expand {
  0%   { transform: scale(1);   opacity: 0.8; }
  100% { transform: scale(3.5); opacity: 0;   }
}

@keyframes breathe {
  0%, 100% { transform: scale(1);   opacity: 0.85; }
  50%       { transform: scale(1.3); opacity: 0.5;  }
}
```

### DivIcon HTML structure

```html
<div class="event-dot pulse-critical"
     style="--color:#dc2626; --size:14px; width:var(--size); height:var(--size)">
</div>
```

CSS menggunakan `::before` (ring 1) dan `::after` (ring 2) dengan
`animation-delay: 0.6s` pada `pulse-critical`. `pulse-high` hanya `::before`.
`pulse-medium` animates elemen itu sendiri (bukan pseudo-element).

### Icon sizing

`size = Math.round(6 + magnitude * 1.8)` px. DivIcon `iconSize` dan `iconAnchor`
disesuaikan agar ring tidak terpotong: `iconSize = [size * 5, size * 5]`,
`iconAnchor = [size * 2.5, size * 2.5]`.

---

## Section B — Asset Direction Icons

### Vessels

Helper `createVesselIcon(vessel: Vessel): L.DivIcon`:

- **Bergerak** (SOG > 0.5 kn): SVG chevron/panah navigasi (#06b6d4 cyan),
  dirotasi `vessel.cog ?? vessel.heading ?? 0` derajat, ukuran 20×20 px.
  Class `vessel-moving`: subtle box-shadow glow CSS (`0 0 6px #06b6d4`).
- **Berlabuh** (SOG ≤ 0.5 kn): SVG jangkar kecil (#06b6d4 opacity 0.45),
  tanpa rotasi, ukuran 16×16 px. Class `vessel-anchor`.

SVG path untuk chevron navigasi (pointing up, North):
```svg
<polygon points="10,2 18,20 10,15 2,20" fill="currentColor"/>
```

Rotasi diset via `transform: rotate(${rotation}deg)` pada wrapper `<div>`.

### Aircraft

Helper `createAircraftIcon(aircraft: Aircraft): L.DivIcon`:

- **Terbang** (altitude > 0 atau `on_ground === false`): SVG pesawat atas (#f59e0b amber),
  dirotasi `aircraft.heading ?? 0` derajat, ukuran 18×18 px.
  Class `aircraft-airborne`: `animation: aircraft-pulse 4s ease-in-out infinite`.
- **Di darat** (`on_ground === true`): SVG pesawat sama (#94a3b8 abu-abu),
  tanpa animasi, opacity 0.5.

```css
@keyframes aircraft-pulse {
  0%, 100% { opacity: 1;   transform: scale(1);    }
  50%       { opacity: 0.6; transform: scale(0.85); }
}
```

SVG path untuk pesawat atas (simplified):
```svg
<path d="M10,1 L13,8 L19,9 L13,12 L14,19 L10,17 L6,19 L7,12 L1,9 L7,8 Z"
      fill="currentColor"/>
```

---

## Section C — Data Freshness UX

### Countdown Bar

Elemen `<div>` absolut di tepi **atas** container peta (bukan header halaman).
- `position: absolute; top: 0; left: 0; right: 0; height: 2px; z-index: 1000`
- Background `#4f46e5` (indigo-600)
- `animation: countdown 60s linear forwards`
- `key={refreshKey}` (integer) — React remount → animasi restart
- `refreshKey` di-increment setiap kali `loadAll()` dipanggil (bukan selesai —
  mulai animasi saat fetch dimulai)

```css
@keyframes countdown {
  from { transform: scaleX(1); }
  to   { transform: scaleX(0); }
}
/* transform-origin: left diset pada elemen, bukan di keyframe */
```

### flyToBounds on First Load

Komponen `<MapController events={events} />` di dalam `<MapContainer>`:

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
  }, [events.length])

  return null
}
```

`maxZoom: 7` mencegah zoom terlalu dekat jika hanya ada satu event.

### Stats Counter Pop

Komponen `Stat` menerima `key={value}` dari pemanggil. Saat value berubah,
React unmount+remount elemen, memicu CSS entry animation:

```css
@keyframes count-pop {
  0%   { transform: scale(1.25); opacity: 0.4; }
  100% { transform: scale(1);    opacity: 1;   }
}

.stat-value {
  animation: count-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

`Stat` component menambah class `stat-value` pada elemen angka.

---

## Data Flow (unchanged)

```
loadAll() → Promise.allSettled([getEvents, getVessels, getAircraft])
         → setState → React re-render → DivIcon helpers dipanggil per marker
         → CSS class dari injected <style> di-apply oleh browser
```

Tidak ada perubahan pada timing, interval, atau error handling yang sudah ada.

---

## File Changes

| File | Jenis |
|------|-------|
| `apps/web/src/features/map/MapPage.tsx` | Modify (satu-satunya file) |

---

## Non-Goals

- Tidak ada heatmap layer (memerlukan `leaflet.heat`)
- Tidak ada vessel trail / path history (API tidak menyediakan history posisi)
- Tidak ada animasi pada mini-map di ExecutiveOverview (biarkan statis)
- Tidak ada perubahan pada halaman lain
