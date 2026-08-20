import {
  PUBLIC_OPERATIONAL_MAP_LAYERS,
  type PublicOperationalMapLayer,
} from './types'

export const MAP_MIN_LONGITUDE = -180
export const MAP_MAX_LONGITUDE = 180
export const MAP_MIN_LATITUDE = -85.051129
export const MAP_MAX_LATITUDE = 85.051129
export const MAP_MIN_ZOOM = 0
export const MAP_MAX_ZOOM = 18
export const MAP_TIME_MAX_LENGTH = 35
export const MAP_TIME_WINDOW_MS = 72 * 60 * 60 * 1000

const RFC3339_MAP_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/

export interface MapViewState {
  mapLng: number
  mapLat: number
  mapZoom: number
  mapLayers: PublicOperationalMapLayer[]
  mapTime?: string
}

export const DEFAULT_MAP_VIEW_STATE: MapViewState = {
  mapLng: 118,
  mapLat: -2.5,
  mapZoom: 5,
  // Lalu lintas udara, shakemap MMI, & genangan banjir default nonaktif
  // (noise visual); aktif via legenda.
  mapLayers: PUBLIC_OPERATIONAL_MAP_LAYERS.filter(
    (layer) => layer !== 'aircraft' && layer !== 'shakemaps' && layer !== 'flood-areas',
  ),
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function readBoundedNumber(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value == null || value.trim() === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? clamp(parsed, minimum, maximum) : fallback
}

function isPublicOperationalMapLayer(value: string): value is PublicOperationalMapLayer {
  return (PUBLIC_OPERATIONAL_MAP_LAYERS as readonly string[]).includes(value)
}

function parsePublicLayers(value: string | null): PublicOperationalMapLayer[] {
  if (value == null) return [...PUBLIC_OPERATIONAL_MAP_LAYERS]

  const seen = new Set<PublicOperationalMapLayer>()
  return value.split(',').filter((layer): layer is PublicOperationalMapLayer => {
    if (!isPublicOperationalMapLayer(layer) || seen.has(layer)) return false
    seen.add(layer)
    return true
  })
}

function createSearchParams(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
}

function parseMapTime(value: string | null, now = Date.now()): string | undefined {
  if (value == null || value.length === 0 || value.length > MAP_TIME_MAX_LENGTH) return undefined
  const match = RFC3339_MAP_TIME.exec(value)
  if (!match) return undefined

  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || timestamp < now - MAP_TIME_WINDOW_MS || timestamp > now) return undefined

  const offsetMinutes = match[7] === 'Z'
    ? 0
    : (match[8] === '+' ? 1 : -1) * (Number(match[9]) * 60 + Number(match[10]))
  if (Math.abs(offsetMinutes) > 23 * 60 + 59) return undefined

  const local = new Date(timestamp + offsetMinutes * 60 * 1000)
  if (
    local.getUTCFullYear() !== Number(match[1])
    || local.getUTCMonth() + 1 !== Number(match[2])
    || local.getUTCDate() !== Number(match[3])
    || local.getUTCHours() !== Number(match[4])
    || local.getUTCMinutes() !== Number(match[5])
    || local.getUTCSeconds() !== Number(match[6])
  ) return undefined

  return new Date(timestamp).toISOString()
}

export function readMapViewState(search = window.location.search): MapViewState {
  const params = createSearchParams(search)
  const mapTime = parseMapTime(params.get('mapTime'))

  return {
    mapLng: readBoundedNumber(params.get('mapLng'), DEFAULT_MAP_VIEW_STATE.mapLng, MAP_MIN_LONGITUDE, MAP_MAX_LONGITUDE),
    mapLat: readBoundedNumber(params.get('mapLat'), DEFAULT_MAP_VIEW_STATE.mapLat, MAP_MIN_LATITUDE, MAP_MAX_LATITUDE),
    mapZoom: readBoundedNumber(params.get('mapZoom'), DEFAULT_MAP_VIEW_STATE.mapZoom, MAP_MIN_ZOOM, MAP_MAX_ZOOM),
    mapLayers: parsePublicLayers(params.get('mapLayers')),
    ...(mapTime ? { mapTime } : {}),
  }
}

export function writeMapViewState(state: MapViewState, search = window.location.search): string {
  const params = createSearchParams(search)
  const normalized = readMapViewState(new URLSearchParams({
    mapLng: String(state.mapLng),
    mapLat: String(state.mapLat),
    mapZoom: String(state.mapZoom),
    mapLayers: state.mapLayers.join(','),
    ...(state.mapTime ? { mapTime: state.mapTime } : {}),
  }).toString())

  params.set('mapLng', String(normalized.mapLng))
  params.set('mapLat', String(normalized.mapLat))
  params.set('mapZoom', String(normalized.mapZoom))
  params.set('mapLayers', normalized.mapLayers.join(','))
  if (normalized.mapTime) {
    params.set('mapTime', normalized.mapTime)
  } else {
    params.delete('mapTime')
  }

  const next = params.toString()
  return next ? `?${next}` : ''
}
