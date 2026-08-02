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
  if (!style) return
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
    let map: maplibregl.Map | null = null
    let observer: ResizeObserver | undefined
    let disposed = false

    const markReady = () => setReady(true)

    const synchronizeView = (event?: { geolocateSource?: boolean }) => {
      if (disposed || event?.geolocateSource || !map) return

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

    const teardown = () => {
      if (disposed) return
      disposed = true
      observer?.disconnect()

      const currentMap = map
      if (!currentMap) return

      currentMap.off('load', markReady)
      currentMap.off('moveend', synchronizeView)
      currentMap.off('error', showFallback)
      clearOperationalMapArtifacts(currentMap)
      currentMap.remove()
      if (mapRef.current === currentMap) mapRef.current = null
      map = null
    }

    const showFallback = () => {
      setFallback(true)
      teardown()
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

    map.on('load', markReady)
    map.on('moveend', synchronizeView)
    map.once('error', showFallback)

    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        if (!disposed && map) map.resize()
      })
      observer.observe(container)
    }

    return teardown
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
