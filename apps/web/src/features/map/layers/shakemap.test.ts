import { afterEach, describe, expect, it, vi } from 'vitest'
import { SHAKEMAP_LAYER_PREFIX, SHAKEMAP_SOURCE_PREFIX, shakemapLayer } from './shakemap'
import type { OperationalMapFeatureCollection } from '../types'

// jsdom tidak memuat Image (data-URL + crossOrigin) — stub agar onload
// tersinkron dan apply selesai tanpa network.
class FakeImage {
  crossOrigin: string | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  private _src = ''
  get src() { return this._src }
  set src(value: string) {
    this._src = value
    if (value) queueMicrotask(() => this.onload?.())
  }
}
vi.stubGlobal('Image', FakeImage)
afterEach(() => { vi.restoreAllMocks() })

function createMap() {
  const sources = new Map<string, unknown>()
  const layers = new Map<string, { layout: { visibility: string } }>()
  return {
    sources, layers,
    getStyle: () => ({ sources: Object.fromEntries(sources) }),
    getSource: (id: string) => sources.get(id),
    getLayer: (id: string) => layers.get(id),
    addSource: vi.fn((id: string, src: unknown) => sources.set(id, src)),
    addLayer: vi.fn((layer: { id: string; layout?: { visibility?: string } }) =>
      layers.set(layer.id, { layout: { visibility: layer.layout?.visibility ?? 'visible' } })),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
    setLayoutProperty: vi.fn((id: string, key: string, value: string) => {
      const layer = layers.get(id)
      if (layer && key === 'visibility') layer.layout.visibility = value
    }),
  }
}

function collection(): OperationalMapFeatureCollection {
  return {
    type: 'FeatureCollection',
    layer: 'shakemaps',
    truncated: false,
    features: [{
      type: 'Feature',
      id: 'shakemap:20260820062013',
      geometry: { type: 'Point', coordinates: [120.57, -8.28] },
      properties: {
        id: 'shakemap:20260820062013',
        layer: 'shakemaps',
        label: 'Shakemap M 4.5',
        source: 'bmkg',
        attribution: 'BMKG',
        verification_status: 'official',
        shakemap_url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', // 1px uji
        shakemap_bbox: [118.07, -10.78, 123.07, -5.78],
      },
    }] as never[],
  }
}

describe('shakemapLayer', () => {
  it('adds the MMI image source georeferenced to the 5° bbox and VISIBLE', async () => {
    const map = createMap()
    await shakemapLayer.apply(map as never, collection())

    const sourceId = SHAKEMAP_SOURCE_PREFIX + 'shakemap:20260820062013'
    const layerId = SHAKEMAP_LAYER_PREFIX + 'shakemap:20260820062013'
    expect(map.getSource(sourceId)).toBeTruthy()
    expect(map.getLayer(layerId)).toBeTruthy()
    // Regresi bug toggle: layer wajib langsung visible saat apply
    // (siklus toggle = apply/remove adapter; apply berarti ON).
    expect(map.getLayer(layerId)!.layout.visibility).toBe('visible')
    // Georeferensi 4 sudut: kiri-atas minLon/maxLat dst.
    const source = map.sources.get(sourceId) as { coordinates: [number, number][] }
    expect(source.coordinates).toEqual([
      [118.07, -5.78], [123.07, -5.78], [123.07, -10.78], [118.07, -10.78],
    ])
  })

  it('removes stale overlays absent from the collection and cleans up fully on remove', async () => {
    const map = createMap()
    await shakemapLayer.apply(map as never, collection())
    // Apply ulang dengan koleksi kosong -> overlay lama dibersihkan.
    await shakemapLayer.apply(map as never, { type: 'FeatureCollection', layer: 'shakemaps', truncated: false, features: [] })
    expect(map.sources.size).toBe(0)
    expect(map.layers.size).toBe(0)

    await shakemapLayer.apply(map as never, collection())
    shakemapLayer.remove(map as never)
    expect(map.sources.size).toBe(0)
    expect(map.layers.size).toBe(0)
  })

  it('setVisible toggles only existing shakemap layers', async () => {
    const map = createMap()
    await shakemapLayer.apply(map as never, collection())
    shakemapLayer.setVisible(map as never, false, collection())
    const layerId = SHAKEMAP_LAYER_PREFIX + 'shakemap:20260820062013'
    expect(map.getLayer(layerId)!.layout.visibility).toBe('none')
    shakemapLayer.setVisible(map as never, true, collection())
    expect(map.getLayer(layerId)!.layout.visibility).toBe('visible')
  })
})
