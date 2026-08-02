import type { GeoJSONSource, Map } from 'maplibre-gl'
import type { OperationalMapFeatureCollection } from '../types'

export const eventsLayer = {
  sourceId: 'operational-map-events-source',
  layerIds: [
    'operational-map-events-clusters',
    'operational-map-events-cluster-count',
    'operational-map-events-points',
  ],
  apply(map: Map, collection: OperationalMapFeatureCollection): void {
    const existing = map.getSource(this.sourceId) as GeoJSONSource | undefined
    if (existing) {
      existing.setData(collection)
      return
    }

    map.addSource(this.sourceId, {
      type: 'geojson',
      data: collection,
      cluster: true,
      clusterMaxZoom: 12,
      clusterRadius: 48,
    })
    map.addLayer({
      id: this.layerIds[0],
      type: 'circle',
      source: this.sourceId,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#186f65',
        'circle-radius': ['step', ['get', 'point_count'], 16, 20, 20, 100, 24],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    })
    map.addLayer({
      id: this.layerIds[1],
      type: 'symbol',
      source: this.sourceId,
      filter: ['has', 'point_count'],
      layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12 },
      paint: { 'text-color': '#ffffff' },
    })
    map.addLayer({
      id: this.layerIds[2],
      type: 'circle',
      source: this.sourceId,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['match', ['get', 'peril_type'], 'earthquake', '#a84632', 'flood', '#1670a4', 'volcano', '#7d3f0a', 'wildfire', '#c35322', '#5f6970'],
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
