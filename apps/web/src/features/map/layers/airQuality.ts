import type { GeoJSONSource, Map } from 'maplibre-gl'
import type { OperationalMapFeatureCollection } from '../types'

export const airQualityLayer = {
  sourceId: 'operational-map-air-quality-source',
  layerIds: ['operational-map-air-quality-points'],
  apply(map: Map, collection: OperationalMapFeatureCollection): void {
    const existing = map.getSource(this.sourceId) as GeoJSONSource | undefined
    if (existing) {
      existing.setData(collection)
      return
    }

    map.addSource(this.sourceId, { type: 'geojson', data: collection })
    map.addLayer({
      id: this.layerIds[0],
      type: 'circle',
      source: this.sourceId,
      paint: {
        'circle-color': ['match', ['get', 'category'], 'Baik', '#18794e', 'Sedang', '#b27b1a', 'Tidak Sehat', '#b34725', 'Sangat Tidak Sehat', '#9b2c2c', '#5f6970'],
        'circle-radius': 7,
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
