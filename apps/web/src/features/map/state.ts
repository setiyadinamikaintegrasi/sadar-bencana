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
  mapLayers: [...PUBLIC_OPERATIONAL_MAP_LAYERS],
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

export function readMapViewState(search = window.location.search): MapViewState {
  const params = createSearchParams(search)
  const mapTime = params.get('mapTime') || undefined

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
