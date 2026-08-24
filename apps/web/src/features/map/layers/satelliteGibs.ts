import type { Map, RasterLayerSpecification, RasterSourceSpecification } from 'maplibre-gl'

/**
 * S10 — Layer citra satelit tambahan dari NASA GIBS (semua gratis tanpa key,
 * terverifikasi live untuk tile Indonesia):
 *
 * 1. MODIS_Terra_CorrectedReflectance_TrueColor — citra asli harian 250m.
 *    Asap karhutla, abu vulkanik, dan banjir bandang terlihat langsung.
 *    (Level9 + jpg — beda dari Himawari Level6/png.)
 * 2. MODIS_Combined_Flood_2-Day — deteksi banjir satelit (composite 2 hari),
 *    pelengkap laporan ground PetaBencana.
 * 3. OMPS_Aerosol_Index — sebaran asap/aerosol harian; pasangan visual dari
 *    panel Dampak Asap Lintas Batas.
 *
 * Vintage (tanggal UTC) selalu tersimpan di frame agar UI bisa menampilkan
 * umur data secara jujur (pola stamp Situasi Wilayah).
 */

export interface GibsFrame {
  /** Tanggal data (UTC, YYYY-MM-DD) — ditampilkan sebagai vintage. */
  date: string
  /** URL template tile: {z}/{x}/{y} diserahkan ke MapLibre. */
  tiles: string[]
}

export interface GibsLayerSpec {
  key: 'truecolor' | 'flood' | 'aerosol'
  /** Template URL dgn placeholder {date}. */
  template: string
  /** Template probe (tile 0/0/0) utk cek ketersediaan granule. */
  probe: string
  maxzoom: number
  attribution: string
  /** Opacity default — flood lebih tipis agar marker tetap terbaca. */
  opacity: number
}

function layer9(templateLayer: string): { template: string; probe: string } {
  const base = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${templateLayer}/default/{date}/GoogleMapsCompatible_Level9`
  return {
    template: `${base}/{z}/{x}/{y}.jpg`,
    probe: `${base}/0/0/0.jpg`,
  }
}

function layer6(templateLayer: string): { template: string; probe: string } {
  const base = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${templateLayer}/default/{date}/GoogleMapsCompatible_Level6`
  return {
    template: `${base}/{z}/{x}/{y}.png`,
    probe: `${base}/0/0/0.png`,
  }
}

const TRUECOLOR = layer9('MODIS_Terra_CorrectedReflectance_TrueColor')
const FLOOD = layer9('MODIS_Combined_Flood_2-Day')
const AEROSOL = layer6('OMPS_Aerosol_Index')

export const GIBS_LAYER_SPECS: Record<GibsLayerSpec['key'], GibsLayerSpec> = {
  truecolor: {
    key: 'truecolor',
    ...TRUECOLOR,
    maxzoom: 9,
    attribution: 'Citra satelit © NASA GIBS · MODIS Terra',
    opacity: 1.0,
  },
  flood: {
    key: 'flood',
    ...FLOOD,
    maxzoom: 9,
    attribution: 'Deteksi banjir satelit © NASA GIBS · MODIS',
    opacity: 0.75,
  },
  aerosol: {
    key: 'aerosol',
    ...AEROSOL,
    maxzoom: 6,
    attribution: 'Indeks aerosol © NASA GIBS · OMPS',
    opacity: 0.7,
  },
}

function utcDateString(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

async function granuleAvailable(probeTemplate: string, date: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(probeTemplate.replace('{date}', date), { method: 'HEAD', signal })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Frame termutakhir utk satu layer: hari ini (UTC), fallback kemarin.
 * Null bila keduanya tidak tersedia — peta tetap berfungsi tanpa overlay.
 */
export async function fetchLatestGibsFrame(
  key: GibsLayerSpec['key'],
  signal?: AbortSignal,
  now = new Date(),
): Promise<GibsFrame | null> {
  const spec = GIBS_LAYER_SPECS[key]
  const today = utcDateString(now)
  const yesterday = utcDateString(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  const date = (await granuleAvailable(spec.probe, today, signal))
    ? today
    : (await granuleAvailable(spec.probe, yesterday, signal)) ? yesterday : null
  if (!date) return null
  return { date, tiles: [spec.template.replace('{date}', date)] }
}

export interface GibsLayerHandle {
  sourceId: string
  layerId: string
}

export function gibsLayerHandle(key: GibsLayerSpec['key']): GibsLayerHandle {
  return {
    sourceId: `operational-map-gibs-${key}-source`,
    layerId: `operational-map-gibs-${key}-layer`,
  }
}

/** Terapkan (atau perbarui) source+layer raster. Idempoten. */
export function applyGibsLayer(map: Map, key: GibsLayerSpec['key'], frame: GibsFrame): void {
  const spec = GIBS_LAYER_SPECS[key]
  const { sourceId, layerId } = gibsLayerHandle(key)
  const rasterSource: RasterSourceSpecification = {
    type: 'raster',
    tiles: frame.tiles,
    tileSize: 256,
    attribution: spec.attribution,
    maxzoom: spec.maxzoom,
    volatile: true,
  }
  const rasterLayer: RasterLayerSpecification = {
    id: layerId,
    type: 'raster',
    source: sourceId,
    layout: { visibility: 'none' },
    paint: {
      'raster-opacity': spec.opacity,
      'raster-opacity-transition': { duration: 200 },
      'raster-fade-duration': 200,
      'raster-resampling': 'linear',
    },
  }

  const existing = map.getSource(sourceId)
  if (!existing) {
    map.addSource(sourceId, rasterSource)
    map.addLayer(rasterLayer)
    return
  }
  const mutable = existing as unknown as { setTiles?: (tiles: string[]) => void }
  if (typeof mutable.setTiles === 'function') {
    mutable.setTiles(rasterSource.tiles as string[])
    return
  }
  if (map.getLayer(layerId)) map.removeLayer(layerId)
  map.removeSource(sourceId)
  map.addSource(sourceId, rasterSource)
  map.addLayer(rasterLayer)
}

export function setGibsLayerVisible(map: Map, key: GibsLayerSpec['key'], visible: boolean): void {
  const { layerId } = gibsLayerHandle(key)
  if (typeof map.getLayer !== 'function' || typeof map.setLayoutProperty !== 'function') return
  if (!map.getLayer(layerId)) return
  map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none')
}

export function removeGibsLayer(map: Map, key: GibsLayerSpec['key']): void {
  const { sourceId, layerId } = gibsLayerHandle(key)
  if (map.getLayer(layerId)) map.removeLayer(layerId)
  if (map.getSource(sourceId)) map.removeSource(sourceId)
}

export { utcDateString }
