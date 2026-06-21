# Mobile-Responsive Design Spec
**Date:** 2026-06-22  
**Approach:** Tailwind Breakpoint Full Redesign (Pendekatan A)  
**Priority:** Mobile-first

---

## Goals

Membuat aplikasi Reinsurance Risk Monitor dapat digunakan sepenuhnya di perangkat mobile (layar ≥ 320px) tanpa merusak tampilan desktop yang sudah ada. Tidak ada library baru, tidak ada perubahan pada logic data-fetching atau TypeScript types.

---

## Breakpoints

| Breakpoint | Range | Layout |
|---|---|---|
| Mobile | < 768px (`md`) | Bottom tab bar, full-width content, card lists |
| Desktop | ≥ 768px (`md:`) | Sidebar permanen 256px, tabel data, layout asli |

---

## Bagian 1: Layout Shell (`App.tsx`)

### Sidebar
- Desktop: tetap `fixed inset-y-0 left-0 w-64 flex-col` — tidak berubah
- Mobile: `hidden md:flex` — sidebar disembunyikan sepenuhnya

### Main Content Wrapper
- Desktop: `ml-64` — tetap
- Mobile: margin kiri dihapus → `md:ml-64`
- Padding konten: `px-4 py-4 md:px-8 md:py-8`
- Bottom clearance untuk tab bar: `pb-20 md:pb-0`

### Header
- Desktop: tampil penuh seperti sekarang (`px-8 py-6`, judul besar)
- Mobile: diperkecil (`px-4 py-3`), judul "Reinsurance Risk Monitor" disembunyikan (`hidden md:block`), hanya tampil nama section aktif + label "PT Tugure" kecil

### Bottom Tab Bar (mobile only)
- Posisi: `fixed bottom-0 inset-x-0 z-20 md:hidden`
- Background: `bg-slate-900 border-t border-slate-800`
- 5 tab: Overview (◼), Map (◉), Events (●), Alerts (◆), More (···)
- Tab aktif: `text-indigo-300`, tidak aktif: `text-slate-500`
- Label + icon kecil di bawah icon

### "More" Sheet
- State: `moreOpen: boolean` di `App.tsx`
- Trigger: tap tab "More"
- UI: overlay backdrop (`fixed inset-0 bg-black/60 z-30`) + sheet dari bawah (`fixed bottom-0 inset-x-0 z-40 bg-slate-900 rounded-t-2xl p-6`)
- Isi: 3 button untuk Exposures, Claims, Briefing + tombol Tutup
- Tap backdrop atau Tutup menutup sheet

---

## Bagian 2: Adaptasi Konten per Page

### Filter Bars (EventsPage, AlertsPage)
- Container filter: `flex-col gap-3 md:flex-row md:items-center`
- Setiap `<select>` dan `<input>` filter: `w-full md:w-auto`
- Tombol Refresh dan badge count: `flex-wrap` sudah ada, pastikan konsisten

### Tabel → Card List (EventsPage, ExposuresPage, ExecutiveOverview watchlist)

Dua representasi dalam satu komponen:
```tsx
{/* Desktop table */}
<div className="hidden md:block">
  <table>...</table>
</div>

{/* Mobile card list */}
<div className="block md:hidden space-y-3">
  {data.map(row => <MobileCard key={row.id} row={row} />)}
</div>
```

**Card event (EventsPage & ExecutiveOverview):**
```
┌─────────────────────────────┐
│ [● Critical]  M 6.2         │
│ Gempa Sulawesi Tengah       │
│ earthquake · -2.34, 118.12  │
│ BMKG · 22 Jun 2026 14:30    │
└─────────────────────────────┘
```

**Card exposure rule (ExposuresPage):**
```
┌─────────────────────────────┐
│ Sulawesi Tengah             │
│ keywords: palu, donggala    │
│ Portfolio: Properti Indo    │
│ Exposure: $50,000,000       │
│ Multiplier: [× 2.00]  Impact: $100,000,000 │
└─────────────────────────────┘
```

### AlertsPage
- Alert sudah berbentuk card — tidak perlu diubah strukturnya
- Filter bar: `flex-col gap-3 sm:flex-row sm:items-center` → ubah menjadi stacking yang konsisten
- Tombol "Acknowledge all" + badge: sudah `flex-wrap`, pastikan label tidak terpotong

### MapPage
- Map height: ganti inline `height: '600px'` → `style={{ height: 'clamp(300px, 50vh, 600px)' }}`
- Stat cards (Gempa/Kapal/Pesawat): `flex-wrap gap-2` agar turun ke bawah di layar sempit
- Layer toggle buttons: sudah compact, tidak perlu diubah

### BriefingPage
- Two-column grid sudah pakai `xl:grid-cols-[...]` → di mobile dan tablet otomatis stacked, tidak perlu diubah
- Padding section cards: `p-4 md:p-6`

### ExposuresPage — Match Form
- Form sudah `flex-col sm:flex-row` — tidak perlu diubah
- Match result grid sudah `sm:grid-cols-3` — tidak perlu diubah

---

## Bagian 3: Komponen Baru & Struktur File

### File yang diubah (tidak ada file baru)

| File | Jenis perubahan |
|---|---|
| `apps/web/src/App.tsx` | Sidebar hide/show, bottom tab bar + More sheet, header mobile, padding |
| `apps/web/src/features/executive/ExecutiveOverview.tsx` | Watchlist card list mobile, padding |
| `apps/web/src/features/events/EventsPage.tsx` | Card list mobile, filter stack vertikal |
| `apps/web/src/features/exposures/ExposuresPage.tsx` | Card list mobile, padding |
| `apps/web/src/features/alerts/AlertsPage.tsx` | Filter wrap konsisten, padding |
| `apps/web/src/features/map/MapPage.tsx` | Map height responsif, stat wrap |
| `apps/web/src/features/briefing/BriefingPage.tsx` | Padding saja |

### Tidak ada perubahan pada
- Semua logic data-fetching, state, API calls
- TypeScript types dan component signatures
- Seluruh tampilan desktop
- Komponen shared (`SourceBadge`, `MagnitudeFilter`)
- Backend (API, worker)

---

## Urutan Implementasi

1. `App.tsx` — shell + bottom nav (fondasi, harus selesai dulu)
2. `EventsPage.tsx` — tabel terbesar, paling banyak filter
3. `ExecutiveOverview.tsx` — watchlist table
4. `ExposuresPage.tsx` — exposure rules table
5. `AlertsPage.tsx` — filter tweak
6. `MapPage.tsx` — map height
7. `BriefingPage.tsx` — padding saja

---

## Verifikasi

Setelah implementasi, uji di:
- **375px** (iPhone SE) — layout harus tidak ada overflow horizontal
- **768px** (iPad Portrait) — harus tampil sidebar desktop, bukan bottom nav
- **1280px** (Desktop) — tampilan identik dengan sebelum perubahan

Gunakan Chrome DevTools device toolbar untuk emulasi.
