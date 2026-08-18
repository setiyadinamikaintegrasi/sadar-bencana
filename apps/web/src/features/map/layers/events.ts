import type { ExpressionSpecification, GeoJSONSource, Map } from 'maplibre-gl'
import { severityRank } from '../../../components/severityTones'
import type { OperationalMapFeature, OperationalMapFeatureCollection } from '../types'

const CLUSTERS_LAYER_ID = 'operational-map-events-clusters'
const CLUSTER_COUNT_LAYER_ID = 'operational-map-events-cluster-count'
const POINTS_LAYER_ID = 'operational-map-events-points'
const HEATMAP_LAYER_ID = 'operational-map-events-heatmap'

/** Toggle heatmap kepadatan: saat aktif, titik/klaster/halo disembunyikan
 *  agar tidak dobel visual; heatmap berbagi source dengan titik event. */
export function setEventsHeatmapVisible(map: Map, visible: boolean): void {
  if (typeof map.getLayer !== 'function' || !map.getLayer(HEATMAP_LAYER_ID)) return
  map.setLayoutProperty(HEATMAP_LAYER_ID, 'visibility', visible ? 'visible' : 'none')
  for (const id of [CLUSTERS_LAYER_ID, CLUSTER_COUNT_LAYER_ID, POINTS_LAYER_ID, EVENTS_PULSE_LAYERS.critical, EVENTS_PULSE_LAYERS.high, EVENTS_PULSE_LAYERS.cluster]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'none' : 'visible')
  }
}

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
    HEATMAP_LAYER_ID,
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
    // Heatmap kepadatan kejadian (default tersembunyi; toggle dari legenda).
    // Intensitas diberat severity agar hotspot kritis menonjol.
    map.addLayer({
      id: HEATMAP_LAYER_ID,
      type: 'heatmap',
      source: this.sourceId,
      layout: { visibility: 'none' },
      paint: {
        'heatmap-weight': [
          'interpolate', ['linear'], ['get', 'severity_rank'],
          0, 0.3, 2, 0.6, 3, 0.85, 4, 1,
        ],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 8, 2.5],
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(15,23,42,0)',
          0.2, 'rgba(56,189,248,0.35)',
          0.4, 'rgba(52,211,153,0.5)',
          0.6, 'rgba(251,191,36,0.65)',
          0.8, 'rgba(249,115,22,0.8)',
          1, 'rgba(244,63,94,0.9)',
        ],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 12, 6, 22, 10, 34],
        'heatmap-opacity': 0.85,
      },
      filter: ['!', ['has', 'point_count']],
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
