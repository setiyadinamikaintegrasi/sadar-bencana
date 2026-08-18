import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, Map } from 'maplibre-gl'
import type { OperationalMapFeatureCollection } from '../types'

// Palet severity selaras dengan tone global (severityTones.ts):
// extreme = merah berkedip, severe = oranye, high = oranye muda, moderate = amber.
const severityColor: ExpressionSpecification = [
  'match',
  ['get', 'severity'],
  'extreme',
  '#f43f5e',
  'severe',
  '#f97316',
  'high',
  '#fb923c',
  'moderate',
  '#fbbf24',
  '#5f6970',
]

/** Layer yang opasitasnya dimodifikasi loop animasi di OperationalMap. */
export const OFFICIAL_ALERTS_PULSE_LAYERS = {
  outline: 'operational-map-official-alerts-outline-extreme',
  point: 'operational-map-official-alerts-points-pulse',
} as const

export const officialAlertsLayer = {
  sourceId: 'operational-map-official-alerts-source',
  layerIds: [
    'operational-map-official-alerts-fill',
    'operational-map-official-alerts-outline',
    OFFICIAL_ALERTS_PULSE_LAYERS.outline,
    OFFICIAL_ALERTS_PULSE_LAYERS.point,
    'operational-map-official-alerts-points',
  ],
  apply(map: Map, collection: OperationalMapFeatureCollection): void {
    const existing = map.getSource(this.sourceId) as GeoJSONSource | undefined
    if (existing) {
      existing.setData(collection)
      return
    }

    map.addSource(this.sourceId, { type: 'geojson', data: collection })
    // Filter full-expression: MapLibre v5 menolak campuran operator legacy
    // ($type) dengan expression (['get', ...]) dalam satu ['all', ...]
    // ("filter[2][1]: string expected"). Gunakan ['geometry-type'].
    const polygonFilter: FilterSpecification = ['==', ['geometry-type'], 'Polygon']
    const pointFilter: FilterSpecification = ['==', ['geometry-type'], 'Point']
    const extremePolygonFilter: FilterSpecification = ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'severity'], 'extreme']]
    const extremePointFilter: FilterSpecification = ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'severity'], 'extreme']]
    map.addLayer({
      id: this.layerIds[0],
      type: 'fill',
      source: this.sourceId,
      filter: polygonFilter,
      paint: {
        'fill-color': severityColor,
        'fill-opacity': ['match', ['get', 'severity'], 'extreme', 0.3, 'severe', 0.26, 0.22],
      },
    })
    map.addLayer({
      id: this.layerIds[1],
      type: 'line',
      source: this.sourceId,
      filter: polygonFilter,
      paint: {
        'line-color': severityColor,
        'line-width': ['match', ['get', 'severity'], 'extreme', 3, 'severe', 2.5, 2],
      },
    })
    // Garis batas berkedip merah untuk peringatan resmi berefek ekstrem.
    map.addLayer({
      id: OFFICIAL_ALERTS_PULSE_LAYERS.outline,
      type: 'line',
      source: this.sourceId,
      filter: extremePolygonFilter,
      paint: {
        'line-color': '#f43f5e',
        'line-width': 3.5,
        'line-opacity': 0.9,
      },
    })
    // Halo berkedip untuk titik peringatan ekstrem.
    map.addLayer({
      id: OFFICIAL_ALERTS_PULSE_LAYERS.point,
      type: 'circle',
      source: this.sourceId,
      filter: extremePointFilter,
      paint: {
        'circle-color': '#f43f5e',
        'circle-radius': 15,
        'circle-blur': 1,
        'circle-opacity': 0.55,
      },
    })
    map.addLayer({
      id: this.layerIds[4],
      type: 'circle',
      source: this.sourceId,
      filter: pointFilter,
      paint: {
        'circle-color': severityColor,
        'circle-radius': 8,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    })
  },
  remove(map: Map): void {
    for (const id of [...this.layerIds].reverse()) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
    if (map.getSource(this.sourceId)) map.removeSource(this.sourceId)
  },
} as const
