import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, Map } from 'maplibre-gl'
import type { OperationalMapFeatureCollection } from '../types'

const severityColor: ExpressionSpecification = ['match', ['get', 'severity'], 'extreme', '#8e1d1d', 'severe', '#b34725', 'high', '#b34725', 'moderate', '#b27b1a', '#5f6970']

export const officialAlertsLayer = {
  sourceId: 'operational-map-official-alerts-source',
  layerIds: [
    'operational-map-official-alerts-fill',
    'operational-map-official-alerts-outline',
    'operational-map-official-alerts-points',
  ],
  apply(map: Map, collection: OperationalMapFeatureCollection): void {
    const existing = map.getSource(this.sourceId) as GeoJSONSource | undefined
    if (existing) {
      existing.setData(collection)
      return
    }

    map.addSource(this.sourceId, { type: 'geojson', data: collection })
    const polygonFilter: FilterSpecification = ['==', '$type', 'Polygon']
    map.addLayer({
      id: this.layerIds[0],
      type: 'fill',
      source: this.sourceId,
      filter: polygonFilter,
      paint: { 'fill-color': severityColor, 'fill-opacity': 0.22 },
    })
    map.addLayer({
      id: this.layerIds[1],
      type: 'line',
      source: this.sourceId,
      filter: polygonFilter,
      paint: { 'line-color': severityColor, 'line-width': 2 },
    })
    map.addLayer({
      id: this.layerIds[2],
      type: 'circle',
      source: this.sourceId,
      filter: ['==', '$type', 'Point'],
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
