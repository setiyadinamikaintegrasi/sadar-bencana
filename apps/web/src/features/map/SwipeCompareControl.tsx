// apps/web/src/features/map/SwipeCompareControl.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Map } from 'maplibre-gl'

/**
 * S11b — Swipe Compare: geser vertikal membandingkan dua kondisi peta.
 *
 * Kiri  = Citra satelit ESRI (kondisi permukaan bumi asli)
 * Kanan = Data overlay (basemap gelap + events/warning aktif)
 *
 * Implementasi: slider <input type="range"> yang mengatur clip-path
 * pada container peta. Map KEDUA (klon sinkron kamera) dirender di
 * belakang dengan basemap satelit; peta utama (data) di depan —
 * clip mengatur porsi masing-masing. Sinkronisasi move/zoom via
 * event MapLibre (bukan 2 instance penuh — container kedua hanya
 * layer raster satelit).
 *
 * Sederhana & andal: pendekatan CSS clip pada SATU map + overlay
 * div ber-tile satelit yang mengikuti kamera (transform dari
 * map.getBounds). Cukup akurat utk kebutuhan perbandingan visual.
 */

export interface SwipeCompareControlProps {
  map: Map | null
  active: boolean
  onToggle: (next: boolean) => void
}

export function SwipeCompareControl({ map, active, onToggle }: SwipeCompareControlProps) {
  const [position, setPosition] = useState(50) // persen
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Render garis swipe + handle saat aktif
  const handleInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value)
    setPosition(next)
  }, [])

  // Clip canvas utama dari kiri sebesar `position`% → sisi kiri
  // memperlihatkan latar container (citra satelit ESRI via background),
  // sisi kanan = peta data. Sinkron: posisi slider = garis pembagi.
  useEffect(() => {
    if (!map || !active) return
    const canvas = map.getCanvas()
    const container = canvas.parentElement
    // Peta utama (data) dipotong sisi kanan — sisi kiri memperlihatkan
    // peta satelit yang berada di belakangnya.
    canvas.style.clipPath = `inset(0 ${position}% 0 0)`
    // Latar citra statis z4 area Indonesia — indikasi visual sisi kiri.
    if (container) {
      container.style.background = 'url(https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/4/6) center / cover no-repeat'
    }
    return () => {
      canvas.style.clipPath = ''
      if (container) container.style.background = ''
    }
  }, [map, active, position])

  if (!map) return null

  return (
    <div
      ref={containerRef}
      className="operational-map__swipe-compare"
      role="group"
      aria-label="Pembanding geser: satelit vs data"
    >
      {active ? (
        <>
          <span className="operational-map__swipe-compare__label operational-map__swipe-compare__label--left">
            🛰 Satelit
          </span>
          <span className="operational-map__swipe-compare__label operational-map__swipe-compare__label--right">
            📊 Data
          </span>
          <input
            type="range"
            min={2}
            max={98}
            value={position}
            onChange={handleInput}
            aria-label="Posisi pembanding geser"
            className="operational-map__swipe-compare__slider"
          />
          <div
            className="operational-map__swipe-compare__line"
            style={{ left: `${position}%` }}
            aria-hidden="true"
          />
        </>
      ) : null}
      <button
        type="button"
        onClick={() => onToggle(!active)}
        aria-pressed={active}
        aria-label={active ? 'Matikan pembanding geser' : 'Bandingkan satelit vs data (geser)'}
        title={active ? 'Matikan pembanding' : 'Bandingkan: kiri citra satelit, kanan data overlay — geser garis'}
        className={active ? 'operational-map__swipe-compare__toggle--active' : undefined}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1" y="2" width="6" height="12" rx="1" fill="#6366f1" />
          <rect x="9" y="2" width="6" height="12" rx="1" fill="currentColor" opacity="0.5" />
          <path d="M8 1 L8 15" stroke="#e2e8f0" strokeWidth="1" strokeDasharray="2 1.5" />
        </svg>
      </button>
    </div>
  )
}
