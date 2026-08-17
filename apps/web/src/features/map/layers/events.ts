import type { ExpressionSpecification, GeoJSONSource, Map } from 'maplibre-gl'
import { severityRank } from '../../../components/severityTones'
import type { OperationalMapFeature, OperationalMapFeatureCollection } from '../types'

const CLUSTERS_LAYER_ID = 'operational-map-events-clusters'
const CLUSTER_COUNT_LAYER_ID = 'operational-map-events-cluster-count'
const POINTS_LAYER_ID = 'operational-map-events-points'

// Warna severity: 4 = Kritis (merah berkedip), 3 = Tinggi (oranye berkedip),
// 2 = Sedang (amber), sisanya kembali ke warna per jenis bencana.
const SEVERITY_POINT_COLOR: ExpressionSpecification = [
  'match',
  ['get', 'severity_rank'],
  4,
  '#f43f5e',
  3,
  '#f97316',
  2,
  '#fbbf24',
  [
    'match',
    ['get', 'peril_type'],
    'earthquake',
    '#a84632',
    'flood',
    '#1670a4',
    'volcano',
    '#7d3f0a',
    'wildfire',
    '#c35322',
    '#5f6970',
  ],
]

const CLUSTER_SEVERITY_COLOR: ExpressionSpecification = [
  'match',
  ['get', 'severity_rank'],
  4,
  '#f43f5e',
  3,
  '#f97316',
  2,
  '#fbbf24',
  1,
  '#34d399',
  '#186f65',
]

/** Layer halo yang opasitasnya dimodifikasi loop animasi di OperationalMap. */
export const EVENTS_PULSE_LAYERS = {
  critical: 'operational-map-events-pulse-critical',
  high: 'operational-map-events-pulse-high',
  cluster: 'operational-map-events-clusters-pulse',
} as const

/** Tambahkan severity_rank numerik agar bisa difilter/diagregasi klaster. */
function withSeverityRank(collection: OperationalMapFeatureCollection): OperationalMapFeatureCollection {
  const enrich = (feature: OperationalMapFeature): OperationalMapFeature => ({
    ...feature,
    properties: {
      ...feature.properties,
      severity_rank: severityRank(feature.properties.severity),
    },
  })
  return { ...collection, features: collection.features.map(enrich) }
}

export const eventsLayer = {
  sourceId: 'operational-map-events-source',
  layerIds: [
    EVENTS_PULSE_LAYERS.cluster,
    CLUSTERS_LAYER_ID,
    CLUSTER_COUNT_LAYER_ID,
    EVENTS_PULSE_LAYERS.high,
    EVENTS_PULSE_LAYERS.critical,
    POINTS_LAYER_ID,
  ],
  apply(map: Map, collection: OperationalMapFeatureCollection): void {
    const data = withSeverityRank(collection)
    const existing = map.getSource(this.sourceId) as GeoJSONSource | undefined
    if (existing) {
      existing.setData(data)
      return
    }

    map.addSource(this.sourceId, {
      type: 'geojson',
      data,
      cluster: true,
      clusterMaxZoom: 12,
      clusterRadius: 48,
      // Severity maksimum di dalam klaster menentukan warna & denyut klaster.
      clusterProperties: {
        severity_rank: ['max', ['get', 'severity_rank']],
      },
    })
    // Halo berkedip untuk klaster yang mengandung event kritis.
    map.addLayer({
      id: EVENTS_PULSE_LAYERS.cluster,
      type: 'circle',
      source: this.sourceId,
      filter: ['all', ['has', 'point_count'], ['>=', ['get', 'severity_rank'], 4]],
      paint: {
        'circle-color': '#f43f5e',
        'circle-radius': ['step', ['get', 'point_count'], 22, 20, 26, 100, 30],
        'circle-blur': 1,
        'circle-opacity': 0.5,
      },
    })
    map.addLayer({
      id: CLUSTERS_LAYER_ID,
      type: 'circle',
      source: this.sourceId,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': CLUSTER_SEVERITY_COLOR,
        'circle-radius': ['step', ['get', 'point_count'], 16, 20, 20, 100, 24],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    })
    map.addLayer({
      id: CLUSTER_COUNT_LAYER_ID,
      type: 'symbol',
      source: this.sourceId,
      filter: ['has', 'point_count'],
      layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12 },
      paint: { 'text-color': '#ffffff' },
    })
    // Halo berkedip oranye untuk titik severity High/severe.
    map.addLayer({
      id: EVENTS_PULSE_LAYERS.high,
      type: 'circle',
      source: this.sourceId,
      filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'severity_rank'], 3]],
      paint: {
        'circle-color': '#f97316',
        'circle-radius': 14,
        'circle-blur': 1,
        'circle-opacity': 0.4,
      },
    })
    // Halo berkedip merah untuk titik severity Critical/extreme.
    map.addLayer({
      id: EVENTS_PULSE_LAYERS.critical,
      type: 'circle',
      source: this.sourceId,
      filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'severity_rank'], 4]],
      paint: {
        'circle-color': '#f43f5e',
        'circle-radius': 14,
        'circle-blur': 1,
        'circle-opacity': 0.55,
      },
    })
    map.addLayer({
      id: POINTS_LAYER_ID,
      type: 'circle',
      source: this.sourceId,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': SEVERITY_POINT_COLOR,
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
