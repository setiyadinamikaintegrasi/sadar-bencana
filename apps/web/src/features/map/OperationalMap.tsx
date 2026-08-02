import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { MapDetailSheet } from './MapDetailSheet'
import { MapLegend } from './MapLegend'
import { fetchPublicMapLayer, type PublicMapLayerViewState, type PublicMapViewport } from './mapApi'
import { airQualityLayer } from './layers/airQuality'
import { evacuationsLayer } from './layers/evacuations'
import { eventsLayer } from './layers/events'
import { officialAlertsLayer } from './layers/officialAlerts'
import { readMapViewState, writeMapViewState, type MapViewState } from './state'
import { OPERATIONAL_MAP_WIRE_LAYERS, type OperationalMapFeature, type OperationalMapFeatureProperties, type PublicOperationalMapLayer } from './types'

// This public style is a reviewed application constant, never user-controlled input.
export const OPERATIONAL_MAP_BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

const OPERATIONAL_MAP_ID_PREFIX = 'operational-map-'

export type OperationalMapMode = 'viewer' | 'picker'
export type OperationalMapStatus = 'loading' | 'empty' | 'stale' | 'unavailable'

const MAP_REFRESH_DEBOUNCE_MS = 250

const layerAdapters = {
  events: eventsLayer,
  'official-alerts': officialAlertsLayer,
  'air-quality': airQualityLayer,
  evacuations: evacuationsLayer,
} as const

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

function boundedExtent(minimum: number, maximum: number, center: number, lowerBound: number, upperBound: number): [number, number] {
  const extent = Math.min(maximum - minimum, 20)
  let lower = Math.max(lowerBound, center - extent / 2)
  let upper = Math.min(upperBound, lower + extent)
  lower = Math.max(lowerBound, upper - extent)
  return [lower, upper]
}

function publicViewport(map: maplibregl.Map, viewState: MapViewState): PublicMapViewport {
  const bounds = map.getBounds()
  const center = map.getCenter()
  const [west, east] = boundedExtent(bounds.getWest(), bounds.getEast(), center.lng, -180, 180)
  const [south, north] = boundedExtent(bounds.getSouth(), bounds.getNorth(), center.lat, -90, 90)
  return {
    bbox: [west, south, east, north],
    zoom: Math.max(0, Math.min(18, Math.round(map.getZoom()))),
    ...(viewState.mapTime ? { mapTime: viewState.mapTime } : {}),
  }
}

function mapFeatureFromClick(value: unknown): OperationalMapFeature | undefined {
  if (!value || typeof value !== 'object') return undefined
  const feature = value as { id?: string | number; geometry?: GeoJSON.Geometry; properties?: unknown }
  const properties = feature.properties
  if (!feature.geometry || !properties || typeof properties !== 'object') return undefined
  const typed = properties as Partial<OperationalMapFeatureProperties>
  if (
    typeof typed.id !== 'string'
    || typeof typed.label !== 'string'
    || typeof typed.source !== 'string'
    || typeof typed.attribution !== 'string'
    || typeof typed.verification_status !== 'string'
    || typeof typed.layer !== 'string'
    || !(OPERATIONAL_MAP_WIRE_LAYERS as readonly string[]).includes(typed.layer)
  ) return undefined
  return {
    type: 'Feature',
    id: typeof feature.id === 'string' ? feature.id : typed.id,
    geometry: feature.geometry,
    properties: typed as OperationalMapFeatureProperties,
  }
}

function statusFromResults(
  ready: boolean,
  enabledLayers: PublicOperationalMapLayer[],
  layerStates: Partial<Record<PublicOperationalMapLayer, PublicMapLayerViewState>>,
): OperationalMapStatus | undefined {
  if (!ready) return 'loading'
  if (enabledLayers.length === 0) return undefined
  const activeStates = enabledLayers.map((layer) => layerStates[layer]).filter((state): state is PublicMapLayerViewState => Boolean(state))
  if (activeStates.length < enabledLayers.length || activeStates.some((state) => state.health === 'loading')) return 'loading'
  if (activeStates.some((state) => state.health === 'stale')) return 'stale'
  if (activeStates.every((state) => state.health === 'unavailable')) return 'unavailable'
  if (activeStates.every((state) => state.health === 'empty')) return 'empty'
  return undefined
}

export default function OperationalMap({
  mode = 'viewer',
  status,
  className = '',
}: OperationalMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const viewStateRef = useRef<MapViewState>(readMapViewState())
  const enabledLayersRef = useRef<PublicOperationalMapLayer[]>(viewStateRef.current.mapLayers)
  const loadLayersRef = useRef<(() => void) | null>(null)
  const [ready, setReady] = useState(false)
  const [fallback, setFallback] = useState(false)
  const [enabledLayers, setEnabledLayers] = useState<PublicOperationalMapLayer[]>(enabledLayersRef.current)
  const [layerStates, setLayerStates] = useState<Partial<Record<PublicOperationalMapLayer, PublicMapLayerViewState>>>({})
  const [selectedFeature, setSelectedFeature] = useState<OperationalMapFeature | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapRef.current) return

    const viewState = viewStateRef.current
    let map: maplibregl.Map | null = null
    let observer: ResizeObserver | undefined
    let refreshTimer: number | undefined
    let refreshController: AbortController | undefined
    let refreshRevision = 0
    let mapLoaded = false
    let disposed = false

    const beginRefresh = () => {
      refreshRevision += 1
      refreshController?.abort()
      refreshController = undefined
      setLayerStates((current) => {
        const next = { ...current }
        for (const layer of enabledLayersRef.current) {
          const previous = current[layer]
          next[layer] = previous
            ? { ...previous, refreshing: true }
            : { health: 'loading', refreshing: true }
        }
        return next
      })
      return refreshRevision
    }

    const loadPublicLayers = () => {
      if (disposed || !map || !mapLoaded) return
      const revision = beginRefresh()
      const controller = new AbortController()
      refreshController = controller
      const layers = enabledLayersRef.current
      if (layers.length === 0) {
        setLayerStates({})
        return
      }

      const viewport = publicViewport(map, viewStateRef.current)
      void Promise.all(layers.map((layer) => fetchPublicMapLayer(layer, viewport, controller.signal))).then((nextResults) => {
        if (disposed || revision !== refreshRevision || controller.signal.aborted || !map) return
        for (const result of nextResults) {
          if (result.collection) layerAdapters[result.layer].apply(map, result.collection)
        }
        setLayerStates((current) => {
          const next = { ...current }
          for (const result of nextResults) {
            const previous = current[result.layer]
            if (result.collection) {
              next[result.layer] = {
                collection: result.collection,
                health: result.state === 'ready' ? 'current' : result.state,
                refreshing: false,
              }
            } else if (previous?.collection && previous.collection.features.length > 0) {
              next[result.layer] = {
                ...previous,
                health: 'stale',
                refreshFailed: true,
                refreshing: false,
              }
            } else {
              next[result.layer] = { health: 'unavailable', refreshFailed: true, refreshing: false }
            }
          }
          return next
        })
        setSelectedFeature((selected) => {
          if (!selected) return null
          const refreshed = nextResults.find((result) => result.collection?.layer === selected.properties.layer)?.collection
          if (!refreshed) return selected
          return refreshed.features.find((feature) => feature.id === selected.id) ?? null
        })
      })
    }

    const schedulePublicLayers = () => {
      if (disposed || !mapLoaded) return
      beginRefresh()
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined
        loadPublicLayers()
      }, MAP_REFRESH_DEBOUNCE_MS)
    }

    const markReady = () => {
      mapLoaded = true
      setReady(true)
      loadPublicLayers()
    }

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
      schedulePublicLayers()
    }

    const selectFeature = (event: { features?: unknown[] }) => {
      const feature = mapFeatureFromClick(event.features?.[0])
      if (feature) setSelectedFeature(feature)
    }

    const expandCluster = (event: { features?: Array<{ geometry?: GeoJSON.Geometry; properties?: Record<string, unknown> }> }) => {
      const cluster = event.features?.[0]
      const clusterID = cluster?.properties?.cluster_id
      const geometry = cluster?.geometry
      if (!map || typeof clusterID !== 'number' || !geometry || geometry.type !== 'Point') return
      const center = geometry.coordinates as [number, number]
      const source = map.getSource(eventsLayer.sourceId) as maplibregl.GeoJSONSource | undefined
      if (!source) return
      void source.getClusterExpansionZoom(clusterID).then((zoom) => {
        if (!disposed && map) map.easeTo({ center, zoom })
      })
    }

    const teardown = () => {
      if (disposed) return
      disposed = true
      observer?.disconnect()
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      refreshController?.abort()
      loadLayersRef.current = null

      const currentMap = map
      if (!currentMap) return

      currentMap.off('load', markReady)
      currentMap.off('moveend', synchronizeView)
      currentMap.off('error', showFallback)
      currentMap.off('click', eventsLayer.layerIds[0], expandCluster)
      for (const adapter of Object.values(layerAdapters)) {
        for (const layerId of adapter.layerIds) currentMap.off('click', layerId, selectFeature)
        adapter.remove(currentMap)
      }
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
    loadLayersRef.current = loadPublicLayers
    if (mode === 'viewer') {
      map.addControl(new maplibregl.NavigationControl(), 'top-right')
      map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'top-right')
    }

    map.on('load', markReady)
    map.on('moveend', synchronizeView)
    map.once('error', showFallback)
    for (const adapter of Object.values(layerAdapters)) {
      for (const layerId of adapter.layerIds) map.on('click', layerId, selectFeature)
    }
    map.on('click', eventsLayer.layerIds[0], expandCluster)

    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        if (!disposed && map) map.resize()
      })
      observer.observe(container)
    }

    return teardown
  }, [mode])

  const toggleLayer = (layer: PublicOperationalMapLayer) => {
    const nextLayers = enabledLayersRef.current.includes(layer)
      ? enabledLayersRef.current.filter((current) => current !== layer)
      : [...enabledLayersRef.current, layer]
    enabledLayersRef.current = nextLayers
    setEnabledLayers(nextLayers)
    setSelectedFeature(null)

    const nextState = { ...viewStateRef.current, mapLayers: nextLayers }
    viewStateRef.current = nextState
    const search = writeMapViewState(nextState)
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`)

    if (!nextLayers.includes(layer) && mapRef.current) {
      layerAdapters[layer].remove(mapRef.current)
      setLayerStates((current) => {
        const { [layer]: _removed, ...remaining } = current
        return remaining
      })
    }
    loadLayersRef.current?.()
  }

  const visibleStatus = status ?? statusFromResults(ready, enabledLayers, layerStates)

  return (
    <section className={`operational-map ${className}`.trim()} aria-label="Peta operasi">
      <div ref={containerRef} className="operational-map__canvas" aria-hidden={fallback} />
      {fallback ? (
        <div className="operational-map__fallback" role="alert">
          Peta tidak tersedia. Periksa dukungan WebGL atau gunakan tampilan peta Leaflet.
        </div>
      ) : (
        <>
          <MapLegend enabledLayers={enabledLayers} results={{}} layerStates={layerStates} onToggle={toggleLayer} />
          {visibleStatus ? (
            <p className="operational-map__status" role="status" data-state={visibleStatus}>
              {statusMessage(visibleStatus)}
            </p>
          ) : null}
          <MapDetailSheet feature={selectedFeature} onClose={() => setSelectedFeature(null)} />
        </>
      )}
    </section>
  )
}
