import { describe, expect, it } from 'vitest'

import { cctvLayer, operatorColor } from './cctv'
import type { OperationalMapFeatureCollection } from '../types'

function collection(): OperationalMapFeatureCollection {
  return {
    type: 'FeatureCollection',
    layer: 'cctv',
    truncated: false,
    features: [
      {
        type: 'Feature',
        id: '479-1-105',
        geometry: { type: 'Point', coordinates: [106.877, -6.285] },
        properties: {
          id: '479-1-105', layer: 'cctv', label: 'JAGORAWI KM 04+500 | B',
          source: 'jm', attribution: 'BPJT · PT Jasa Marga',
          verification_status: 'official', toll_road: 'Jakarta-Bogor-Ciawi',
          km: 'JAGORAWI KM 04+500 | B', operator: 'PT Jasa Marga (Persero) Tbk',
          operator_code: 'jm', stream_url: 'https://jid.jasamarga.com/cctv2/abc?tx=1',
          is_online: true,
        },
      },
    ],
  }
}

function mockMap() {
  const sources = new Map<string, unknown>()
  const layers = new Map<string, { layout?: Record<string, string> }>()
  return {
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, spec: unknown) => sources.set(id, spec),
    getLayer: (id: string) => layers.get(id),
    addLayer: (spec: { id: string; layout?: Record<string, string> }) => layers.set(spec.id, spec),
    removeLayer: (id: string) => layers.delete(id),
    removeSource: (id: string) => sources.delete(id),
    setLayoutProperty: (id: string, _name: string, value: string) => {
      const layer = layers.get(id)
      if (layer) layer.layout = { ...layer.layout, visibility: value }
    },
  } as unknown as Parameters<typeof cctvLayer.apply>[0]
}

describe('cctvLayer (S12b)', () => {
  it('menerapkan source geojson + 3 layer (klaster, count, marker)', () => {
    const map = mockMap()
    cctvLayer.apply(map, collection())
    expect(map.getSource(cctvLayer.sourceId)).toBeTruthy()
    expect(cctvLayer.layerIds).toHaveLength(3)
    for (const id of cctvLayer.layerIds) {
      expect(map.getLayer(id)).toBeTruthy()
    }
  })

  it('setVisible mengubah visibility ketiga layer', () => {
    const map = mockMap()
    cctvLayer.apply(map, collection())
    cctvLayer.setVisible(map, true)
    for (const id of cctvLayer.layerIds) {
      const layer = map.getLayer(id) as { layout?: Record<string, string> }
      expect(layer?.layout?.visibility).toBe('visible')
    }
    cctvLayer.setVisible(map, false)
    for (const id of cctvLayer.layerIds) {
      const layer = map.getLayer(id) as { layout?: Record<string, string> }
      expect(layer?.layout?.visibility).toBe('none')
    }
  })

  it('apply dua kali tidak error (idempoten)', () => {
    const map = mockMap()
    cctvLayer.apply(map, collection())
    cctvLayer.apply(map, collection())
    expect(map.getSource(cctvLayer.sourceId)).toBeTruthy()
  })

  it('remove membersihkan source + layer', () => {
    const map = mockMap()
    cctvLayer.apply(map, collection())
    cctvLayer.remove(map)
    expect(map.getSource(cctvLayer.sourceId)).toBeUndefined()
    for (const id of cctvLayer.layerIds) {
      expect(map.getLayer(id)).toBeUndefined()
    }
  })
})

describe('operatorColor', () => {
  it('warna per operator utama + default slate', () => {
    expect(operatorColor('jm')).toBe('#6366f1')
    expect(operatorColor('hk')).toBe('#10b981')
    expect(operatorColor('unknown')).toBe('#94a3b8')
    expect(operatorColor(undefined)).toBe('#94a3b8')
  })
})
