import type { ExpressionSpecification, GeoJSONSource, Map } from 'maplibre-gl'
import { severityRank } from '../../../components/severityTones'
import { DEFAULT_EVENT_ICON, EVENT_PERIL_ICONS, registerEventIcons } from './eventIcons'
import type { OperationalMapFeature, OperationalMapFeatureCollection } from '../types'

const CLUSTERS_LAYER_ID = 'operational-map-events-clusters'
const EVENTS_BADGE_SOURCE_ID = 'operational-map-events-badges-source'
const CLUSTER_COUNT_LAYER_ID = 'operational-map-events-cluster-count'
const POINTS_LAYER_ID = 'operational-map-events-points'
const ICONS_LAYER_ID = 'operational-map-events-icons'
const HEATMAP_LAYER_ID = 'operational-map-events-heatmap'

/** ID layer klaster (dipakai handler klik-ekspansi di OperationalMap). */
export const EVENTS_CLUSTERS_LAYER_ID = CLUSTERS_LAYER_ID

/** Toggle heatmap kepadatan. Saat aktif, klaster/halo/ikon disembunyikan dan
 *  titik dikecilkan+dirupakan (tetap visible!) supaya TETAP BISA DIKLIK &
 *  DI-HOVER — MapLibre tidak mengirim event interaksi ke layer tersembunyi. */
export function setEventsHeatmapVisible(map: Map, visible: boolean): void {
  if (typeof map.getLayer !== 'function' || !map.getLayer(HEATMAP_LAYER_ID)) return
  map.setLayoutProperty(HEATMAP_LAYER_ID, 'visibility', visible ? 'visible' : 'none')
  for (const id of [CLUSTERS_LAYER_ID, CLUSTER_COUNT_LAYER_ID, ...COMPOSITION_GROUPS.map((group) => `operational-map-events-composition-${group.kind}`), ICONS_LAYER_ID, EVENTS_PULSE_LAYERS.critical, EVENTS_PULSE_LAYERS.high, EVENTS_PULSE_LAYERS.cluster]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'none' : 'visible')
  }
  if (map.getLayer(POINTS_LAYER_ID)) {
    map.setLayoutProperty(POINTS_LAYER_ID, 'visibility', 'visible')
    // Titik tetap terlihat jelas DI ATAS heatmap: cukup besar, semi-opaque,
    // dengan ring putih tebal agar kontras — tetap bisa diklik & di-hover.
    map.setPaintProperty(POINTS_LAYER_ID, 'circle-opacity', visible ? 0.85 : 1)
    map.setPaintProperty(POINTS_LAYER_ID, 'circle-stroke-opacity', visible ? 1 : 1)
    map.setPaintProperty(POINTS_LAYER_ID, 'circle-stroke-width', visible ? 2.5 : 2)
    map.setPaintProperty(POINTS_LAYER_ID, 'circle-radius', visible ? 6 : 7)
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

/**
 * P12 — Badge komposisi klaster: deretan titik berwarna per jenis bencana di
 * bawah lingkaran klaster. Pendekatan offset layer (icon-offset / circle-
 * translate) ternyata TIDAK dirender MapLibre untuk offset besar pada
 * klaster (diverifikasi eksperimen pixel-level); badge kini dibangun dari
 * klaster aktual (queryRenderedFeatures + getClusterLeaves) menjadi titik
 * geojson tersendiri yang posisinya digeser 20px via project/unproject —
 * layer circle tanpa translate selalu dirender.
 */
const COMPOSITION_SLOT_SPACING = 12
const COMPOSITION_OFFSET_PX = 20

interface CompositionGroup {
  /** Jenis bencana (kunci properties peril_type). */
  kind: string
  /** Warna dot — konsisten dengan warna per-jenis titik event. */
  color: string
  /** Urutan slot tetap agar deretan konsisten antar klaster. */
  slot: number
}

/** Pengelompokan sama dengan legenda (tsunami→banjir, storm→angin). */
const COMPOSITION_GROUPS: readonly CompositionGroup[] = [
  { kind: 'earthquake', color: '#a84632', slot: 0 },
  { kind: 'wildfire', color: '#c35322', slot: 1 },
  { kind: 'flood', color: '#1670a4', slot: 2 },
  { kind: 'volcano', color: '#7d3f0a', slot: 3 },
  { kind: 'wind', color: '#3b5f8a', slot: 4 },
]

function compositionKinds(perils: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const peril of perils) {
    const kind = peril === 'tsunami' ? 'flood' : peril === 'storm' ? 'wind' : peril
    if (COMPOSITION_GROUPS.some((group) => group.kind === kind)) counts[kind] = (counts[kind] ?? 0) + 1
  }
  return counts
}

/**
 * Bangun ulang titik badge dari klaster yang sedang dirender. Dipanggil pada
 * moveend dan setelah data events berubah (sourcedata). No-op bila layer
 * belum terpasang.
 */
const badgeRebuildScheduled = new WeakMap<Map, boolean>()

/** Jadwalkan rebuild badge pada 'idle' (render selesai) — aman dipanggil sering. */
function scheduleClusterBadgeRebuild(map: Map): void {
  if (badgeRebuildScheduled.get(map)) return
  badgeRebuildScheduled.set(map, true)
  const run = () => {
    if (!badgeRebuildScheduled.get(map)) return
    badgeRebuildScheduled.set(map, false)
    rebuildClusterBadges(map)
  }
  // 'idle' = render selesai; fallback timer menjamin rebuild tetap jalan di
  // lingkungan yang tidak pernah mencapai idle (mis. renderer software e2e).
  map.once('idle', run)
  window.setTimeout(run, 500)
}

export function rebuildClusterBadges(map: Map): void {
  const source = map.getSource(EVENTS_BADGE_SOURCE_ID) as (GeoJSONSource & { setData: (data: GeoJSON.FeatureCollection) => void }) | undefined
  if (!source || typeof map.queryRenderedFeatures !== 'function') return
  let clusters: Array<GeoJSON.Feature> = []
  try {
    clusters = map.queryRenderedFeatures({ layers: [CLUSTERS_LAYER_ID] }) as unknown as Array<GeoJSON.Feature>
  } catch {
    return
  }
  const events = map.getSource(eventsLayer.sourceId) as unknown as { getClusterLeaves?: (id: number, limit: number) => Promise<Array<GeoJSON.Feature>> } | undefined
  if (!events?.getClusterLeaves) return

  const centerSlot = (COMPOSITION_GROUPS.length - 1) / 2
  void Promise.all(clusters.map(async (cluster) => {
    const id = (cluster.properties as { cluster_id?: number } | null)?.cluster_id
    if (typeof id !== 'number' || !cluster.geometry || cluster.geometry.type !== 'Point') return []
    const leaves = await events.getClusterLeaves!(id, Infinity).catch(() => [])
    const counts = compositionKinds(leaves.map((leaf) => String((leaf.properties as { peril_type?: string } | null)?.peril_type ?? '')))
    const active = COMPOSITION_GROUPS.filter((group) => (counts[group.kind] ?? 0) > 0)
    if (active.length === 0) return []
    const [lon, lat] = cluster.geometry.coordinates as [number, number]
    const anchor = map.project([lon, lat])
    return active.map((group) => {
      const point = map.unproject([anchor.x + (group.slot - centerSlot) * COMPOSITION_SLOT_SPACING, anchor.y + COMPOSITION_OFFSET_PX])
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [point.lng, point.lat] },
        properties: { kind: group.kind, count: counts[group.kind] },
      }
    })
  })).then((groups) => {
    source.setData({ type: 'FeatureCollection', features: groups.flat() })
  })
}



export const eventsLayer = {
  sourceId: 'operational-map-events-source',
  layerIds: [
    HEATMAP_LAYER_ID,
    EVENTS_PULSE_LAYERS.cluster,
    CLUSTERS_LAYER_ID,
    CLUSTER_COUNT_LAYER_ID,
    ...COMPOSITION_GROUPS.map((group) => `operational-map-events-composition-${group.kind}`),
    EVENTS_PULSE_LAYERS.high,
    EVENTS_PULSE_LAYERS.critical,
    POINTS_LAYER_ID,
    ICONS_LAYER_ID,
  ],
  apply(map: Map, collection: OperationalMapFeatureCollection): void {
    const data = withSeverityRank(collection)
    const existing = map.getSource(this.sourceId) as GeoJSONSource | undefined
    if (existing) {
      existing.setData(data)
      scheduleClusterBadgeRebuild(map)
      return
    }

    // Ikon per jenis bencana (emoji -> image MapLibre) sebelum layer symbol.
    registerEventIcons(map)

    map.addSource(this.sourceId, {
      type: 'geojson',
      data,
      cluster: true,
      clusterMaxZoom: 12,
      clusterRadius: 48,
      // Severity maksimum di dalam klaster menentukan warna & denyut klaster;
      // jumlah per jenis bencana menentukan badge komposisi (P12).
      clusterProperties: {
        severity_rank: ['max', ['get', 'severity_rank']],
        n_earthquake: ['+', ['case', ['==', ['get', 'peril_type'], 'earthquake'], 1, 0]],
        n_wildfire: ['+', ['case', ['==', ['get', 'peril_type'], 'wildfire'], 1, 0]],
        n_flood: ['+', ['case', ['match', ['get', 'peril_type'], ['flood', 'tsunami'], true, false], 1, 0]],
        n_volcano: ['+', ['case', ['==', ['get', 'peril_type'], 'volcano'], 1, 0]],
        n_wind: ['+', ['case', ['match', ['get', 'peril_type'], ['wind', 'storm'], true, false], 1, 0]],
      },
    })
    // Heatmap kepadatan kejadian (default tersembunyi; toggle dari legenda).
    // PENTING: source events ber-CLUSTER — pada zoom rendah hampir semua titik
    // tergabung jadi klaster, maka heatmap TIDAK boleh mengecualikan klaster.
    // Bobot = point_count (jumlah event) × faktor severity maksimum klaster,
    // sehingga kepadatan akurat pada semua level zoom.
    map.addLayer({
      id: HEATMAP_LAYER_ID,
      type: 'heatmap',
      source: this.sourceId,
      layout: { visibility: 'none' },
      paint: {
        'heatmap-weight': [
          '*',
          ['coalesce', ['get', 'point_count'], 1],
          ['interpolate', ['linear'], ['get', 'severity_rank'],
            0, 0.6, 2, 0.8, 3, 1, 4, 1.3],
        ],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 8, 2.5],
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(30,64,175,0)',
          0.15, 'rgba(37,99,235,0.4)',
          0.35, 'rgba(5,150,105,0.55)',
          0.6, 'rgba(217,119,6,0.7)',
          0.8, 'rgba(234,88,12,0.82)',
          1, 'rgba(220,38,38,0.92)',
        ],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 16, 6, 26, 10, 40],
        'heatmap-opacity': 0.85,
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
      // Font wajib eksplisit: default MapLibre ("Open Sans Regular,Arial
      // Unicode MS Regular") tidak tersedia di server glyph OpenFreeMap
      // (hanya Noto Sans, tanpa dukungan stack koma) -> 404 dan angka klaster
      // tidak pernah tampil.
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-font': ['Noto Sans Bold'],
        'text-size': 12,
      },
      paint: { 'text-color': '#ffffff' },
    })
    // P12 — badge komposisi: titik badge geojson tersendiri (posisi sudah
    // digeser saat build) + satu layer circle per jenis tanpa translate.
    map.addSource(EVENTS_BADGE_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    for (const group of COMPOSITION_GROUPS) {
      map.addLayer({
        id: `operational-map-events-composition-${group.kind}`,
        type: 'circle',
        source: EVENTS_BADGE_SOURCE_ID,
        filter: ['==', ['get', 'kind'], group.kind],
        paint: {
          'circle-color': group.color,
          'circle-radius': 4.5,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
        },
      })
    }
    scheduleClusterBadgeRebuild(map)
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
    // Titik = chip putih dengan RING severity — jenis bencana ditunjukkan
    // ikon emoji di layer symbol di atasnya (lihat ICONS_LAYER_ID).
    map.addLayer({
      id: POINTS_LAYER_ID,
      type: 'circle',
      source: this.sourceId,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': 'rgba(255,255,255,0.92)',
        'circle-radius': 9,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': SEVERITY_POINT_COLOR,
      },
    })
    // Ikon per jenis bencana (gempa/karhutla/banjir/vulkanik...) — membedakan
    // event sekilas pandang; ukuran ikon mengikuti severity.
    map.addLayer({
      id: ICONS_LAYER_ID,
      type: 'symbol',
      source: this.sourceId,
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': [
          'match',
          ['get', 'peril_type'],
          ...Object.entries(EVENT_PERIL_ICONS).flatMap(([peril, icon]) => [peril, icon.imageId]),
          DEFAULT_EVENT_ICON.imageId,
        ] as unknown as ExpressionSpecification,
        'icon-size': [
          'match',
          ['get', 'severity_rank'],
          4, 1.05,
          3, 0.9,
          0.78,
        ] as unknown as ExpressionSpecification,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    })
  },
  remove(map: Map): void {
    if (map.getSource(EVENTS_BADGE_SOURCE_ID)) {
      for (const group of COMPOSITION_GROUPS) {
        if (map.getLayer(`operational-map-events-composition-${group.kind}`)) map.removeLayer(`operational-map-events-composition-${group.kind}`)
      }
      map.removeSource(EVENTS_BADGE_SOURCE_ID)
    }
    for (const id of [...this.layerIds].reverse()) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
    if (map.getSource(this.sourceId)) map.removeSource(this.sourceId)
  },
} as const
