import type { GeoJSONSource, Map } from 'maplibre-gl'
import type { OperationalMapFeatureCollection, PrivateOperationalMapLayer } from '../types'

export interface PrivateLayerAdapter {
  sourceId: string
  layerIds: readonly string[]
  apply: (map: Map, data: OperationalMapFeatureCollection) => void
  remove: (map: Map) => void
}

function removeArtifacts(map: Map, layerIds: readonly string[], sourceId: string): void {
  for (const layerId of [...layerIds].reverse()) {
    if (map.getLayer(layerId)) map.removeLayer(layerId)
  }
  if (map.getSource(sourceId)) map.removeSource(sourceId)
}

function watchZonesAdapter(): PrivateLayerAdapter {
  const sourceId = 'operational-map-private-watch-zones-source'
  const layerIds = [
    'operational-map-private-watch-zones-fill',
    'operational-map-private-watch-zones-outline',
    'operational-map-private-watch-zones-points',
  ] as const
  return {
    sourceId,
    layerIds,
    apply(map, data) {
      const source = map.getSource(sourceId) as GeoJSONSource | undefined
      if (source) source.setData(data)
      else map.addSource(sourceId, { type: 'geojson', data })

      if (!map.getLayer(layerIds[0])) map.addLayer({
        id: layerIds[0], type: 'fill', source: sourceId,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#8b5cf6', 'fill-opacity': 0.08 },
      })
      if (!map.getLayer(layerIds[1])) map.addLayer({
        id: layerIds[1], type: 'line', source: sourceId,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'line-color': '#a78bfa', 'line-width': 2, 'line-dasharray': [3, 2], 'line-opacity': 0.72 },
      })
      if (!map.getLayer(layerIds[2])) map.addLayer({
        id: layerIds[2], type: 'circle', source: sourceId,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 8, 'circle-color': '#6d28d9', 'circle-opacity': 0.35,
          'circle-stroke-color': '#c4b5fd', 'circle-stroke-width': 2,
        },
      })
    },
    remove(map) { removeArtifacts(map, layerIds, sourceId) },
  }
}

function personalAssetsAdapter(): PrivateLayerAdapter {
  const sourceId = 'operational-map-private-personal-assets-source'
  const layerIds = ['operational-map-private-personal-assets-points'] as const
  return {
    sourceId,
    layerIds,
    apply(map, data) {
      const source = map.getSource(sourceId) as GeoJSONSource | undefined
      if (source) source.setData(data)
      else map.addSource(sourceId, { type: 'geojson', data })
      if (!map.getLayer(layerIds[0])) map.addLayer({
        id: layerIds[0], type: 'circle', source: sourceId,
        paint: {
          'circle-radius': 6, 'circle-color': '#0f766e', 'circle-opacity': 0.55,
          'circle-stroke-color': '#99f6e4', 'circle-stroke-width': 1.5,
        },
      })
    },
    remove(map) { removeArtifacts(map, layerIds, sourceId) },
  }
}

export const privateLayerAdapters: Record<PrivateOperationalMapLayer, PrivateLayerAdapter> = {
  'watch-zones': watchZonesAdapter(),
  'personal-assets': personalAssetsAdapter(),
}

const localSourceId = 'operational-map-private-local-source'
const localLayerIds = [
  'operational-map-private-local-fill',
  'operational-map-private-local-line',
  'operational-map-private-local-points',
] as const

export const localPrivateOverlayAdapter = {
  sourceId: localSourceId,
  layerIds: localLayerIds,
  apply(map: Map, data: GeoJSON.FeatureCollection) {
    const source = map.getSource(localSourceId) as GeoJSONSource | undefined
    if (source) source.setData(data)
    else map.addSource(localSourceId, { type: 'geojson', data })
    if (!map.getLayer(localLayerIds[0])) map.addLayer({
      id: localLayerIds[0], type: 'fill', source: localSourceId,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#8b5cf6', 'fill-opacity': 0.1 },
    })
    if (!map.getLayer(localLayerIds[1])) map.addLayer({
      id: localLayerIds[1], type: 'line', source: localSourceId,
      filter: ['in', ['geometry-type'], ['literal', ['LineString', 'Polygon']]],
      paint: { 'line-color': '#6366f1', 'line-width': 3, 'line-dasharray': [3, 2] },
    })
    if (!map.getLayer(localLayerIds[2])) map.addLayer({
      id: localLayerIds[2], type: 'circle', source: localSourceId,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 7, 'circle-color': '#6366f1',
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2,
      },
    })
  },
  remove(map: Map) { removeArtifacts(map, localLayerIds, localSourceId) },
}
