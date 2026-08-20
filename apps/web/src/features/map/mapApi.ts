import type {
  OperationalMapFeature,
  OperationalMapFeatureCollection,
  OperationalMapWireLayer,
  PublicOperationalMapLayer,
  PrivateOperationalMapLayer,
} from './types'
import { request } from '../../lib/api/client'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1'
const MAXIMUM_VIEWPORT_DEGREES = 20
const DATA_VINTAGE_STALE_AFTER_MS = 2 * 60 * 60 * 1000
const RFC3339_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/

export const publicMapEndpoints = {
  events: '/map/operations/events',
  'official-alerts': '/map/operations/alerts',
  'air-quality': '/map/operations/air-quality',
  evacuations: '/map/operations/evacuations',
  aircraft: '/map/operations/aircraft',
  shakemaps: '/map/operations/shakemaps',
  'flood-areas': '/map/operations/flood-areas',
} as const satisfies Record<PublicOperationalMapLayer, string>

export const privateMapEndpoints = {
  'watch-zones': '/me/map/watch-zones',
  'personal-assets': '/me/map/personal-assets',
} as const satisfies Record<PrivateOperationalMapLayer, string>

const publicMapWireLayers: Record<PublicOperationalMapLayer, OperationalMapWireLayer> = {
  events: 'events',
  'official-alerts': 'alerts',
  'air-quality': 'air-quality',
  evacuations: 'evacuations',
  aircraft: 'aircraft',
  shakemaps: 'shakemaps',
  'flood-areas': 'flood-areas',
}

const EVENT_PERILS = new Set(['earthquake', 'wildfire', 'flood', 'volcano'])

// Jendela waktu feed events per peril. Peta operasional default 72 jam;
// peril dengan aktivitas jarang (vulkanik, banjir) memakai jendela lebih
// lebar agar event lama yang masih relevan ikut tampil saat difilter.
// Nilai harus konsisten dengan cap server operationMapMaximum{Volcano,Flood}Window.
const EVENT_WINDOW_HOURS: Record<string, number> = {
  volcano: 90 * 24,
  flood: 365 * 24,
}

function eventWindowHoursFor(perils: readonly string[] | undefined): number {
  let hours = 72
  for (const peril of normalizedPerils(perils)) {
    const wider = EVENT_WINDOW_HOURS[peril]
    if (wider && wider > hours) hours = wider
  }
  return hours
}

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

export interface PrivateMapLayerResult {
  layer: PrivateOperationalMapLayer
  state: PublicMapLayerState
  collection?: OperationalMapFeatureCollection
}

export type PublicMapLayerHealth = 'loading' | 'current' | 'stale' | 'unavailable' | 'empty'

export interface PublicMapLayerViewState {
  collection?: OperationalMapFeatureCollection
  health: PublicMapLayerHealth
  refreshFailed?: boolean
  refreshing: boolean
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
  if (!value) return undefined
  const match = RFC3339_TIMESTAMP.exec(value)
  if (!match) return undefined
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return undefined
  const date = new Date(timestamp)
  if (
    date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() + 1 !== Number(match[2])
    || date.getUTCDate() !== Number(match[3])
    || date.getUTCHours() !== Number(match[4])
    || date.getUTCMinutes() !== Number(match[5])
    || date.getUTCSeconds() !== Number(match[6])
  ) return undefined
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
    const perils = normalizedPerils(viewport.perils)
    if (mapTime) {
      const to = new Date(mapTime)
      params.set('from', new Date(to.getTime() - 72 * 60 * 60 * 1000).toISOString())
      params.set('to', mapTime)
    } else {
      // Tanpa mapTime (tampilan live) peril jarang memakai jendela historis
      // lebih lebar; peril lain tetap memakai default 72 jam server.
      const windowHours = eventWindowHoursFor(perils)
      if (windowHours > 72) {
        const to = new Date()
        params.set('from', new Date(to.getTime() - windowHours * 60 * 60 * 1000).toISOString())
        params.set('to', to.toISOString())
      }
    }
    if (perils.length > 0) params.set('perils', perils.join(','))
  } else if (layer === 'aircraft') {
    // Snapshot live: tanpa parameter waktu — selalu posisi termutakhir.
  } else if (layer === 'shakemaps' || layer === 'flood-areas') {
    // Snapshot live: tanpa parameter waktu.
  } else if (mapTime) {
    params.set('at', mapTime)
  }

  return `${API_BASE_URL}${publicMapEndpoints[layer]}?${params.toString()}`
}

function isPosition(value: unknown): value is GeoJSON.Position {
  return Array.isArray(value)
    && value.length >= 2
    && value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
    && value[0] >= -180
    && value[0] <= 180
    && value[1] >= -90
    && value[1] <= 90
}

function samePosition(left: GeoJSON.Position, right: GeoJSON.Position): boolean {
  return left[0] === right[0] && left[1] === right[1]
}

function isLinearRing(value: unknown): value is GeoJSON.Position[] {
  return Array.isArray(value)
    && value.length >= 4
    && value.every(isPosition)
    && samePosition(value[0], value[value.length - 1])
}

function isGeometry(value: unknown): value is GeoJSON.Geometry {
  if (!value || typeof value !== 'object') return false
  const geometry = value as { type?: unknown; coordinates?: unknown }
  if (geometry.type === 'Point') return isPosition(geometry.coordinates)
  if (geometry.type === 'Polygon') return Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0 && geometry.coordinates.every(isLinearRing)
  if (geometry.type === 'MultiPolygon') {
    return Array.isArray(geometry.coordinates)
      && geometry.coordinates.length > 0
      && geometry.coordinates.every((polygon) => Array.isArray(polygon) && polygon.length > 0 && polygon.every(isLinearRing))
  }
  return false
}

function hasOptionalPropertyTypes(properties: Record<string, unknown>): boolean {
  const strings = ['peril_type', 'severity', 'source_url', 'observed_at', 'effective_at', 'expires_at', 'data_vintage', 'pollutant', 'unit', 'category', 'location_type']
  const timestamps = ['observed_at', 'effective_at', 'expires_at', 'data_vintage']
  if (strings.some((key) => key in properties && typeof properties[key] !== 'string')) return false
  if (timestamps.some((key) => key in properties && !normalizedTimestamp(properties[key] as string))) return false
  if ('value' in properties && (typeof properties.value !== 'number' || !Number.isFinite(properties.value))) return false
  return !['stale', 'open', 'full'].some((key) => key in properties && typeof properties[key] !== 'boolean')
}

function isFeature(feature: unknown, expectedLayer: OperationalMapWireLayer): feature is OperationalMapFeature {
  if (!feature || typeof feature !== 'object') return false
  const value = feature as Partial<OperationalMapFeature>
  const properties = value.properties
  return value.type === 'Feature'
    && typeof value.id === 'string'
    && isGeometry(value.geometry)
    && typeof properties === 'object'
    && properties !== null
    && properties.layer === expectedLayer
    && typeof properties.id === 'string'
    && typeof properties.label === 'string'
    && typeof properties.source === 'string'
    && typeof properties.attribution === 'string'
    && typeof properties.verification_status === 'string'
    && hasOptionalPropertyTypes(properties as unknown as Record<string, unknown>)
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
    const vintageValue = normalizedTimestamp(properties.data_vintage)
    if (!vintageValue) return false
    const vintage = Date.parse(vintageValue)
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

export async function fetchPrivateMapLayer(
  layer: PrivateOperationalMapLayer,
  viewport: PublicMapViewport,
  signal?: AbortSignal,
): Promise<PrivateMapLayerResult> {
  if (!validViewport(viewport)) return { layer, state: 'unavailable' }

  const params = new URLSearchParams({ bbox: viewport.bbox.join(',') })
  try {
    const body = await request<unknown>(`${privateMapEndpoints[layer]}?${params.toString()}`, {
      method: 'GET',
      signal,
    })
    if (!isCollection(body, layer)) return { layer, state: 'unavailable' }
    return {
      layer,
      state: body.features.length === 0 ? 'empty' : 'ready',
      collection: body,
    }
  } catch {
    return { layer, state: 'unavailable' }
  }
}
