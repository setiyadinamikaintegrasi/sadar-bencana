import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { readMapViewState, writeMapViewState, type MapViewState } from './state'

// This public style is a reviewed application constant, never user-controlled input.
export const OPERATIONAL_MAP_BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

const OPERATIONAL_MAP_ID_PREFIX = 'operational-map-'

export type OperationalMapMode = 'viewer' | 'picker'
export type OperationalMapStatus = 'loading' | 'empty' | 'stale' | 'unavailable'

interface OperationalMapProps {
  mode?: OperationalMapMode
  status?: OperationalMapStatus
  className?: string
}

function statusMessage(status: OperationalMapStatus): string {
  switch (status) {
    case 'empty':
      return 'Tidak ada data peta untuk area ini.'
    case 'stale':
      return 'Data peta mungkin belum terbaru.'
    case 'unavailable':
      return 'Data peta tidak tersedia saat ini.'
    default:
      return 'Memuat peta operasi.'
  }
}

function clearOperationalMapArtifacts(map: maplibregl.Map): void {
  const style = map.getStyle()
  for (const layer of [...(style.layers ?? [])].reverse()) {
    if (layer.id.startsWith(OPERATIONAL_MAP_ID_PREFIX)) map.removeLayer(layer.id)
  }
  for (const sourceID of Object.keys(style.sources ?? {})) {
    if (sourceID.startsWith(OPERATIONAL_MAP_ID_PREFIX)) map.removeSource(sourceID)
  }
}

export default function OperationalMap({
  mode = 'viewer',
  status,
  className = '',
}: OperationalMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const viewStateRef = useRef<MapViewState>(readMapViewState())
  const [ready, setReady] = useState(false)
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapRef.current) return

    const viewState = viewStateRef.current
    let map: maplibregl.Map
    let observer: ResizeObserver | undefined

    const showFallback = () => {
      setFallback(true)
      if (mapRef.current === map) {
        clearOperationalMapArtifacts(map)
        map.remove()
        mapRef.current = null
      }
    }

    try {
      map = new maplibregl.Map({
        container,
        style: OPERATIONAL_MAP_BASE_STYLE_URL,
        center: [viewState.mapLng, viewState.mapLat],
        zoom: viewState.mapZoom,
        maxZoom: 18,
      })
    } catch {
      setFallback(true)
      return
    }

    mapRef.current = map
    if (mode === 'viewer') {
      map.addControl(new maplibregl.NavigationControl(), 'top-right')
      map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'top-right')
    }

    const synchronizeView = () => {
      const center = map.getCenter()
      const nextState: MapViewState = {
        ...viewStateRef.current,
        mapLng: center.lng,
        mapLat: center.lat,
        mapZoom: map.getZoom(),
      }
      viewStateRef.current = nextState
      const search = writeMapViewState(nextState)
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`)
    }

    map.on('load', () => setReady(true))
    map.on('moveend', synchronizeView)
    map.once('error', showFallback)

    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => map.resize())
      observer.observe(container)
    }

    return () => {
      observer?.disconnect()
      map.off('moveend', synchronizeView)
      clearOperationalMapArtifacts(map)
      map.remove()
      if (mapRef.current === map) mapRef.current = null
    }
  }, [mode])

  const visibleStatus = status ?? (ready ? 'empty' : 'loading')

  return (
    <section className={`operational-map ${className}`.trim()} aria-label="Peta operasi">
      <div ref={containerRef} className="operational-map__canvas" aria-hidden={fallback} />
      {fallback ? (
        <div className="operational-map__fallback" role="alert">
          Peta tidak tersedia. Periksa dukungan WebGL atau gunakan tampilan peta Leaflet.
        </div>
      ) : (
        <p className="operational-map__status" role="status" data-state={visibleStatus}>
          {statusMessage(visibleStatus)}
        </p>
      )}
    </section>
  )
}
