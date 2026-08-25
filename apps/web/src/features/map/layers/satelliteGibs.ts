import type { Map, RasterLayerSpecification, RasterSourceSpecification } from 'maplibre-gl'

/**
 * S10 — Layer citra satelit:
 *
 * 1. 'Citra satelit' — ESRI World Imagery (gratis, tanpa key): citra
 *    resolusi tinggi yang SELALU tersedia. Catatan: NASA GIBS MODIS
 *    True Color dinilai ulang setelah insiden data hitam luas di Asia
 *    Tenggara (granule kosong walau HTTP 200) + VIIRS down + Himawari
 *    stale — upstream bermasalah; ESRI dipilih agar toggle selalu
 *    menampilkan citra nyata. Vintage = 'live' (basemap statis).
 * 2. 'Banjir satelit' — MODIS_Combined_Flood_2-Day (GIBS): deteksi banjir
 *    composite 2 hari, pelengkap laporan ground PetaBencana.
 * 3. 'Sebaran asap' — OMPS_Aerosol_Index (GIBS): plume aerosol harian.
 *
 * Layer GIBS memakai probe granule area-data (bukan 0/0/0 yang bisa
 * mengembalikan placeholder kosong) + fallback H-0/H-1/H-2.
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
  /** URL probe granule nyata (≥1 harus tersedia). */
  probe: string[]
  maxzoom: number
  attribution: string
  /** Opacity default — flood lebih tipis agar marker tetap terbaca. */
  opacity: number
}

function layer9(templateLayer: string): { template: string } {
  const base = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${templateLayer}/default/{date}/GoogleMapsCompatible_Level9`
  return {
    template: `${base}/{z}/{x}/{y}.jpg`,
  }
}

function layer6(templateLayer: string): { template: string } {
  const base = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${templateLayer}/default/{date}/GoogleMapsCompatible_Level6`
  return {
    template: `${base}/{z}/{x}/{y}.png`,
  }
}

const TRUECOLOR = layer9('MODIS_Terra_CorrectedReflectance_TrueColor')
const FLOOD = layer9('MODIS_Combined_Flood_2-Day')
const AEROSOL = layer6('OMPS_Aerosol_Index')

// Probe pakai tile area data (bukan 0/0/0 placeholder) — lihat catatan
// realTileProbe di bawah.
const TRUECOLOR_PROBES = realTileProbe(TRUECOLOR.template)
const FLOOD_PROBES = realTileProbe(FLOOD.template)
const AEROSOL_PROBES = realTileProbe(AEROSOL.template)

export const GIBS_LAYER_SPECS: Record<GibsLayerSpec['key'], GibsLayerSpec> = {
  truecolor: {
    key: 'truecolor',
    // ESRI World Imagery — tile xyz klasik (tanpa tanggal), selalu tersedia.
    template: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    probe: [], // basemap statis: tidak perlu probe granule
    maxzoom: 19,
    attribution: 'Citra satelit © Esri, Maxar, Earthstar Geographics',
    opacity: 1.0,
  },
  flood: {
    key: 'flood',
    ...FLOOD,
    probe: FLOOD_PROBES,
    maxzoom: 4,
    attribution: 'Deteksi banjir satelit © NASA GIBS · MODIS',
    opacity: 0.75,
  },
  aerosol: {
    key: 'aerosol',
    ...AEROSOL,
    probe: AEROSOL_PROBES,
    maxzoom: 6,
    attribution: 'Indeks aerosol © NASA GIBS · OMPS',
    opacity: 0.7,
  },
}

function utcDateString(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/**
 * Probe ketersediaan granule. Pitfall (ditemukan live): GIBS mengembalikan
 * 200 + tile placeholder KOSONG utk tanggal tanpa granule (awal hari UTC),
 * sehingga cek 0/0/0 saja menyesatkan — tile nyata tetap 404 dan peta
 * menjadi hitam. Solusi: probe tile TENGAH area data (z5 di sekitar
 * Indonesia) yang hanya ada bila granule sungguhan terbit.
 */
async function granuleAvailable(probes: string[], date: string, signal?: AbortSignal): Promise<boolean> {
  const results = await Promise.all(probes.map(async (probe) => {
    try {
      const response = await fetch(probe.replace('{date}', date), { method: 'HEAD', signal })
      return response.ok
    } catch {
      return false
    }
  }))
  // Granule layak bila minimal satu tile area data tersedia.
  return results.some(Boolean)
}

/**
 * Probe granule nyata: dua tile di area data (barat=Sumatera 5/26/16,
 * timur=Maluku 4/13/8-ish via z4). Satu tile tunggal menyesatkan — MODIS
 * granule harian bisa parsial (pass pagi/sore) sehingga sebagian tile
 * 404 walau granule 'ada'. Tanggal dianggap layak bila KEDUA probe ada;
 * MapLibre lalu menangani sisa tile kosong per-tile (yang tampil tetap
 * tampil, tidak hitam).
 */
function realTileProbe(template: string): string[] {
  return [
    template.replace('{z}/{x}/{y}', '5/26/16'),
    template.replace('{z}/{x}/{y}', '4/13/8'),
  ]
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
  // Basemap statis (ESRI): selalu tersedia, vintage 'live'.
  if (spec.probe.length === 0) {
    return { date: 'live', tiles: [spec.template] }
  }
  // Coba H-0, H-1, H-2: granule MODIS terbit sore UTC; awal hari UTC
  // (malam WIB) granule hari-ini belum ada bahkan H-1 kadang belum
  // lengkap — H-2 praktis selalu tersedia.
  for (const offset of [0, 1, 2]) {
    const date = utcDateString(new Date(now.getTime() - offset * 24 * 60 * 60 * 1000))
    if (await granuleAvailable(spec.probe, date, signal)) {
      return { date, tiles: [spec.template.replace('{date}', date)] }
    }
  }
  return null
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
