import type { Map, RasterLayerSpecification, RasterSourceSpecification } from 'maplibre-gl'

/**
 * P10 — Overlay satelit inframerah (suhu puncak awan) dari NASA GIBS.
 *
 * Sumber awal rencana (RainViewer satellite IR) dihentikan RainViewer untuk
 * pengguna gratis per 1 Jan 2026 (FAQ transisi API mereka; field
 * `satellite.infrared` kini selalu kosong). Pengganti gratis tanpa API key:
 * NASA GIBS — layer Himawari AHI Band 13 "Clean Infrared" (10,3 µm), satelit
 * geostasioner yang mencakup seluruh Indonesia dengan pembaruan ±10-15 menit.
 * https://wiki.earthdata.nasa.gov/display/GIBS/
 *
 * Tile bertanggal eksplisit (YYYY-MM-DD UTC) agar vintage data jujur bisa
 * ditampilkan; bila granule hari ini belum terbit (awal hari UTC), jatuh ke
 * tanggal kemarin.
 */

const GIBS_TILE_TEMPLATE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Himawari_AHI_Band13_Clean_Infrared/default/{date}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png'
// Tile z0 untuk probe ketersediaan granule (satu request kecil per siklus).
const GIBS_PROBE_TEMPLATE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Himawari_AHI_Band13_Clean_Infrared/default/{date}/GoogleMapsCompatible_Level6/0/0/0.png'

export const SATELLITE_IR_SOURCE_ID = 'operational-map-satellite-ir-source'
export const SATELLITE_IR_LAYER_ID = 'operational-map-satellite-ir-layer'

export interface SatelliteIRFrame {
  /** Tanggal data (UTC) yang dipakai — ditampilkan sebagai vintage. */
  date: string
  /** URL template tile: {z}/{x}/{y} diserahkan ke MapLibre. */
  tiles: string[]
}

function utcDateString(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

async function granuleAvailable(date: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(GIBS_PROBE_TEMPLATE.replace('{date}', date), { method: 'HEAD', signal })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Ambil frame IR termutakhir: tanggal hari ini (UTC), fallback kemarin bila
 * granule hari ini belum terbit. Mengembalikan null bila keduanya gagal
 * (mis. offline) — peta tetap berfungsi tanpa overlay.
 */
export async function fetchLatestSatelliteIRFrame(signal?: AbortSignal, now = new Date()): Promise<SatelliteIRFrame | null> {
  const today = utcDateString(now)
  const yesterday = utcDateString(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  const date = (await granuleAvailable(today, signal)) ? today : (await granuleAvailable(yesterday, signal)) ? yesterday : null
  if (!date) return null
  return {
    date,
    tiles: [GIBS_TILE_TEMPLATE.replace('{date}', date)],
  }
}

export function satelliteIRFallbackFrame(): SatelliteIRFrame {
  // Fallback tanpa probe: tanggal hari ini — dipakai saat fetch gagal total,
  // layer disembunyikan secara default sehingga tile tidak diminta.
  return { date: utcDateString(new Date()), tiles: [GIBS_TILE_TEMPLATE.replace('{date}', utcDateString(new Date()))] }
}

export const satelliteIRLayer = {
  sourceId: SATELLITE_IR_SOURCE_ID,
  layerIds: [SATELLITE_IR_LAYER_ID] as const,
  /** Terapkan (atau perbarui) source+layer IR. Idempoten. */
  apply(map: Map, frame: SatelliteIRFrame): void {
    const rasterSource: RasterSourceSpecification = {
      type: 'raster',
      tiles: frame.tiles,
      tileSize: 256,
      attribution: 'Satelit IR © NASA GIBS · Himawari (JAXA)',
      // Layer GIBS ini hanya tersedia hingga z6 — maxzoom membuat MapLibre
      // over-zoom tile z6 (diperbesar + resampling linear) di zoom tinggi.
      maxzoom: 6,
      // Jangan cache terlalu lama: granule berganti ±10-15 menit.
      volatile: true,
    }
    const rasterLayer: RasterLayerSpecification = {
      id: SATELLITE_IR_LAYER_ID,
      type: 'raster',
      source: SATELLITE_IR_SOURCE_ID,
      layout: { visibility: 'none' },
      paint: {
        'raster-opacity': 0.7,
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
      return
    }
    if (map.getLayer(SATELLITE_IR_LAYER_ID)) map.removeLayer(SATELLITE_IR_LAYER_ID)
    map.removeSource(this.sourceId)
    map.addSource(this.sourceId, rasterSource)
    map.addLayer(rasterLayer)
  },
  setVisible(map: Map, visible: boolean): void {
    if (typeof map.getLayer !== 'function' || typeof map.setLayoutProperty !== 'function') return
    if (!map.getLayer(SATELLITE_IR_LAYER_ID)) return
    map.setLayoutProperty(SATELLITE_IR_LAYER_ID, 'visibility', visible ? 'visible' : 'none')
  },
  remove(map: Map): void {
    if (map.getLayer(SATELLITE_IR_LAYER_ID)) map.removeLayer(SATELLITE_IR_LAYER_ID)
    if (map.getSource(this.sourceId)) map.removeSource(this.sourceId)
  },
} as const
