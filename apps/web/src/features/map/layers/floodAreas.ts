import type { FilterSpecification, Map as MapLibreMap } from 'maplibre-gl'
import type { OperationalMapFeatureCollection } from '../types'

/**
 * S7 — Layer status genangan banjir per area RW/RT (PetaBencana/BPBD).
 * Poligon berwarna per kedalaman (location_type = "state-1".."state-4"):
 * kuning (10-30cm), oranye (30-70), merah (70-150), magenta (>150).
 */

const FLOOD_AREAS_SOURCE_ID = 'operational-map-flood-areas-source'
const FLOOD_AREAS_FILL_LAYER_ID = 'operational-map-flood-areas-fill'
const FLOOD_AREAS_OUTLINE_LAYER_ID = 'operational-map-flood-areas-outline'
const FLOOD_AREAS_POINTS_SOURCE_ID = 'operational-map-flood-areas-points-source'
const FLOOD_AREAS_MARKER_LAYER_ID = 'operational-map-flood-areas-marker'

/** Warna genangan per state PetaBencana (semakin dalam semakin gelap/kuat). */
const STATE_COLORS: Record<string, string> = {
  'state-1': '#facc15', // 10-30 cm — kuning
  'state-2': '#fb923c', // 30-70 cm — oranye
  'state-3': '#ef4444', // 70-150 cm — merah
  'state-4': '#c026d3', // >150 cm — magenta
}

const polygonFilter: FilterSpecification = ['==', ['geometry-type'], 'Polygon']

/** Titik representatif (centroid ring pertama) utk marker di semua zoom. */
function centroidPoints(collection: OperationalMapFeatureCollection): OperationalMapFeatureCollection {
  const features = collection.features.flatMap((feature) => {
    if (feature.geometry.type !== 'Polygon') return []
    const ring = feature.geometry.coordinates[0] as [number, number][]
    if (!ring || ring.length === 0) return []
    const sum = ring.reduce<[number, number]>(([lng, lat], [dLng, dLat]) => [lng + dLng, lat + dLat], [0, 0])
    return [{
      ...feature,
      id: `${feature.id}-point`,
      geometry: { type: 'Point' as const, coordinates: [sum[0] / ring.length, sum[1] / ring.length] },
    }]
  })
  return { ...collection, features }
}

export const floodAreasLayer = {
  sourceId: FLOOD_AREAS_SOURCE_ID,
  layerIds: [FLOOD_AREAS_FILL_LAYER_ID, FLOOD_AREAS_OUTLINE_LAYER_ID] as const,
  apply(map: MapLibreMap, collection: OperationalMapFeatureCollection): void {
    const existing = map.getSource(FLOOD_AREAS_SOURCE_ID) as { setData?: (data: unknown) => void } | undefined
    const existingPoints = map.getSource(FLOOD_AREAS_POINTS_SOURCE_ID) as { setData?: (data: unknown) => void } | undefined
    if (existing && existingPoints) {
      existing.setData?.(collection)
      existingPoints.setData?.(centroidPoints(collection))
      return
    }
    map.addSource(FLOOD_AREAS_SOURCE_ID, { type: 'geojson', data: collection })
    map.addSource(FLOOD_AREAS_POINTS_SOURCE_ID, { type: 'geojson', data: centroidPoints(collection) })
    map.addLayer({
      id: FLOOD_AREAS_MARKER_LAYER_ID,
      type: 'circle',
      source: FLOOD_AREAS_POINTS_SOURCE_ID,
      paint: {
        'circle-color': [
          'match',
          ['get', 'location_type'],
          ...Object.entries(STATE_COLORS).flatMap(([state, color]) => [state, color]),
          '#3b82f6',
        ] as unknown as string,
        'circle-radius': 7,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    })
    map.addLayer({
      id: FLOOD_AREAS_FILL_LAYER_ID,
      type: 'fill',
      source: FLOOD_AREAS_SOURCE_ID,
      filter: polygonFilter,
      paint: {
        'fill-color': [
          'match',
          ['get', 'location_type'],
          ...Object.entries(STATE_COLORS).flatMap(([state, color]) => [state, color]),
          '#3b82f6',
        ] as unknown as string,
        'fill-opacity': 0.55,
        'fill-outline-color': 'rgba(15, 23, 42, 0.65)',
      },
    })
    map.addLayer({
      id: FLOOD_AREAS_OUTLINE_LAYER_ID,
      type: 'line',
      source: FLOOD_AREAS_SOURCE_ID,
      filter: polygonFilter,
      paint: {
        'line-color': '#0f172a',
        'line-width': 1,
        'line-opacity': 0.8,
      },
    })
  },
  setVisible(map: MapLibreMap, visible: boolean): void {
    for (const id of [FLOOD_AREAS_FILL_LAYER_ID, FLOOD_AREAS_OUTLINE_LAYER_ID, FLOOD_AREAS_MARKER_LAYER_ID]) {
      if (typeof map.getLayer === 'function' && map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
      }
    }
  },
  remove(map: MapLibreMap): void {
    for (const id of [FLOOD_AREAS_OUTLINE_LAYER_ID, FLOOD_AREAS_FILL_LAYER_ID, FLOOD_AREAS_MARKER_LAYER_ID]) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
    if (map.getSource(FLOOD_AREAS_SOURCE_ID)) map.removeSource(FLOOD_AREAS_SOURCE_ID)
    if (map.getSource(FLOOD_AREAS_POINTS_SOURCE_ID)) map.removeSource(FLOOD_AREAS_POINTS_SOURCE_ID)
  },
} as const
