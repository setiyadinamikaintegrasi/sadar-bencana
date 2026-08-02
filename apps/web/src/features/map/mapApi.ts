import type {
  OperationalMapFeature,
  OperationalMapFeatureCollection,
  OperationalMapWireLayer,
  PublicOperationalMapLayer,
} from './types'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1'
const MAXIMUM_VIEWPORT_DEGREES = 20
const DATA_VINTAGE_STALE_AFTER_MS = 2 * 60 * 60 * 1000
const RFC3339_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/

export const publicMapEndpoints = {
  events: '/map/operations/events',
  'official-alerts': '/map/operations/alerts',
  'air-quality': '/map/operations/air-quality',
  evacuations: '/map/operations/evacuations',
} as const satisfies Record<PublicOperationalMapLayer, string>

const publicMapWireLayers: Record<PublicOperationalMapLayer, OperationalMapWireLayer> = {
  events: 'events',
  'official-alerts': 'alerts',
  'air-quality': 'air-quality',
  evacuations: 'evacuations',
}

const EVENT_PERILS = new Set(['earthquake', 'wildfire', 'flood', 'volcano'])

export interface PublicMapViewport {
  bbox: readonly [number, number, number, number]
  zoom: number
  mapTime?: string
  perils?: readonly string[]
}

export type PublicMapLayerState = 'ready' | 'empty' | 'stale' | 'unavailable'

export interface PublicMapLayerResult {
  layer: PublicOperationalMapLayer
  state: PublicMapLayerState
  collection?: OperationalMapFeatureCollection
}

function validViewport(viewport: PublicMapViewport): boolean {
  const [minLongitude, minLatitude, maxLongitude, maxLatitude] = viewport.bbox
  if (!viewport.bbox.every(Number.isFinite) || !Number.isInteger(viewport.zoom)) return false
  if (viewport.zoom < 0 || viewport.zoom > 18) return false
  if (minLongitude < -180 || maxLongitude > 180 || minLatitude < -90 || maxLatitude > 90) return false
  if (minLongitude >= maxLongitude || minLatitude >= maxLatitude) return false
  return maxLongitude - minLongitude <= MAXIMUM_VIEWPORT_DEGREES
    && maxLatitude - minLatitude <= MAXIMUM_VIEWPORT_DEGREES
}

function normalizedTimestamp(value: string | undefined): string | undefined {
  if (!value || !RFC3339_TIMESTAMP.test(value)) return undefined
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return undefined
  return new Date(timestamp).toISOString()
}

function normalizedPerils(perils: readonly string[] | undefined): string[] {
  if (!perils) return []
  const selected = new Set<string>()
  for (const peril of perils) {
    const normalized = peril.trim().toLowerCase()
    if (EVENT_PERILS.has(normalized)) selected.add(normalized)
  }
  return [...selected]
}

function requestPath(layer: PublicOperationalMapLayer, viewport: PublicMapViewport): string | undefined {
  if (!validViewport(viewport)) return undefined

  const params = new URLSearchParams({
    bbox: viewport.bbox.join(','),
    zoom: String(viewport.zoom),
  })
  const mapTime = normalizedTimestamp(viewport.mapTime)
  if (viewport.mapTime && !mapTime) return undefined

  if (layer === 'events') {
    if (mapTime) {
      const to = new Date(mapTime)
      params.set('from', new Date(to.getTime() - 72 * 60 * 60 * 1000).toISOString())
      params.set('to', mapTime)
    }
    const perils = normalizedPerils(viewport.perils)
    if (perils.length > 0) params.set('perils', perils.join(','))
  } else if (mapTime) {
    params.set('at', mapTime)
  }

  return `${API_BASE_URL}${publicMapEndpoints[layer]}?${params.toString()}`
}

function isFeature(feature: unknown, expectedLayer: OperationalMapWireLayer): feature is OperationalMapFeature {
  if (!feature || typeof feature !== 'object') return false
  const value = feature as Partial<OperationalMapFeature>
  const properties = value.properties
  return value.type === 'Feature'
    && typeof value.id === 'string'
    && Boolean(value.geometry)
    && typeof properties === 'object'
    && properties !== null
    && properties.layer === expectedLayer
    && typeof properties.id === 'string'
    && typeof properties.label === 'string'
    && typeof properties.source === 'string'
    && typeof properties.attribution === 'string'
    && typeof properties.verification_status === 'string'
}

function isCollection(value: unknown, expectedLayer: OperationalMapWireLayer): value is OperationalMapFeatureCollection {
  if (!value || typeof value !== 'object') return false
  const collection = value as Partial<OperationalMapFeatureCollection>
  return collection.type === 'FeatureCollection'
    && collection.layer === expectedLayer
    && typeof collection.truncated === 'boolean'
    && Array.isArray(collection.features)
    && collection.features.every((feature) => isFeature(feature, expectedLayer))
}

function hasStaleVintage(collection: OperationalMapFeatureCollection): boolean {
  const staleBefore = Date.now() - DATA_VINTAGE_STALE_AFTER_MS
  return collection.features.some(({ properties }) => {
    if (properties.stale) return true
    if (!properties.data_vintage || !RFC3339_TIMESTAMP.test(properties.data_vintage)) return false
    const vintage = Date.parse(properties.data_vintage)
    return Number.isFinite(vintage) && vintage < staleBefore
  })
}

export async function fetchPublicMapLayer(
  layer: PublicOperationalMapLayer,
  viewport: PublicMapViewport,
  signal?: AbortSignal,
): Promise<PublicMapLayerResult> {
  const path = requestPath(layer, viewport)
  if (!path) return { layer, state: 'unavailable' }

  try {
    const response = await fetch(path, {
      method: 'GET',
      credentials: 'omit',
      signal,
    })
    if (!response.ok) return { layer, state: 'unavailable' }

    const body: unknown = await response.json()
    const expectedLayer = publicMapWireLayers[layer]
    if (!isCollection(body, expectedLayer)) return { layer, state: 'unavailable' }

    if (body.features.length === 0) return { layer, state: 'empty', collection: body }
    return {
      layer,
      state: hasStaleVintage(body) ? 'stale' : 'ready',
      collection: body,
    }
  } catch {
    return { layer, state: 'unavailable' }
  }
}
