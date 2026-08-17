export const PUBLIC_OPERATIONAL_MAP_LAYERS = [
  'events',
  'official-alerts',
  'air-quality',
  'evacuations',
] as const

export const PRIVATE_OPERATIONAL_MAP_LAYERS = [
  'watch-zones',
  'personal-assets',
] as const

export type PublicOperationalMapLayer = typeof PUBLIC_OPERATIONAL_MAP_LAYERS[number]
export type PrivateOperationalMapLayer = typeof PRIVATE_OPERATIONAL_MAP_LAYERS[number]
export type OperationalMapLayer = PublicOperationalMapLayer | PrivateOperationalMapLayer

export const OPERATIONAL_MAP_WIRE_LAYERS = [
  'events',
  'alerts',
  'air-quality',
  'evacuations',
  'watch-zones',
  'personal-assets',
] as const

export type OperationalMapWireLayer = typeof OPERATIONAL_MAP_WIRE_LAYERS[number]

export function sourceQualifiedOperationalMapID(source: string, sourceID: string): string {
  return `${source}:${sourceID}`
}

export interface OperationalMapFeatureProperties {
  id: string
  layer: OperationalMapWireLayer
  label: string
  peril_type?: string
  severity?: string
  source: string
  attribution: string
  source_url?: string
  verification_status: string
  /** Rank numerik severity 0–4 (dihitung client-side oleh layer events). */
  severity_rank?: number
  observed_at?: string
  effective_at?: string
  expires_at?: string
  data_vintage?: string
  pollutant?: string
  value?: number
  unit?: string
  category?: string
  stale?: boolean
  location_type?: string
  open?: boolean
  full?: boolean
}

export interface OperationalMapFeature {
  type: 'Feature'
  id: string
  geometry: GeoJSON.Geometry
  properties: OperationalMapFeatureProperties
}

export interface OperationalMapFeatureCollection {
  type: 'FeatureCollection'
  features: OperationalMapFeature[]
  truncated: boolean
  layer: OperationalMapWireLayer
}
