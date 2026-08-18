import type { Map, RasterLayerSpecification, RasterSourceSpecification } from 'maplibre-gl'

/**
 * Overlay radar cuaca (curah hujan) dari RainViewer — sumber publik gratis
 * tanpa API key (https://www.rainviewer.com/api/weather-maps-api.html).
 * Frame global diperbarui tiap 10 menit; sekaligus menyediakan nowcast
 * 30 menit ke depan (dipakai bila tersedia).
 */

const WEATHER_MAPS_API = 'https://api.rainviewer.com/public/weather-maps.json'
const DEFAULT_TILE_HOST = 'https://tilecache.rainviewer.com'
const FALLBACK_FRAME_PATH = '/v2/radar/0bdbac015576'

export const WEATHER_RADAR_SOURCE_ID = 'operational-map-weather-radar-source'
export const WEATHER_RADAR_LAYER_ID = 'operational-map-weather-radar-layer'

interface RainViewerFrame {
  time: number
  path: string
}

interface RainViewerResponse {
  host?: string
  radar?: {
    past?: RainViewerFrame[]
    nowcast?: RainViewerFrame[]
  }
}

export interface WeatherRadarFrame {
  /** Epoch detik frame radar. */
  time: number
  /** URL template tile: {z}/{x}/{y} tetap diserahkan ke MapLibre. */
  tiles: string[]
  /** True bila frame berasal dari nowcast (proyeksi, bukan observasi). */
  nowcast: boolean
}

/** Ambil frame radar terbaru (nowcast diprioritaskan agar "paling depan"). */
export async function fetchLatestWeatherRadarFrame(signal?: AbortSignal): Promise<WeatherRadarFrame | null> {
  try {
    const response = await fetch(WEATHER_MAPS_API, { signal })
    if (!response.ok) return null
    const body = (await response.json()) as RainViewerResponse
    const host = body.host ?? DEFAULT_TILE_HOST
    const frame = body.radar?.nowcast?.[0] ?? body.radar?.past?.slice(-1)[0]
    if (!frame) return null
    return {
      time: frame.time,
      // 2/{size}/{color}: 256px, palet 4 = Universal Blue (kontras di basemap terang).
      tiles: [`${host}${frame.path}/{z}/{x}/{y}/256/4.png`],
      nowcast: Boolean(body.radar?.nowcast?.length && body.radar?.nowcast[0]?.time === frame.time),
    }
  } catch {
    return null
  }
}

export function fallbackFrame(): WeatherRadarFrame {
  return {
    time: 0,
    tiles: [`${DEFAULT_TILE_HOST}${FALLBACK_FRAME_PATH}/{z}/{x}/{y}/256/4.png`],
    nowcast: false,
  }
}

export const weatherRadarLayer = {
  sourceId: WEATHER_RADAR_SOURCE_ID,
  layerIds: [WEATHER_RADAR_LAYER_ID] as const,
  /** Terapkan (atau perbarui) source+layer radar. Idempoten. */
  apply(map: Map, frame: WeatherRadarFrame): void {
    const rasterSource: RasterSourceSpecification = {
      type: 'raster',
      tiles: frame.tiles,
      tileSize: 256,
      attribution: 'Radar cuaca © RainViewer',
      // Raster tidak boleh ter-cache terlalu lama: frame berganti tiap 10 menit.
      volatile: true,
    }
    const rasterLayer: RasterLayerSpecification = {
      id: WEATHER_RADAR_LAYER_ID,
      type: 'raster',
      source: WEATHER_RADAR_SOURCE_ID,
      layout: { visibility: 'none' },
      paint: {
        'raster-opacity': 0.65,
        'raster-opacity-transition': { duration: 200 },
        'raster-fade-duration': 200,
        'raster-resampling': 'linear',
      },
    }

    const existing = map.getSource(this.sourceId)
    if (!existing) {
      map.addSource(this.sourceId, rasterSource)
      map.addLayer(rasterLayer)
      return
    }
    const mutable = existing as unknown as { setTiles?: (tiles: string[]) => void }
    if (typeof mutable.setTiles === 'function') {
      mutable.setTiles(rasterSource.tiles as string[])
    } else {
      // Source lama tanpa setTiles: ganti total agar frame baru dipakai.
      if (map.getLayer(WEATHER_RADAR_LAYER_ID)) map.removeLayer(WEATHER_RADAR_LAYER_ID)
      map.removeSource(this.sourceId)
      map.addSource(this.sourceId, rasterSource)
      map.addLayer(rasterLayer)
      return
    }
    if (map.getLayer(WEATHER_RADAR_LAYER_ID)) {
      map.setPaintProperty(WEATHER_RADAR_LAYER_ID, 'raster-opacity', 0.65)
    }
  },
  setVisible(map: Map, visible: boolean): void {
    if (typeof map.getLayer !== 'function' || !map.getLayer(WEATHER_RADAR_LAYER_ID)) return
    map.setLayoutProperty(WEATHER_RADAR_LAYER_ID, 'visibility', visible ? 'visible' : 'none')
  },
  remove(map: Map): void {
    if (map.getLayer(WEATHER_RADAR_LAYER_ID)) map.removeLayer(WEATHER_RADAR_LAYER_ID)
    if (map.getSource(this.sourceId)) map.removeSource(this.sourceId)
  },
} as const
