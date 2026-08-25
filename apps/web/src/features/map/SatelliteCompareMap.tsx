// apps/web/src/features/map/SatelliteCompareMap.tsx
import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'

/**
 * S11b v2 — Peta kedua (citra satelit ESRI) untuk Swipe Compare.
 *
 * Pendekatan lama (background statis 1 tile + clip canvas utama)
 * menghasilkan tampilan kosong/blur — tile tunggal z3 di-stretch
 * layar penuh. Yang benar: instance MapLibre kedua dengan raster
 * satelit penuh, kamera disinkronkan dari peta utama pada setiap
 * move/zoom/pitch/bearing (dan sebaliknya tidak — satu arah cukup).
 *
 * Peta kedua dirender DI BELAKANG peta utama; clip-path pada peta
 * utama memotong sisi kiri sehingga memperlihatkan peta satelit.
 */

const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    esri: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: 'Citra © Esri, Maxar, Earthstar Geographics',
    },
  },
  layers: [{ id: 'esri-imagery', type: 'raster', source: 'esri' }],
}

export interface SatelliteCompareMapProps {
  /** Peta utama — sumber kamera & container posisi. */
  sourceMap: maplibregl.Map | null
  active: boolean
}

export function SatelliteCompareMap({ sourceMap, active }: SatelliteCompareMapProps) {
  const secondRef = useRef<maplibregl.Map | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Buat/hancurkan peta kedua sesuai `active`.
  useEffect(() => {
    if (!active || !sourceMap || !containerRef.current) return

    const center = sourceMap.getCenter()
    const second = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: [center.lng, center.lat],
      zoom: sourceMap.getZoom(),
      pitch: sourceMap.getPitch(),
      bearing: sourceMap.getBearing(),
      interactive: false, // interaksi lewat peta utama
      attributionControl: false,
    })
    secondRef.current = second

    return () => {
      second.remove()
      secondRef.current = null
    }
  }, [active, sourceMap])

  // Sinkron kamera dua arah saat aktif.
  useEffect(() => {
    if (!active || !sourceMap || !containerRef.current) return
    const second = secondRef.current
    if (!second) return

    const syncFromMain = () => {
      const center = sourceMap.getCenter()
      second.jumpTo({
        center: [center.lng, center.lat],
        zoom: sourceMap.getZoom(),
        pitch: sourceMap.getPitch(),
        bearing: sourceMap.getBearing(),
      })
    }

    // Sinkron awal + event.
    syncFromMain()
    sourceMap.on('move', syncFromMain)
    return () => {
      sourceMap.off('move', syncFromMain)
    }
  }, [active, sourceMap])

  return (
    <div
      ref={containerRef}
      className="operational-map__satellite-compare"
      aria-hidden="true"
    />
  )
}
