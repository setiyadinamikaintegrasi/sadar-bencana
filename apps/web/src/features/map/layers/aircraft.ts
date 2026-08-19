import type { ExpressionSpecification, GeoJSONSource, Map } from 'maplibre-gl'
import type { OperationalMapFeature, OperationalMapFeatureCollection } from '../types'

/**
 * Layer lalu lintas udara — posisi pesawat live (OpenSky via worker).
 *
 * - Marker = segitiga ter-rotasi sesuai heading (`icon-rotate` dari properti
 *   `heading_deg` yang dikirim API).
 * - Warna marker mengikuti ketinggian (rendah terang, tinggi pucat-biru).
 * - Animasi dead-reckoning: `advanceAircraftPositions` digerakkan interval
 *   dari OperationalMap — menginterpolasi posisi dari velocity/heading sehingga
 *   pesawat bergerak mulus di antara snap berkala ke data worker (±60 detik).
 */

export const AIRCRAFT_SOURCE_ID = 'operational-map-aircraft-source'
export const AIRCRAFT_LAYER_ID = 'operational-map-aircraft-layer'

/** Kecepatan maju (meter) per properti velocity(m/s) × dt(detik), diterapkan
 *  pada GeoJSON sebelum setData — dipanggil interval dari OperationalMap. */
export function advanceAircraftPositions(
  collection: OperationalMapFeatureCollection,
  elapsedSeconds: number,
): OperationalMapFeatureCollection {
  if (elapsedSeconds <= 0) return collection
  const moved = collection.features.map((feature) => {
    const props = feature.properties as typeof feature.properties & { velocity_ms?: number; heading_deg?: number }
    const velocity = props.velocity_ms
    const heading = props.heading_deg
    if (!velocity || heading == null || feature.geometry.type !== 'Point') return feature
    const [lon, lat] = feature.geometry.coordinates as [number, number]
    const distance = velocity * elapsedSeconds // meter
    const rad = (heading * Math.PI) / 180
    // Perkiraan gerak equirectangular lokal — cukup untuk animasi visual.
    const dLat = (distance * Math.cos(rad)) / 111_320
    const dLon = (distance * Math.sin(rad)) / (111_320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)))
    return {
      ...feature,
      geometry: { type: 'Point' as const, coordinates: [lon + dLon, lat + dLat] },
    }
  })
  return { ...collection, features: moved }
}

const AIRCRAFT_COLOR: ExpressionSpecification = [
  'interpolate', ['linear'], ['get', 'altitude_m'],
  0, '#fbbf24',
  3000, '#f97316',
  8000, '#38bdf8',
  12000, '#a5b4fc',
]

export const aircraftLayer = {
  sourceId: AIRCRAFT_SOURCE_ID,
  layerIds: [AIRCRAFT_LAYER_ID] as const,
  apply(map: Map, collection: OperationalMapFeatureCollection): void {
    const existing = map.getSource(this.sourceId) as GeoJSONSource | undefined
    if (existing) {
      existing.setData(collection)
      return
    }

    map.addSource(this.sourceId, { type: 'geojson', data: collection })

    // Halo kecil supaya marker terbaca di semua basemap.
    map.addLayer({
      id: `${AIRCRAFT_LAYER_ID}-halo`,
      type: 'circle',
      source: this.sourceId,
      paint: {
        'circle-radius': 7,
        'circle-color': AIRCRAFT_COLOR,
        'circle-opacity': 0.25,
      },
    })

    // Segitiga arah: simbol bawaan "triangle-11" di-rotasi per-heading.
    map.addLayer({
      id: AIRCRAFT_LAYER_ID,
      type: 'symbol',
      source: this.sourceId,
      layout: {
        'icon-image': 'triangle_11',
        'icon-size': 0.9,
        'icon-rotate': ['get', 'heading_deg'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-color': AIRCRAFT_COLOR,
        'icon-halo-width': 1,
        'icon-halo-color': '#0f172a',
      },
    })
  },
  setVisible(map: Map, visible: boolean): void {
    if (typeof map.getLayer !== 'function' || typeof map.setLayoutProperty !== 'function') return
    for (const id of [`${AIRCRAFT_LAYER_ID}-halo`, AIRCRAFT_LAYER_ID]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
    }
  },
  remove(map: Map): void {
    for (const id of [AIRCRAFT_LAYER_ID, `${AIRCRAFT_LAYER_ID}-halo`].reverse()) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
    if (map.getSource(this.sourceId)) map.removeSource(this.sourceId)
  },
} as const
