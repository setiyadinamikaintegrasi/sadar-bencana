import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { MapDetailSheet } from './MapDetailSheet'
import { MapLegend } from './MapLegend'
import { fetchPrivateMapLayer, fetchPublicMapLayer, type PublicMapLayerViewState, type PublicMapViewport } from './mapApi'
import { airQualityLayer } from './layers/airQuality'
import { evacuationsLayer } from './layers/evacuations'
import { EVENTS_PULSE_LAYERS, eventsLayer, setEventsHeatmapVisible } from './layers/events'
import { OFFICIAL_ALERTS_PULSE_LAYERS, officialAlertsLayer } from './layers/officialAlerts'
import { fallbackFrame, fetchLatestWeatherRadarFrame, weatherRadarLayer, type WeatherRadarFrame } from './layers/weatherRadar'
import { setGlobeProjection, terrainLayer } from './layers/terrain'
import { PitchControl } from './PitchControl'
import { localPrivateOverlayAdapter, privateLayerAdapters } from './layers/private'
import { readMapViewState, writeMapViewState, type MapViewState } from './state'
import { OPERATIONAL_MAP_WIRE_LAYERS, type OperationalMapFeature, type OperationalMapFeatureCollection, type OperationalMapFeatureProperties, type PrivateOperationalMapLayer, type PublicOperationalMapLayer } from './types'

// This public style is a reviewed application constant, never user-controlled input.
export const OPERATIONAL_MAP_BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

const OPERATIONAL_MAP_ID_PREFIX = 'operational-map-'

export type OperationalMapMode = 'viewer' | 'picker'
export type OperationalMapStatus = 'loading' | 'empty' | 'stale' | 'unavailable'
export type OperationalMapFocusRequest = {
  id?: string
  geometry?: GeoJSON.Geometry
  nonce: number
}

const MAP_REFRESH_DEBOUNCE_MS = 250
// Frame radar cuaca berganti tiap 10 menit; refresh tiap 5 menit aman.
const WEATHER_RADAR_REFRESH_MS = 5 * 60 * 1000

// Denyut severity: kritis berkedip lebih cepat (siklus ~800ms) daripada
// tinggi (~1600ms) agar hierarki urgensi langsung terbaca di peta.
const PULSE_INTERVAL_MS = 400
const PULSE_OPACITY = {
  criticalOn: 0.55,
  criticalOff: 0.12,
  highOn: 0.4,
  highOff: 0.08,
} as const

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function setPulsePaint(map: maplibregl.Map, layerId: string, property: 'circle-opacity' | 'line-opacity', opacity: number): void {
  if (typeof map.getLayer !== 'function' || typeof map.setPaintProperty !== 'function') return
  if (map.getLayer(layerId)) map.setPaintProperty(layerId, property, opacity)
}

const EMPTY_CONTROLLED_COLLECTIONS: Partial<Record<PublicOperationalMapLayer, OperationalMapFeatureCollection>> = {}

const layerAdapters = {
  events: eventsLayer,
  'official-alerts': officialAlertsLayer,
  'air-quality': airQualityLayer,
  evacuations: evacuationsLayer,
} as const

export interface OperationalMapProps {
  mode?: OperationalMapMode
  status?: OperationalMapStatus
  className?: string
  initialLayers?: readonly PublicOperationalMapLayer[]
  visibleLayers?: readonly PublicOperationalMapLayer[]
  controlledCollections?: Partial<Record<PublicOperationalMapLayer, OperationalMapFeatureCollection>>
  showLegend?: boolean
  perils?: readonly string[]
  mapTime?: string | null
  authenticated?: boolean
  privateOwnerKey?: string
  privateLayers?: readonly PrivateOperationalMapLayer[]
  onPick?: (latitude: number, longitude: number) => void
  onFeatureSelect?: (feature: OperationalMapFeature) => void
  onViewportChange?: (viewport: PublicMapViewport) => void
  localOverlay?: GeoJSON.FeatureCollection
  focusCenter?: readonly [number, number]
  focusRequest?: OperationalMapFocusRequest | null
}

function geometryBounds(geometry: GeoJSON.Geometry): [[number, number], [number, number]] | undefined {
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon' && geometry.type !== 'LineString' && geometry.type !== 'MultiLineString') return undefined
  const points: number[][] = []
  const collect = (coordinates: unknown): void => {
    if (!Array.isArray(coordinates)) return
    if (coordinates.length >= 2 && typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
      points.push(coordinates as number[])
      return
    }
    coordinates.forEach(collect)
  }
  collect(geometry.coordinates)
  if (points.length === 0) return undefined
  return [
    [Math.min(...points.map((point) => point[0])), Math.min(...points.map((point) => point[1]))],
    [Math.max(...points.map((point) => point[0])), Math.max(...points.map((point) => point[1]))],
  ]
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
  initialLayers,
  visibleLayers,
  controlledCollections = EMPTY_CONTROLLED_COLLECTIONS,
  showLegend = true,
  perils = [],
  mapTime,
  authenticated = false,
  privateOwnerKey,
  privateLayers = [],
  onPick,
  onFeatureSelect,
  onViewportChange,
  localOverlay,
  focusCenter,
  focusRequest,
}: OperationalMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const viewStateRef = useRef<MapViewState>({
    ...readMapViewState(),
    ...(visibleLayers ? { mapLayers: [...visibleLayers] } : initialLayers ? { mapLayers: [...initialLayers] } : {}),
    ...(focusCenter ? { mapLng: focusCenter[0], mapLat: focusCenter[1] } : {}),
    ...(mapTime !== undefined ? { mapTime: mapTime ?? undefined } : {}),
  })
  const enabledLayersRef = useRef<PublicOperationalMapLayer[]>(viewStateRef.current.mapLayers)
  const perilsRef = useRef<readonly string[]>(perils)
  const controlledCollectionsRef = useRef(controlledCollections)
  const collectionsRef = useRef<Partial<Record<PublicOperationalMapLayer, OperationalMapFeatureCollection>>>({})
  const focusRequestRef = useRef(focusRequest)
  const privateLayersRef = useRef<PrivateOperationalMapLayer[]>(authenticated && privateOwnerKey ? [...privateLayers] : [])
  const onPickRef = useRef(onPick)
  const onFeatureSelectRef = useRef(onFeatureSelect)
  const onViewportChangeRef = useRef(onViewportChange)
  const localOverlayRef = useRef(localOverlay)
  const loadLayersRef = useRef<(() => void) | null>(null)
  const synchronizeVisibleLayersRef = useRef<((layers: PublicOperationalMapLayer[]) => void) | null>(null)
  const synchronizeControlledCollectionsRef = useRef<((collections: Partial<Record<PublicOperationalMapLayer, OperationalMapFeatureCollection>>) => void) | null>(null)
  const synchronizeFocusRef = useRef<(() => void) | null>(null)
  const synchronizeMapTimeRef = useRef<((nextMapTime: string | null) => void) | null>(null)
  const synchronizePrivateLayersRef = useRef<((ownerKey: string | undefined, layers: PrivateOperationalMapLayer[]) => void) | null>(null)
  const synchronizeLocalOverlayRef = useRef<((data: GeoJSON.FeatureCollection | undefined) => void) | null>(null)
  const focusCenterRef = useRef<((center: readonly [number, number]) => void) | null>(null)
  const [ready, setReady] = useState(false)
  const [fallback, setFallback] = useState(false)
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null)
  const [enabledLayers, setEnabledLayers] = useState<PublicOperationalMapLayer[]>(enabledLayersRef.current)
  const [layerStates, setLayerStates] = useState<Partial<Record<PublicOperationalMapLayer, PublicMapLayerViewState>>>({})
  const [selectedFeature, setSelectedFeature] = useState<OperationalMapFeature | null>(null)
  // Fitur di bawah kursor untuk tooltip hover + highlight (Paket A #2).
  const [hoverFeature, setHoverFeature] = useState<OperationalMapFeature | null>(null)
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null)
  const [heatmapOn, setHeatmapOn] = useState(false)
  // Overlay radar cuaca (RainViewer) + vintage frame terpasang.
  const [radarOn, setRadarOn] = useState(false)
  const [radarVintage, setRadarVintage] = useState<string | null>(null)
  const radarVisibleRef = useRef(false)
  // Terrain 3D (DEM AWS Terrarium) + proyeksi globe.
  const [terrainOn, setTerrainOn] = useState(false)
  const [globeOn, setGlobeOn] = useState(false)
  const terrainVisibleRef = useRef(false)
  const globeRef = useRef(false)

  perilsRef.current = perils
  onPickRef.current = onPick
  onFeatureSelectRef.current = onFeatureSelect
  onViewportChangeRef.current = onViewportChange
  focusRequestRef.current = focusRequest

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapRef.current) return

    const viewState = viewStateRef.current
    let map: maplibregl.Map | null = null
    let observer: ResizeObserver | undefined
    let refreshTimer: number | undefined
    let refreshController: AbortController | undefined
    let refreshRevision = 0
    let privateController: AbortController | undefined
    let privateRevision = 0
    let currentPrivateOwnerKey = authenticated ? privateOwnerKey : undefined
    const registeredPrivateLayers = new Set<PrivateOperationalMapLayer>()
    let mapLoaded = false
    let disposed = false
    let suppressNextCameraWrite = false
    let lastFocusedRequestKey: string | undefined
    let pulseTimer: number | undefined
    let radarTimer: number | undefined

    const focusGeometry = (geometry: GeoJSON.Geometry) => {
      if (!map) return
      suppressNextCameraWrite = true
      if (geometry.type === 'Point') {
        map.easeTo({ center: geometry.coordinates as [number, number], zoom: Math.max(map.getZoom(), 7) })
        return
      }
      const bounds = geometryBounds(geometry)
      if (bounds) map.fitBounds(bounds, { padding: 32, maxZoom: 9 })
    }

    const synchronizeFocus = () => {
      const request = focusRequestRef.current
      if (request === null) {
        setSelectedFeature(null)
        lastFocusedRequestKey = undefined
        return
      }
      if (!request || !map || !mapLoaded) return
      const requestKey = `${request.id ?? ''}:${request.nonce}`
      const selected = request.id
        ? Object.values(collectionsRef.current).flatMap((collection) => collection?.features ?? []).find((feature) => feature.id === request.id)
        : undefined
      if (selected) {
        setSelectedFeature(selected)
        if (lastFocusedRequestKey !== requestKey) focusGeometry(selected.geometry)
      } else if (request.geometry) {
        if (lastFocusedRequestKey !== requestKey) focusGeometry(request.geometry)
      }
      if (selected || request.geometry) lastFocusedRequestKey = requestKey
    }

    const applyControlledCollections = () => {
      if (!map || !mapLoaded) return
      const nextStates: Partial<Record<PublicOperationalMapLayer, PublicMapLayerViewState>> = {}
      for (const layer of enabledLayersRef.current) {
        const collection = controlledCollectionsRef.current[layer]
        if (!collection) continue
        layerAdapters[layer].apply(map, collection)
        collectionsRef.current[layer] = collection
        nextStates[layer] = {
          collection,
          health: collection.features.length === 0 ? 'empty' : 'current',
          refreshing: false,
        }
      }
      if (Object.keys(nextStates).length > 0) setLayerStates((current) => ({ ...current, ...nextStates }))
      synchronizeFocus()
    }

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
      applyControlledCollections()
      const layers = enabledLayersRef.current.filter((layer) => !controlledCollectionsRef.current[layer])
      if (layers.length === 0) {
        return
      }

      const viewport = { ...publicViewport(map, viewStateRef.current), perils: perilsRef.current }
      void Promise.all(layers.map((layer) => fetchPublicMapLayer(layer, viewport, controller.signal))).then((nextResults) => {
        if (disposed || revision !== refreshRevision || controller.signal.aborted || !map) return
        for (const result of nextResults) {
          if (result.collection) {
            layerAdapters[result.layer].apply(map, result.collection)
            collectionsRef.current[result.layer] = result.collection
          }
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
        synchronizeFocus()
      })
    }

    const synchronizeVisibleLayers = (nextLayers: PublicOperationalMapLayer[]) => {
      const previousLayers = enabledLayersRef.current
      enabledLayersRef.current = nextLayers
      setEnabledLayers(nextLayers)
      for (const layer of previousLayers) {
        if (nextLayers.includes(layer) || !map) continue
        layerAdapters[layer].remove(map)
        delete collectionsRef.current[layer]
      }
      setLayerStates((current) => Object.fromEntries(
        Object.entries(current).filter(([layer]) => nextLayers.includes(layer as PublicOperationalMapLayer)),
      ))
      setSelectedFeature((selected) => selected && !nextLayers.includes(
        selected.properties.layer === 'alerts' ? 'official-alerts' : selected.properties.layer as PublicOperationalMapLayer,
      ) ? null : selected)
      loadPublicLayers()
    }

    const detachPrivateLayer = (layer: PrivateOperationalMapLayer) => {
      if (!map) return
      const adapter = privateLayerAdapters[layer]
      if (registeredPrivateLayers.has(layer)) {
        for (const layerId of adapter.layerIds) map.off('click', layerId, selectFeature)
        registeredPrivateLayers.delete(layer)
      }
      adapter.remove(map)
    }

    const clearPrivateLayers = () => {
      privateRevision += 1
      privateController?.abort()
      privateController = undefined
      for (const layer of Object.keys(privateLayerAdapters) as PrivateOperationalMapLayer[]) {
        detachPrivateLayer(layer)
      }
      setSelectedFeature((selected) => selected && selected.properties.layer in privateLayerAdapters
        ? null
        : selected)
    }

    const loadPrivateLayers = () => {
      if (disposed || !map || !mapLoaded || privateLayersRef.current.length === 0) return
      privateRevision += 1
      const revision = privateRevision
      privateController?.abort()
      const controller = new AbortController()
      privateController = controller
      const viewport = publicViewport(map, viewStateRef.current)
      const layers = [...privateLayersRef.current]
      void Promise.all(layers.map((layer) => fetchPrivateMapLayer(layer, viewport, controller.signal))).then((results) => {
        if (disposed || !map || revision !== privateRevision || controller.signal.aborted) return
        for (const result of results) {
          if (!result.collection) continue
          const adapter = privateLayerAdapters[result.layer]
          adapter.apply(map, result.collection)
          if (!registeredPrivateLayers.has(result.layer)) {
            for (const layerId of adapter.layerIds) map.on('click', layerId, selectFeature)
            registeredPrivateLayers.add(result.layer)
          }
        }
        setSelectedFeature((selected) => {
          if (!selected || !(selected.properties.layer in privateLayerAdapters)) return selected
          const refreshed = results.find((result) => result.layer === selected.properties.layer)
          if (!refreshed?.collection) return selected
          return refreshed.collection.features.find((feature) => feature.id === selected.id) ?? null
        })
      })
    }

    const synchronizePrivateLayers = (nextOwnerKey: string | undefined, nextLayers: PrivateOperationalMapLayer[]) => {
      if (currentPrivateOwnerKey !== nextOwnerKey) {
        clearPrivateLayers()
        currentPrivateOwnerKey = nextOwnerKey
        privateLayersRef.current = nextLayers
        if (nextOwnerKey) loadPrivateLayers()
        return
      }
      const previousLayers = privateLayersRef.current
      privateLayersRef.current = nextLayers
      for (const layer of previousLayers) {
        if (!nextLayers.includes(layer)) detachPrivateLayer(layer)
      }
      setSelectedFeature((selected) => {
        if (!selected || !(selected.properties.layer in privateLayerAdapters)) return selected
        return nextLayers.includes(selected.properties.layer as PrivateOperationalMapLayer) ? selected : null
      })
      if (nextLayers.length === 0) {
        clearPrivateLayers()
        return
      }
      loadPrivateLayers()
    }

    const synchronizeLocalOverlay = (data: GeoJSON.FeatureCollection | undefined) => {
      localOverlayRef.current = data
      if (!map || !mapLoaded) return
      if (data && data.features.length > 0) localPrivateOverlayAdapter.apply(map, data)
      else localPrivateOverlayAdapter.remove(map)
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
      loadPrivateLayers()
      synchronizeLocalOverlay(localOverlayRef.current)
      // Radar cuaca (RainViewer): pasang sekali di bawah layer titik agar
      // overlay hujan tidak menutupi marker. Frame di-refresh berkala.
      if (mode === 'viewer' && map) {
        const applyRadar = (frame: WeatherRadarFrame | null) => {
          if (!map || disposed) return
          weatherRadarLayer.apply(map, frame ?? fallbackFrame())
          weatherRadarLayer.setVisible(map, radarVisibleRef.current)
          setRadarVintage(frame?.time ? new Date(frame.time * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : null)
        }
        void fetchLatestWeatherRadarFrame().then(applyRadar)
        radarTimer = window.setInterval(() => {
          if (disposed) return
          void fetchLatestWeatherRadarFrame().then(applyRadar)
        }, WEATHER_RADAR_REFRESH_MS)

        // Terrain 3D (AWS Terrarium) + hillshade: dipasang sekali (sembunyi),
        // diaktifkan lewat toggle legenda. Globe dipulihkan dari state toggle.
        terrainLayer.apply(map)
        if (globeRef.current) setGlobeProjection(map, true)
      }
      if (map) onViewportChangeRef.current?.(publicViewport(map, viewStateRef.current))
    }

    const synchronizeView = (event?: { geolocateSource?: boolean }) => {
      if (disposed || !map) return
      onViewportChangeRef.current?.(publicViewport(map, viewStateRef.current))
      if (event?.geolocateSource) {
        schedulePublicLayers()
        loadPrivateLayers()
        return
      }
      if (suppressNextCameraWrite) {
        suppressNextCameraWrite = false
        schedulePublicLayers()
        loadPrivateLayers()
        return
      }

      const center = map.getCenter()
      const nextState: MapViewState = {
        ...viewStateRef.current,
        mapLng: center.lng,
        mapLat: center.lat,
        mapZoom: map.getZoom(),
      }
      viewStateRef.current = nextState
      if (mode !== 'picker') {
        const search = writeMapViewState(nextState)
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`)
      }
      schedulePublicLayers()
      loadPrivateLayers()
    }

    const selectFeature = (event: { features?: unknown[] }) => {
      const feature = mapFeatureFromClick(event.features?.[0])
      if (feature) {
        setSelectedFeature(feature)
        onFeatureSelectRef.current?.(feature)
      }
    }

    // Hover: tooltip mini + highlight marker (mousemove pada layer interaktif).
    const HOVERABLE_LAYER_IDS = [
      eventsLayer.layerIds[eventsLayer.layerIds.length - 1],
      officialAlertsLayer.layerIds[officialAlertsLayer.layerIds.length - 1],
      airQualityLayer.layerIds[airQualityLayer.layerIds.length - 1],
    ].filter((id) => id && !id.includes('heatmap'))
    const hoverFeatureFromEvent = (event: { features?: unknown[]; point?: { x: number; y: number } }): void => {
      const feature = mapFeatureFromClick(event.features?.[0])
      setHoverFeature(feature ?? null)
      setHoverPoint(event.point ? { x: event.point.x, y: event.point.y } : null)
      if (!map) return
      const canvas = map.getCanvas()
      canvas.style.cursor = feature ? 'pointer' : ''
    }
    const clearHover = (): void => {
      setHoverFeature(null)
      setHoverPoint(null)
      if (map) map.getCanvas().style.cursor = ''
    }

    const pickLocation = (event: { lngLat?: { lat: number; lng: number } }) => {
      if (event.lngLat) onPickRef.current?.(event.lngLat.lat, event.lngLat.lng)
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
      if (pulseTimer !== undefined) window.clearInterval(pulseTimer)
      if (radarTimer !== undefined) window.clearInterval(radarTimer)
      refreshController?.abort()
      privateController?.abort()
      loadLayersRef.current = null
      synchronizePrivateLayersRef.current = null
      synchronizeVisibleLayersRef.current = null
      synchronizeControlledCollectionsRef.current = null
      synchronizeFocusRef.current = null
      synchronizeMapTimeRef.current = null
      synchronizeLocalOverlayRef.current = null
      focusCenterRef.current = null

      const currentMap = map
      if (!currentMap) return

      currentMap.off('load', markReady)
      currentMap.off('moveend', synchronizeView)
      currentMap.off('webglcontextlost', showFallback)
      currentMap.off('click', pickLocation)
      currentMap.off('click', eventsLayer.layerIds[0], expandCluster)
      for (const layerId of HOVERABLE_LAYER_IDS) {
        currentMap.off('mousemove', layerId, hoverFeatureFromEvent)
        currentMap.off('mouseleave', layerId, clearHover)
      }
      for (const adapter of Object.values(layerAdapters)) {
        for (const layerId of adapter.layerIds) currentMap.off('click', layerId, selectFeature)
        adapter.remove(currentMap)
      }
      for (const layer of Object.keys(privateLayerAdapters) as PrivateOperationalMapLayer[]) detachPrivateLayer(layer)
      localPrivateOverlayAdapter.remove(currentMap)
      clearOperationalMapArtifacts(currentMap)
      currentMap.remove()
      if (mapRef.current === currentMap) mapRef.current = null
      setMapInstance(null)
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
    setMapInstance(map)
    loadLayersRef.current = loadPublicLayers
    synchronizeVisibleLayersRef.current = synchronizeVisibleLayers
    synchronizeControlledCollectionsRef.current = (collections) => {
      controlledCollectionsRef.current = collections
      applyControlledCollections()
      loadPublicLayers()
    }
    synchronizeFocusRef.current = synchronizeFocus
    synchronizeMapTimeRef.current = (nextMapTime) => {
      viewStateRef.current = { ...viewStateRef.current, mapTime: nextMapTime ?? undefined }
      if (mode !== 'picker') {
        const search = writeMapViewState(viewStateRef.current)
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`)
      }
      loadPublicLayers()
    }
    synchronizePrivateLayersRef.current = synchronizePrivateLayers
    synchronizeLocalOverlayRef.current = synchronizeLocalOverlay
    focusCenterRef.current = (center) => {
      if (!map) return
      suppressNextCameraWrite = true
      map.easeTo({ center: [...center], zoom: Math.max(map.getZoom(), 7) })
    }
    if (mode === 'viewer') {
      map.addControl(new maplibregl.NavigationControl(), 'top-right')
      map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'top-right')
      // Paket A #3: bar skala untuk estimasi jarak (evakuasi/dampak) dan
      // mode layar penuh untuk command center.
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 96, unit: 'metric' }), 'bottom-left')
      map.addControl(new maplibregl.FullscreenControl(), 'top-right')
    }

    map.on('load', markReady)
    map.on('moveend', synchronizeView)
    map.once('webglcontextlost', showFallback)
    map.on('click', pickLocation)
    for (const adapter of Object.values(layerAdapters)) {
      for (const layerId of adapter.layerIds) map.on('click', layerId, selectFeature)
    }
    map.on('click', eventsLayer.layerIds[0], expandCluster)

    // Hover tooltip pada layer titik interaktif (events/alerts/air-quality).
    for (const layerId of HOVERABLE_LAYER_IDS) {
      map.on('mousemove', layerId, hoverFeatureFromEvent)
      map.on('mouseleave', layerId, clearHover)
    }

    // Denyut severity di peta: dilewati bila pengguna meminta reduced motion
    // atau lingkungan tanpa matchMedia (jsdom).
    if (!prefersReducedMotion()) {
      let pulseTick = 0
      pulseTimer = window.setInterval(() => {
        if (disposed || !map) return
        pulseTick += 1
        const criticalOn = pulseTick % 2 === 0
        const highOn = Math.floor(pulseTick / 2) % 2 === 0
        setPulsePaint(map, EVENTS_PULSE_LAYERS.critical, 'circle-opacity', criticalOn ? PULSE_OPACITY.criticalOn : PULSE_OPACITY.criticalOff)
        setPulsePaint(map, EVENTS_PULSE_LAYERS.cluster, 'circle-opacity', criticalOn ? 0.5 : 0.14)
        setPulsePaint(map, OFFICIAL_ALERTS_PULSE_LAYERS.point, 'circle-opacity', criticalOn ? PULSE_OPACITY.criticalOn : PULSE_OPACITY.criticalOff)
        setPulsePaint(map, OFFICIAL_ALERTS_PULSE_LAYERS.outline, 'line-opacity', criticalOn ? 0.95 : 0.35)
        setPulsePaint(map, EVENTS_PULSE_LAYERS.high, 'circle-opacity', highOn ? PULSE_OPACITY.highOn : PULSE_OPACITY.highOff)
      }, PULSE_INTERVAL_MS)
    }

    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        if (!disposed && map) map.resize()
      })
      observer.observe(container)
    }

    return teardown
  }, [mode])

  const activePrivateOwnerKey = authenticated ? privateOwnerKey : undefined
  const privateLayerKey = activePrivateOwnerKey ? privateLayers.join(',') : ''
  useEffect(() => {
    synchronizePrivateLayersRef.current?.(activePrivateOwnerKey, activePrivateOwnerKey ? [...privateLayers] : [])
  }, [activePrivateOwnerKey, privateLayerKey])

  const perilKey = perils.join(',')
  useEffect(() => {
    loadLayersRef.current?.()
  }, [perilKey])

  const visibleLayerKey = visibleLayers?.join(',')
  useEffect(() => {
    if (visibleLayers) synchronizeVisibleLayersRef.current?.([...visibleLayers])
  }, [visibleLayerKey])

  useEffect(() => {
    synchronizeControlledCollectionsRef.current?.(controlledCollections)
  }, [controlledCollections])

  useEffect(() => {
    if (ready) synchronizeFocusRef.current?.()
  }, [focusRequest?.id, focusRequest?.nonce, ready])

  useEffect(() => {
    if (mapTime !== undefined) synchronizeMapTimeRef.current?.(mapTime)
  }, [mapTime])

  useEffect(() => {
    synchronizeLocalOverlayRef.current?.(localOverlay)
  }, [localOverlay])

  const focusKey = focusCenter?.join(',') ?? ''
  useEffect(() => {
    if (ready && focusCenter) focusCenterRef.current?.(focusCenter)
  }, [focusKey, ready])

  const toggleHeatmap = (next: boolean) => {
    setHeatmapOn(next)
    if (mapRef.current) setEventsHeatmapVisible(mapRef.current, next)
  }

  const toggleRadar = (next: boolean) => {
    setRadarOn(next)
    radarVisibleRef.current = next
    if (mapRef.current) weatherRadarLayer.setVisible(mapRef.current, next)
  }

  const toggleTerrain = (next: boolean) => {
    setTerrainOn(next)
    terrainVisibleRef.current = next
    if (mapRef.current) terrainLayer.setVisible(mapRef.current, next)
  }

  const toggleGlobe = (next: boolean) => {
    setGlobeOn(next)
    globeRef.current = next
    if (mapRef.current) setGlobeProjection(mapRef.current, next)
  }

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
          {mode === 'viewer' && showLegend ? (
            <MapLegend
              enabledLayers={enabledLayers}
              results={{}}
              layerStates={layerStates}
              onToggle={toggleLayer}
              heatmapOn={heatmapOn}
              onToggleHeatmap={toggleHeatmap}
              radarOn={radarOn}
              radarVintage={radarVintage}
              onToggleRadar={toggleRadar}
              terrainOn={terrainOn}
              onToggleTerrain={toggleTerrain}
              globeOn={globeOn}
              onToggleGlobe={toggleGlobe}
            />
          ) : null}
          {visibleStatus ? (
            <p className="operational-map__status" role="status" data-state={visibleStatus}>
              {statusMessage(visibleStatus)}
            </p>
          ) : null}
          {hoverFeature && hoverPoint ? (
            <div
              className="operational-map__hover-tip"
              role="status"
              style={{ left: hoverPoint.x + 12, top: hoverPoint.y + 12 }}
            >
              <p className="operational-map__hover-title">{hoverFeature.properties.label}</p>
              {hoverFeature.properties.severity ? (
                <p className="operational-map__hover-severity" data-tone={hoverFeature.properties.severity.toLowerCase()}>
                  {hoverFeature.properties.severity}
                </p>
              ) : null}
              {hoverFeature.properties.observed_at ? (
                <p className="operational-map__hover-time">{hoverFeature.properties.observed_at}</p>
              ) : null}
            </div>
          ) : null}
          {/* Kontrol kemiringan peta (tilt) tanpa ctrl+drag. */}
          {mode === 'viewer' && !fallback ? <PitchControl map={mapInstance} /> : null}
          <MapDetailSheet feature={selectedFeature} onClose={() => setSelectedFeature(null)} />
        </>
      )}
    </section>
  )
}
