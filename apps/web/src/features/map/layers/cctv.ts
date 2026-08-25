import type { Map, CircleLayerSpecification, SymbolLayerSpecification, GeoJSONSourceSpecification } from 'maplibre-gl'
import type { OperationalMapFeatureCollection } from '../types'

/**
 * S12b — Layer CCTV jalan tol (BPJT Kementerian PUPR / BUJT).
 *
 * Marker lingkaran per operator (Jasa Marga indigo, Hutama Karya emerald,
 * lainnya slate) + klaster otomatis MapLibre saat zoom rendah — ribuan
 * kamera tetap ringan di peta.
 */

const CCTV_SOURCE_ID = 'operational-map-cctv-source'
const CCTV_CLUSTER_LAYER_ID = 'operational-map-cctv-clusters'
const CCTV_CLUSTER_COUNT_LAYER_ID = 'operational-map-cctv-cluster-count'
const CCTV_MARKER_LAYER_ID = 'operational-map-cctv-markers'

/** Warna marker per operator utama. */
const OPERATOR_COLORS: Record<string, string> = {
  jm: '#6366f1', // Jasa Marga — indigo
  hk: '#10b981', // Hutama Karya — emerald
  lms: '#06b6d4', // Astra/Lintas Marga — cyan
  wtr: '#f59e0b', // Waskita — amber
  wbw: '#f59e0b',
}

function operatorColor(code: string | undefined): string {
  return OPERATOR_COLORS[code ?? ''] ?? '#94a3b8'
}

export const cctvLayer = {
  sourceId: CCTV_SOURCE_ID,
  layerIds: [CCTV_CLUSTER_LAYER_ID, CCTV_CLUSTER_COUNT_LAYER_ID, CCTV_MARKER_LAYER_ID] as const,

  apply(map: Map, collection: OperationalMapFeatureCollection): void {
    const existing = map.getSource(CCTV_SOURCE_ID)
    const source: GeoJSONSourceSpecification = {
      type: 'geojson',
      data: collection,
      cluster: true,
      clusterMaxZoom: 11,
      clusterRadius: 46,
    }
    if (!existing) {
      map.addSource(CCTV_SOURCE_ID, source)
    } else {
      const mutable = existing as unknown as { setData?: (d: unknown) => void }
      if (typeof mutable.setData === 'function') {
        mutable.setData(collection)
        return
      }
      map.removeSource(CCTV_SOURCE_ID)
      map.addSource(CCTV_SOURCE_ID, source)
    }

    // Klaster — lingkaran slate berisi jumlah.
    if (!map.getLayer(CCTV_CLUSTER_LAYER_ID)) {
      map.addLayer({
        id: CCTV_CLUSTER_LAYER_ID,
        type: 'circle',
        source: CCTV_SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#334155',
          'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 22],
          'circle-stroke-color': '#64748b',
          'circle-stroke-width': 1.5,
        },
      } as CircleLayerSpecification)
    }
    if (!map.getLayer(CCTV_CLUSTER_COUNT_LAYER_ID)) {
      map.addLayer({
        id: CCTV_CLUSTER_COUNT_LAYER_ID,
        type: 'symbol',
        source: CCTV_SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['Noto Sans Bold'],
          'text-size': 11,
        },
        paint: { 'text-color': '#e2e8f0' },
      } as SymbolLayerSpecification)
    }

    // Marker per kamera — warna per operator.
    if (!map.getLayer(CCTV_MARKER_LAYER_ID)) {
      map.addLayer({
        id: CCTV_MARKER_LAYER_ID,
        type: 'circle',
        source: CCTV_SOURCE_ID,
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['geometry-type'], 'Point']],
        paint: {
          'circle-color': [
            'match', ['get', 'operator_code'],
            'jm', '#6366f1', 'hk', '#10b981', 'lms', '#06b6d4',
            'wtr', '#f59e0b', 'wbw', '#f59e0b',
            '#94a3b8',
          ],
          'circle-radius': 5,
          'circle-stroke-color': '#f8fafc',
          'circle-stroke-width': 1,
          'circle-opacity': 0.9,
        },
      } as CircleLayerSpecification)
    }
  },

  setVisible(map: Map, visible: boolean): void {
    for (const layerId of this.layerIds) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none')
      }
    }
  },

  remove(map: Map): void {
    for (const layerId of this.layerIds) {
      if (map.getLayer(layerId)) map.removeLayer(layerId)
    }
    if (map.getSource(CCTV_SOURCE_ID)) map.removeSource(CCTV_SOURCE_ID)
  },
}

export { operatorColor }
