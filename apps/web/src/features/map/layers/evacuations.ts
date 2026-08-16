import type { GeoJSONSource, Map } from 'maplibre-gl'
import type { OperationalMapFeatureCollection } from '../types'

const EVACUATION_ICON_ID = 'operational-map-evacuations-icon'

function evacuationIcon(): { width: number; height: number; data: Uint8Array } {
  const size = 16
  const data = new Uint8Array(size * size * 4)
  for (let y = 2; y < 14; y += 1) {
    for (let x = 2; x < 14; x += 1) {
      const offset = (y * size + x) * 4
      data[offset] = 20
      data[offset + 1] = 91
      data[offset + 2] = 132
      data[offset + 3] = 255
    }
  }
  return { width: size, height: size, data }
}

export const evacuationsLayer = {
  sourceId: 'operational-map-evacuations-source',
  layerIds: ['operational-map-evacuations-points'],
  apply(map: Map, collection: OperationalMapFeatureCollection): void {
    const existing = map.getSource(this.sourceId) as GeoJSONSource | undefined
    if (existing) {
      existing.setData(collection)
      return
    }

    if (!map.hasImage(EVACUATION_ICON_ID)) map.addImage(EVACUATION_ICON_ID, evacuationIcon())
    map.addSource(this.sourceId, { type: 'geojson', data: collection })
    map.addLayer({
      id: this.layerIds[0],
      type: 'symbol',
      source: this.sourceId,
      layout: {
        'icon-image': EVACUATION_ICON_ID,
        'icon-size': 1,
        'icon-allow-overlap': true,
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
