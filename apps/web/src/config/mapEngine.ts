export type OperationalMapEngine = 'leaflet' | 'maplibre'

export function getOperationalMapEngine(
  value = import.meta.env.VITE_OPERATIONAL_MAP_ENGINE,
): OperationalMapEngine {
  return value === 'maplibre' ? 'maplibre' : 'leaflet'
}
