import type { Map as MapLibreMap } from 'maplibre-gl'
import type { OperationalMapFeatureCollection } from '../types'

/**
 * S6 — Overlay Shakemap MMI BMKG: gambar intensitas gempa yang
 * ter-georeferensi (bbox 5° berpusat episenter, diverifikasi pixel-level).
 * Satu event = satu image source + layer raster; episenter tetap diklik
 * dari layer events biasa.
 */

export const SHAKEMAP_SOURCE_PREFIX = 'operational-map-shakemap-src-'
export const SHAKEMAP_LAYER_PREFIX = 'operational-map-shakemap-layer-'

/** Muat gambar shakemap; null bila gagal (CORS/network). */
function loadShakemapImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = url
  })
}

interface ShakemapAdapter {
  /** Id layer dinamis per overlay; kosong (adapter registry). */
  layerIds: readonly string[]
  apply(map: MapLibreMap, collection: OperationalMapFeatureCollection): Promise<void>
  setVisible(map: MapLibreMap, visible: boolean, collection?: OperationalMapFeatureCollection): void
  remove(map: MapLibreMap): void
}

export const shakemapLayer: ShakemapAdapter = {
  layerIds: [] as readonly string[],
  async apply(map, collection) {
    const wanted = new Map<string, { url: string; bbox: [number, number, number, number] }>()
    for (const feature of collection.features) {
      const props = feature.properties as {
        shakemap_bbox?: [number, number, number, number]
        shakemap_url?: string
      }
      const id = String(feature.id ?? '')
      if (!id || !props.shakemap_url || !props.shakemap_bbox || props.shakemap_bbox.length !== 4) continue
      wanted.set(id, { url: props.shakemap_url, bbox: props.shakemap_bbox })
    }

    // Hapus overlay yang tak lagi ada dalam data (viewport/refresh).
    const style = map.getStyle()
    const existingSources = (style?.sources ?? {}) as Record<string, unknown>
    for (const sourceId of Object.keys(existingSources)) {
      if (!sourceId.startsWith(SHAKEMAP_SOURCE_PREFIX)) continue
      const key = sourceId.slice(SHAKEMAP_SOURCE_PREFIX.length)
      if (wanted.has(key)) continue
      const layerId = SHAKEMAP_LAYER_PREFIX + key
      if (map.getLayer(layerId)) map.removeLayer(layerId)
      if (map.getSource(sourceId)) map.removeSource(sourceId)
    }

    // Pasang overlay baru (satu per satu; jumlah kecil).
    for (const [key, { url, bbox }] of wanted) {
      const sourceId = SHAKEMAP_SOURCE_PREFIX + key
      if (map.getSource(sourceId)) continue
      const image = await loadShakemapImage(url)
      if (!image) continue
      map.addSource(sourceId, {
        type: 'image',
        url,
        coordinates: [
          [bbox[0], bbox[3]], // kiri-atas (minLon, maxLat)
          [bbox[2], bbox[3]], // kanan-atas
          [bbox[2], bbox[1]], // kanan-bawah
          [bbox[0], bbox[1]], // kiri-bawah
        ],
      })
      map.addLayer({
        id: SHAKEMAP_LAYER_PREFIX + key,
        type: 'raster',
        source: sourceId,
        // Langsung visible: siklus toggle memakai apply/remove adapter
        // (OFF = remove seluruh source), sehingga apply berarti ON.
        layout: { visibility: 'visible' },
        paint: {
          'raster-opacity': 0.75,
          'raster-opacity-transition': { duration: 200 },
          'raster-fade-duration': 200,
          'raster-resampling': 'linear',
        },
      })
    }
  },

  setVisible(map, visible, collection) {
    if (!collection) return
    for (const feature of collection.features) {
      const layerId = SHAKEMAP_LAYER_PREFIX + String(feature.id ?? '')
      if (!layerId.endsWith('-') && map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none')
      }
    }
  },

  remove(map) {
    const style = map.getStyle()
    const sources = (style?.sources ?? {}) as Record<string, unknown>
    for (const sourceId of Object.keys(sources)) {
      if (!sourceId.startsWith(SHAKEMAP_SOURCE_PREFIX)) continue
      const layerId = SHAKEMAP_LAYER_PREFIX + sourceId.slice(SHAKEMAP_SOURCE_PREFIX.length)
      if (map.getLayer(layerId)) map.removeLayer(layerId)
      if (map.getSource(sourceId)) map.removeSource(sourceId)
    }
  },
}
