import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SATELLITE_IR_LAYER_ID,
  SATELLITE_IR_SOURCE_ID,
  fetchLatestSatelliteIRFrame,
  satelliteIRFallbackFrame,
  satelliteIRLayer,
} from './satelliteIR'

function createMap() {
  const layers = new Set<string>()
  const sources = new Map<string, { setTiles?: (tiles: string[]) => void; tiles: string[] }>()
  return {
    layers,
    sources,
    getLayer: (id: string) => layers.has(id),
    getSource: (id: string) => sources.get(id),
    addLayer: vi.fn((layer: { id: string }) => layers.add(layer.id)),
    addSource: vi.fn((id: string, source: { tiles: string[] }) => {
      // Meniru GeoJSONSource/raster-source MapLibre: setTiles tersedia untuk
      // memperbarui tile tanpa membangun ulang source.
      const stored: { setTiles?: (tiles: string[]) => void; tiles: string[] } = { ...source }
      stored.setTiles = (tiles: string[]) => { stored.tiles = [...tiles] }
      sources.set(id, stored)
    }),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    setLayoutProperty: vi.fn(),
  }
}

function collection() {
  return {
    type: 'FeatureCollection' as const,
    layer: 'events' as const,
    truncated: false,
    features: [],
  }
}

const NOW = new Date('2026-08-19T02:00:00Z')

describe('fetchLatestSatelliteIRFrame', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('uses today (UTC) when the granule is available', async () => {
    const head = vi.fn(async (url: string) => ({ ok: url.includes('/2026-08-19/') }))
    vi.stubGlobal('fetch', head)
    const frame = await fetchLatestSatelliteIRFrame(undefined, NOW)
    expect(frame).toEqual({
      date: '2026-08-19',
      tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Himawari_AHI_Band13_Clean_Infrared/default/2026-08-19/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png'],
    })
    expect(head).toHaveBeenCalledTimes(1)
  })

  it('falls back to yesterday when today’s granule is not published yet', async () => {
    const head = vi.fn(async (url: string) => ({ ok: url.includes('/2026-08-18/') }))
    vi.stubGlobal('fetch', head)
    const frame = await fetchLatestSatelliteIRFrame(undefined, NOW)
    expect(frame?.date).toBe('2026-08-18')
    expect(head).toHaveBeenCalledTimes(2)
  })

  it('returns null when neither today nor yesterday is available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    expect(await fetchLatestSatelliteIRFrame(undefined, NOW)).toBeNull()
  })

  it('returns null when the probe fetch throws (offline)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await fetchLatestSatelliteIRFrame(undefined, NOW)).toBeNull()
  })
})

describe('satelliteIRLayer', () => {
  it('adds a raster source+layer (hidden) and is idempotent via setTiles', () => {
    const map = createMap()
    satelliteIRLayer.apply(map as never, satelliteIRFallbackFrame())
    satelliteIRLayer.apply(map as never, satelliteIRFallbackFrame())

    expect(map.addSource).toHaveBeenCalledTimes(1)
    expect(map.addSource).toHaveBeenCalledWith(SATELLITE_IR_SOURCE_ID, expect.objectContaining({
      type: 'raster',
      // Granule GIBS hanya hingga z6 — over-zoom di atasnya.
      maxzoom: 6,
      volatile: true,
    }))
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: SATELLITE_IR_LAYER_ID,
      type: 'raster',
      layout: expect.objectContaining({ visibility: 'none' }),
    }))
  })

  it('replaces the source wholesale when setTiles is unavailable', () => {
    const map = createMap()
    // Source lama tanpa setTiles (mis. versi MapLibre lebih tua).
    map.sources.set(SATELLITE_IR_SOURCE_ID, { tiles: ['https://old.example/{z}/{x}/{y}.png'] })
    satelliteIRLayer.apply(map as never, satelliteIRFallbackFrame())
    expect(map.removeSource).toHaveBeenCalledWith(SATELLITE_IR_SOURCE_ID)
    expect(map.addSource).toHaveBeenCalledTimes(1)
  })

  it('toggles and removes cleanly', () => {
    const map = createMap()
    satelliteIRLayer.apply(map as never, satelliteIRFallbackFrame())
    satelliteIRLayer.setVisible(map as never, true)
    expect(map.setLayoutProperty).toHaveBeenCalledWith(SATELLITE_IR_LAYER_ID, 'visibility', 'visible')
    satelliteIRLayer.setVisible(map as never, false)
    expect(map.setLayoutProperty).toHaveBeenCalledWith(SATELLITE_IR_LAYER_ID, 'visibility', 'none')

    satelliteIRLayer.remove(map as never)
    expect(map.removeLayer).toHaveBeenCalledWith(SATELLITE_IR_LAYER_ID)
    expect(map.removeSource).toHaveBeenCalledWith(SATELLITE_IR_SOURCE_ID)
  })
})
