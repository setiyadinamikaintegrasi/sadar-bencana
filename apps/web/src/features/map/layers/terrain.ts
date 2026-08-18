import type { HillshadeLayerSpecification, Map, RasterDEMSourceSpecification } from 'maplibre-gl'

/**
 * Terrain 3D + hillshade dari AWS Terrain Tiles (Terrarium) — open data,
 * gratis tanpa API key, cakupan global
 * (https://registry.opendata.aws/terrain-tiles/).
 *
 * - raster-dem source (encoding 'terrarium') mengaktifkan terrain 3D via
 *   map.setTerrain (pitch/bearing kini menampilkan relief sungguhan).
 * - layer hillshade memberi kedalaman visual bahkan tanpa pitch.
 */

export const TERRAIN_DEM_SOURCE_ID = 'operational-map-terrain-dem-source'
export const TERRAIN_HILLSHADE_LAYER_ID = 'operational-map-terrain-hillshade'

const TERRARIUM_TILES = [
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
]

const DEM_SOURCE: RasterDEMSourceSpecification = {
  type: 'raster-dem',
  tiles: TERRARIUM_TILES,
  encoding: 'terrarium',
  tileSize: 256,
  maxzoom: 13,
  attribution: 'Elevation: Terrain Tiles (AWS Open Data)',
}

export const terrainLayer = {
  sourceId: TERRAIN_DEM_SOURCE_ID,
  layerIds: [TERRAIN_HILLSHADE_LAYER_ID] as const,
  /** Pasang DEM source + hillshade (idempoten). */
  apply(map: Map): void {
    if (!map.getSource(this.sourceId)) {
      map.addSource(this.sourceId, DEM_SOURCE)
    }
    if (!map.getLayer(TERRAIN_HILLSHADE_LAYER_ID)) {
      const hillshade: HillshadeLayerSpecification = {
        id: TERRAIN_HILLSHADE_LAYER_ID,
        type: 'hillshade',
        source: this.sourceId,
        layout: { visibility: 'none' },
        paint: {
          'hillshade-exaggeration': 0.45,
          'hillshade-shadow-color': '#0b1220',
          'hillshade-highlight-color': '#ffffff',
          'hillshade-accent-color': '#3b4a5a',
        },
      }
      map.addLayer(hillshade)
    }
  },
  /** Aktifkan/nonaktifkan terrain 3D (pitch) + hillshade. */
  setVisible(map: Map, visible: boolean): void {
    if (typeof map.getLayer !== 'function' || typeof map.setTerrain !== 'function') return
    if (visible) {
      map.setTerrain({ source: this.sourceId, exaggeration: 1.2 })
    } else {
      map.setTerrain(null)
    }
    if (map.getLayer(TERRAIN_HILLSHADE_LAYER_ID)) {
      map.setLayoutProperty(TERRAIN_HILLSHADE_LAYER_ID, 'visibility', visible ? 'visible' : 'none')
    }
  },
  remove(map: Map): void {
    if (typeof map.setTerrain === 'function') map.setTerrain(null)
    if (map.getLayer(TERRAIN_HILLSHADE_LAYER_ID)) map.removeLayer(TERRAIN_HILLSHADE_LAYER_ID)
    if (map.getSource(this.sourceId)) map.removeSource(this.sourceId)
  },
} as const

/** Ganti proyeksi peta mercator <-> globe. */
export function setGlobeProjection(map: Map, globe: boolean): void {
  if (typeof map.setProjection !== 'function') return
  map.setProjection({ type: globe ? 'globe' : 'mercator' })
}
