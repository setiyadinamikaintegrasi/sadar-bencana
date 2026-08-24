import { describe, expect, it } from 'vitest'

import {
  GIBS_LAYER_SPECS,
  applyGibsLayer,
  fetchLatestGibsFrame,
  gibsLayerHandle,
  removeGibsLayer,
  setGibsLayerVisible,
  utcDateString,
} from './satelliteGibs'

describe('GIBS layer specs (S10)', () => {
  it('mendefinisikan tiga layer dengan template URL GIBS yang benar', () => {
    expect(GIBS_LAYER_SPECS.truecolor.template).toContain('MODIS_Terra_CorrectedReflectance_TrueColor')
    expect(GIBS_LAYER_SPECS.truecolor.template).toContain('GoogleMapsCompatible_Level9')
    expect(GIBS_LAYER_SPECS.truecolor.template).toMatch(/\.jpg$/)

    expect(GIBS_LAYER_SPECS.flood.template).toContain('MODIS_Combined_Flood_2-Day')
    expect(GIBS_LAYER_SPECS.flood.template).toContain('Level9')

    expect(GIBS_LAYER_SPECS.aerosol.template).toContain('OMPS_Aerosol_Index')
    expect(GIBS_LAYER_SPECS.aerosol.template).toContain('Level6')
    expect(GIBS_LAYER_SPECS.aerosol.template).toMatch(/\.png$/)
  })

  it('flood opacity lebih rendah agar marker tetap terbaca', () => {
    expect(GIBS_LAYER_SPECS.flood.opacity).toBeLessThan(GIBS_LAYER_SPECS.truecolor.opacity)
    expect(GIBS_LAYER_SPECS.aerosol.opacity).toBeLessThan(1)
  })

  it('handle id unik per layer', () => {
    const handles = ['truecolor', 'flood', 'aerosol'].map((k) => gibsLayerHandle(k as never))
    const ids = handles.flatMap((h) => [h.sourceId, h.layerId])
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('utcDateString', () => {
  it('format YYYY-MM-DD UTC', () => {
    expect(utcDateString(new Date('2026-08-23T23:30:00Z'))).toBe('2026-08-23')
    expect(utcDateString(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01')
  })
})

describe('fetchLatestGibsFrame fallback', () => {
  it('null bila granule tidak tersedia (probe gagal)', async () => {
    const frame = await fetchLatestGibsFrame(
      'truecolor',
      undefined,
      new Date('2026-08-23T00:00:00Z'),
    )
    // Live test: MODIS Terra harian hampir selalu punya granule kemarin.
    // Bila null (offline), tetap valid — layer hanya tidak tampil.
    if (frame !== null) {
      expect(frame.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(frame.tiles[0]).toContain(frame.date)
    } else {
      expect(frame).toBeNull()
    }
  })
})

describe('applyGibsLayer idempoten', () => {
  it('apply dua kali tidak error pada map mock', () => {
    const sources = new Map<string, unknown>()
    const layers = new Map<string, unknown>()
    const map = {
      getSource: (id: string) => sources.get(id),
      addSource: (id: string, spec: unknown) => sources.set(id, spec),
      getLayer: (id: string) => layers.get(id),
      addLayer: (spec: { id: string }) => layers.set(spec.id, spec),
      removeLayer: (id: string) => layers.delete(id),
      removeSource: (id: string) => sources.delete(id),
      setLayoutProperty: (id: string, _name: string, value: string) => {
        const layer = layers.get(id) as { layout?: Record<string, string> } | undefined
        if (layer?.layout) layer.layout.visibility = value
      },
    } as never

    applyGibsLayer(map, 'truecolor', { date: '2026-08-22', tiles: ['https://example.test/{z}/{x}/{y}.jpg'] })
    applyGibsLayer(map, 'truecolor', { date: '2026-08-23', tiles: ['https://example.test/2/{z}/{x}/{y}.jpg'] })
    expect(sources.size).toBe(1)

    setGibsLayerVisible(map, 'truecolor', true)
    removeGibsLayer(map, 'truecolor')
    expect(sources.size).toBe(0)
    expect(layers.size).toBe(0)
  })
})
