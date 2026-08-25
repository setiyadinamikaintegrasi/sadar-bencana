// apps/web/src/features/map/View3DPresetButton.tsx
import { useState } from 'react'

/**
 * View3DPresetButton — preset "Tampilan 3D" satu klik (S10b).
 *
 * Menggabungkan tiga tindakan manual menjadi satu toggle:
 *  1. Citra satelit (ESRI World Imagery) sebagai texture
 *  2. Terrain 3D (AWS Terrarium DEM) sebagai elevasi
 *  3. Kamera pitch 55° + zoom +0.5 (perspective dramatis)
 *
 * Toggle kembali ke mode standar: basemap gelap, terrain off,
 * pitch 0 (utar). State visual satelit/terrain didelegasikan ke
 * handler parent (satu sumber kebenaran), tombol ini hanya
 * memicu transisi.
 */

export interface View3DPresetButtonProps {
  /** Sedang aktif mode 3D (satelit+terrain+pitch)? */
  active: boolean
  onActivate: () => void
  onDeactivate: () => void
}

export function View3DPresetButton({ active, onActivate, onDeactivate }: View3DPresetButtonProps) {
  const [busy, setBusy] = useState(false)

  const handleClick = () => {
    if (busy) return
    setBusy(true)
    try {
      if (active) onDeactivate()
      else onActivate()
    } finally {
      // Animasi easeTo ~600ms; kunci singkat untuk mencegah spam klik.
      window.setTimeout(() => setBusy(false), 700)
    }
  }

  return (
    <div className="maplibregl-ctrl maplibregl-ctrl-group operational-map__3d-preset">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        aria-pressed={active}
        aria-label={active ? 'Kembali ke tampilan standar' : 'Tampilan 3D: citra satelit + terrain miring'}
        title={active ? 'Kembali ke tampilan standar (basemap gelap, tilt 0°)' : 'Tampilan 3D: citra satelit + terrain 3D + kemiringan 55°'}
        className={active ? 'operational-map__3d-preset--active' : undefined}
      >
        {/* Ikon gunung sederhana (SVG inline — konsisten dgn kontrol peta). */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2 14 L6.5 5.5 L9 10 L11 6.5 L16 14 Z"
            fill={active ? '#6366f1' : 'currentColor'}
            stroke={active ? '#818cf8' : 'currentColor'}
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <circle cx="13" cy="4.5" r="1.6" fill={active ? '#fbbf24' : 'currentColor'} />
        </svg>
      </button>
    </div>
  )
}
