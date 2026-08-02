import { describe, expect, it, vi } from 'vitest'
import { airQualityLayer } from './airQuality'
import { evacuationsLayer } from './evacuations'
import { eventsLayer } from './events'
import { officialAlertsLayer } from './officialAlerts'

const collection = (layer: 'events' | 'alerts' | 'air-quality' | 'evacuations') => ({
  type: 'FeatureCollection' as const,
  layer,
  truncated: false,
  features: [{
    type: 'Feature' as const,
    id: `${layer}:1`,
    geometry: { type: 'Point' as const, coordinates: [106.8, -6.2] },
    properties: {
      id: `${layer}:1`,
      layer,
      label: 'Jakarta',
      peril_type: 'earthquake',
      severity: 'high',
      source: 'bmkg',
      attribution: 'BMKG',
      verification_status: 'official',
      category: 'Sedang',
    },
  }],
})

function createMap() {
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>()
  const layers = new Set<string>()
  return {
    addImage: vi.fn(),
    addLayer: vi.fn((layer: { id: string }) => layers.add(layer.id)),
    addSource: vi.fn((id: string) => sources.set(id, { setData: vi.fn() })),
    getLayer: vi.fn((id: string) => layers.has(id) ? { id } : undefined),
    getSource: vi.fn((id: string) => sources.get(id)),
    hasImage: vi.fn(() => false),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    setStyle: vi.fn(),
  }
}

describe('public operational map layer adapters', () => {
  it('creates stable event clusters, updates their source data, and removes all artifacts', () => {
    const map = createMap()
    const data = collection('events')

    eventsLayer.apply(map as never, data)
    eventsLayer.apply(map as never, data)
    const source = map.getSource(eventsLayer.sourceId)
    eventsLayer.remove(map as never)

    expect(eventsLayer.sourceId).toBe('operational-map-events-source')
    expect(map.addSource).toHaveBeenCalledWith(eventsLayer.sourceId, expect.objectContaining({ cluster: true, data }))
    expect(source?.setData).toHaveBeenCalledWith(data)
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'operational-map-events-clusters' }))
    expect(map.removeLayer).toHaveBeenCalledWith('operational-map-events-points')
    expect(map.removeSource).toHaveBeenCalledWith(eventsLayer.sourceId)
  })

  it('renders official polygon and point fallback layers with stable IDs', () => {
    const map = createMap()

    officialAlertsLayer.apply(map as never, collection('alerts'))

    expect(officialAlertsLayer.layerIds).toEqual([
      'operational-map-official-alerts-fill',
      'operational-map-official-alerts-outline',
      'operational-map-official-alerts-points',
    ])
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'operational-map-official-alerts-fill', type: 'fill' }))
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'operational-map-official-alerts-points', type: 'circle' }))
  })

  it('uses category color for air quality and a fixed, local evacuation marker image', () => {
    const map = createMap()

    airQualityLayer.apply(map as never, collection('air-quality'))
    evacuationsLayer.apply(map as never, collection('evacuations'))

    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: 'operational-map-air-quality-points',
      paint: expect.objectContaining({ 'circle-color': expect.any(Array) }),
    }))
    expect(map.addImage).toHaveBeenCalledWith('operational-map-evacuations-icon', expect.anything())
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: 'operational-map-evacuations-points',
      layout: expect.objectContaining({ 'icon-image': 'operational-map-evacuations-icon' }),
    }))
  })
})
