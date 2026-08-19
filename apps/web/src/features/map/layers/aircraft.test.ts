import { describe, expect, it, vi } from 'vitest'
import { advanceAircraftPositions, aircraftLayer } from './aircraft'
import type { OperationalMapFeatureCollection } from '../types'

function aircraftCollection(): OperationalMapFeatureCollection {
  return {
    type: 'FeatureCollection',
    layer: 'aircraft',
    truncated: false,
    features: [{
      type: 'Feature',
      id: 'aircraft:abc',
      geometry: { type: 'Point', coordinates: [106.8, -6.2] },
      properties: {
        id: 'aircraft:abc',
        layer: 'aircraft',
        label: 'GIA101',
        source: 'opensky',
        attribution: 'The OpenSky Network',
        verification_status: 'source-reported',
        velocity_ms: 100,
        heading_deg: 0,
        altitude_m: 9000,
      },
    }],
  }
}

describe('advanceAircraftPositions', () => {
  it('memajukan posisi sesuai velocity & heading (dead-reckoning)', () => {
    const moved = advanceAircraftPositions(aircraftCollection(), 10) // 10s × 100 m/s = 1000 m ke utara
    const [lon, lat] = (moved.features[0].geometry as unknown as { coordinates: [number, number] }).coordinates
    expect(lat).toBeCloseTo(-6.2 + 1000 / 111_320, 8)
    expect(lon).toBeCloseTo(106.8, 8)
  })

  it('heading timur (90°) menggerakkan bujur, bukan lintang', () => {
    const collection = aircraftCollection()
    collection.features[0].properties.heading_deg = 90
    const moved = advanceAircraftPositions(collection, 10)
    const [lon, lat] = (moved.features[0].geometry as unknown as { coordinates: [number, number] }).coordinates
    expect(lon).toBeGreaterThan(106.8)
    expect(lat).toBeCloseTo(-6.2, 8)
  })

  it('tidak mengubah apa pun saat elapsed 0 atau velocity kosong', () => {
    const collection = aircraftCollection()
    expect(advanceAircraftPositions(collection, 0)).toBe(collection)
    collection.features[0].properties.velocity_ms = undefined
    const moved = advanceAircraftPositions(collection, 10)
    expect((moved.features[0].geometry as unknown as { coordinates: [number, number] }).coordinates).toEqual([106.8, -6.2])
  })
})

describe('aircraftLayer adapter', () => {
  function createMap() {
    const layers = new Set<string>()
    const sources = new Map<string, unknown>()
    const mockSetData = vi.fn()
    return {
      addLayer: vi.fn((layer: { id: string }) => layers.add(layer.id)),
      addSource: vi.fn((id: string, source: unknown) => sources.set(id, { ...(source as object), setData: mockSetData })),
      setData: mockSetData,
      getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
      getSource: vi.fn((id: string) => sources.get(id)),
      removeLayer: vi.fn((id: string) => layers.delete(id)),
      removeSource: vi.fn((id: string) => sources.delete(id)),
      setLayoutProperty: vi.fn(),
    }
  }

  it('apply mendaftarkan source + halo + layer symbol ter-rotasi heading, idempoten', () => {
    const map = createMap()
    aircraftLayer.apply(map as never, aircraftCollection())
    expect(map.addSource).toHaveBeenCalledWith(aircraftLayer.sourceId, expect.objectContaining({ type: 'geojson' }))
    const ids = map.addLayer.mock.calls.map((call) => call[0].id)
    expect(ids).toContain('operational-map-aircraft-layer')
    expect(ids).toContain('operational-map-aircraft-layer-halo')

    aircraftLayer.apply(map as never, aircraftCollection())
    expect(map.addLayer).toHaveBeenCalledTimes(2)
  })

  it('layer symbol memutar ikon dari heading_deg', () => {
    const map = createMap()
    aircraftLayer.apply(map as never, aircraftCollection())
    const symbol = map.addLayer.mock.calls.map((c) => c[0]).find((l) => (l as { id?: string }).id === 'operational-map-aircraft-layer') as { layout: Record<string, unknown> } | undefined
    expect(symbol?.layout['icon-rotate']).toEqual(['get', 'heading_deg'])
    // Nama ikon HARUS ada di sprite OpenFreeMap (ofm_f384): underscore, bukan dash.
    // Salah nama = MapLibre merender bulatan hitam fallback.
    expect(symbol?.layout['icon-image']).toBe('triangle_11')
  })

  it('setVisible & remove bersih', () => {
    const map = createMap()
    aircraftLayer.apply(map as never, aircraftCollection())
    aircraftLayer.setVisible(map as never, false)
    expect(map.setLayoutProperty).toHaveBeenCalledWith(expect.stringContaining('aircraft'), 'visibility', 'none')
    aircraftLayer.remove(map as never)
    expect(map.removeSource).toHaveBeenCalledWith(aircraftLayer.sourceId)
  })
})
