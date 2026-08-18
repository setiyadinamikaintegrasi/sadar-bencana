import { Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Mountain, MountainSnow, RotateCcw } from 'lucide-react'

/**
 * PitchControl — kontrol MapLibre kustom berbasis React untuk memiringkan
 * peta (pitch) tanpa perlu ctrl+drag. Tiga aksi:
 * - Miringkan lebih (naikkan pitch 20°, maks 70°)
 * - Miringkan kurang (turunkan pitch 20°, min 0°)
 * - Reset (pitch 0, bearing 0 — utara)
 *
 * Dirender via portal ke DOM container MapLibre sehingga berperilaku seperti
 * kontrol bawaan (ikut tersembunyi/terangkat bersama peta).
 */

interface PitchControlProps {
  map: MapLibreMap | null
}

const PITCH_STEP = 20
const PITCH_MAX = 70
const PITCH_MIN = 0

export function PitchControl({ map }: PitchControlProps) {
  const [pitch, setPitch] = useState(0)
  const [bearing, setBearing] = useState(0)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!map || typeof map.getContainer !== 'function') return
    setAnchor(map.getContainer())
  }, [map])

  useEffect(() => {
    if (!map) return
    if (typeof map.getPitch !== 'function' || typeof map.getBearing !== 'function') return
    const update = () => {
      setPitch(Math.round(map.getPitch()))
      setBearing(Math.round(map.getBearing()))
    }
    update()
    map.on('pitch', update)
    map.on('rotate', update)
    return () => {
      try {
        map.off('pitch', update)
        map.off('rotate', update)
      } catch {
        // map sudah di-remove — abaikan.
      }
    }
  }, [map])

  if (!map || !anchor) return null

  const tilt = (delta: number) => {
    const next = Math.max(PITCH_MIN, Math.min(PITCH_MAX, map.getPitch() + delta))
    map.easeTo({ pitch: next, duration: 350 })
  }

  const reset = () => {
    map.easeTo({ pitch: 0, bearing: 0, duration: 450 })
  }

  return createPortal(
    <div className="maplibregl-ctrl maplibregl-ctrl-group operational-map__pitch-ctrl">
      <button
        type="button"
        aria-label="Miringkan peta lebih"
        title="Miringkan lebih (tilt)"
        disabled={pitch >= PITCH_MAX}
        onClick={() => tilt(PITCH_STEP)}
      >
        <MountainSnow size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Miringkan peta lebih sedikit"
        title="Miringkan lebih sedikit"
        disabled={pitch <= PITCH_MIN}
        onClick={() => tilt(-PITCH_STEP)}
      >
        <Mountain size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Reset kemiringan dan arah peta"
        title={`Reset (pitch ${pitch}°, arah ${((bearing % 360) + 360) % 360}°)`}
        onClick={reset}
      >
        <RotateCcw size={14} aria-hidden="true" />
      </button>
    </div>,
    anchor,
  )
}
