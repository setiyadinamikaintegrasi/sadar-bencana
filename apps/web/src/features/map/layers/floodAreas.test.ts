import { describe, expect, it, vi } from 'vitest'
import { floodAreasLayer } from './floodAreas'
import type { OperationalMapFeatureCollection } from '../types'

function createMap() {
  const sources = new Map<string, unknown>()
  const layers = new Map<string, { type: string; paint?: Record<string, unknown> }>()
  return {
    sources, layers,
    getSource: (id: string) => sources.get(id),
    addSource: vi.fn((id: string, src: unknown) => sources.set(id, src)),
    addLayer: vi.fn((layer: { id: string; type: string; paint?: Record<string, unknown> }) =>
      layers.set(layer.id, { type: layer.type, paint: layer.paint })),
    getLayer: (id: string) => layers.get(id),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    setLayoutProperty: vi.fn(),
  }
}

function collection(): OperationalMapFeatureCollection {
  return {
    type: 'FeatureCollection',
    layer: 'flood-areas',
    truncated: false,
    features: [{
      type: 'Feature',
      id: 'flood-area:1',
      geometry: { type: 'Polygon', coordinates: [[[106.9, -6.29], [106.91, -6.29], [106.91, -6.28], [106.9, -6.29]]] },
      properties: {
        id: 'flood-area:1', layer: 'flood-areas', label: 'Genangan RT 013',
        source: 'petabencana', attribution: 'PetaBencana.id / BPBD', verification_status: 'official',
        peril_type: 'flood', location_type: 'state-2',
      },
    }] as never[],
  }
}

describe('floodAreasLayer', () => {
  it('renders state-colored fill + outline polygons and is idempotent', () => {
    const map = createMap()
    floodAreasLayer.apply(map as never, collection())
    floodAreasLayer.apply(map as never, collection())

    expect(map.sources.size).toBe(2) // poligon + titik centroid; idempoten via setData
    expect(map.layers.get('operational-map-flood-areas-fill')!.type).toBe('fill')
    expect(map.layers.get('operational-map-flood-areas-outline')!.type).toBe('line')
    // Marker centroid: terlihat di semua zoom (sub-piksel poligon di z rendah).
    expect(map.layers.get('operational-map-flood-areas-marker')!.type).toBe('circle')
    const markerPaint = map.layers.get('operational-map-flood-areas-marker')!.paint as Record<string, unknown>
    expect(markerPaint['circle-radius']).toBe(7)
    // Warna match mencakup 4 state + fallback biru.
    const paint = map.layers.get('operational-map-flood-areas-fill')!.paint as Record<string, unknown>
    const color = paint['fill-color'] as unknown[]
    expect(color).toContain('state-1')
    expect(color).toContain('#c026d3') // state-4 magenta
  })

  it('setVisible toggles both layers and remove cleans everything', () => {
    const map = createMap()
    floodAreasLayer.apply(map as never, collection())
    floodAreasLayer.setVisible(map as never, false)
    expect(map.setLayoutProperty).toHaveBeenCalledWith('operational-map-flood-areas-fill', 'visibility', 'none')
    floodAreasLayer.remove(map as never)
    expect(map.sources.size).toBe(0)
    expect(map.layers.size).toBe(0)
  })
})
