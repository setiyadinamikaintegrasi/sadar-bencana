import { describe, expect, it, vi } from 'vitest'
import { airQualityLayer } from './airQuality'
import { evacuationsLayer } from './evacuations'
import { eventsLayer } from './events'
import { officialAlertsLayer } from './officialAlerts'
import { privateLayerAdapters } from './private'

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
    // Adapter menambahkan severity_rank sebelum setData (severity 'high' → 3).
    const enriched = {
      ...data,
      features: data.features.map((feature) => ({
        ...feature,
        properties: { ...feature.properties, severity_rank: 3 },
      })),
    }

    eventsLayer.apply(map as never, data)
    eventsLayer.apply(map as never, data)
    const source = map.getSource(eventsLayer.sourceId)
    eventsLayer.remove(map as never)

    expect(eventsLayer.sourceId).toBe('operational-map-events-source')
    expect(map.addSource).toHaveBeenCalledWith(eventsLayer.sourceId, expect.objectContaining({
      cluster: true,
      clusterProperties: expect.objectContaining({ severity_rank: expect.any(Array) }),
      data: enriched,
    }))
    expect(source?.setData).toHaveBeenCalledWith(enriched)
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'operational-map-events-clusters' }))
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'operational-map-events-pulse-critical', type: 'circle' }))
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'operational-map-events-pulse-high', type: 'circle' }))
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'operational-map-events-clusters-pulse', type: 'circle' }))
    expect(map.removeLayer).toHaveBeenCalledWith('operational-map-events-points')
    expect(map.removeSource).toHaveBeenCalledWith(eventsLayer.sourceId)
  })

  it('renders official polygon and point fallback layers with stable IDs', () => {
    const map = createMap()

    officialAlertsLayer.apply(map as never, collection('alerts'))

    expect(officialAlertsLayer.layerIds).toEqual([
      'operational-map-official-alerts-fill',
      'operational-map-official-alerts-outline',
      'operational-map-official-alerts-outline-extreme',
      'operational-map-official-alerts-points-pulse',
      'operational-map-official-alerts-points',
    ])
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'operational-map-official-alerts-fill', type: 'fill' }))
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'operational-map-official-alerts-outline-extreme', type: 'line' }))
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

describe('private operational map layer adapters', () => {
  it('uses distinct subdued styles and removes every private artifact', () => {
    const map = createMap()
    const watchZones = privateLayerAdapters['watch-zones']
    const personalAssets = privateLayerAdapters['personal-assets']
    const privateCollection = (layer: 'watch-zones' | 'personal-assets') => ({
      ...collection('events'),
      layer,
      features: collection('events').features.map((feature) => ({
        ...feature,
        properties: { ...feature.properties, layer },
      })),
    })

    watchZones.apply(map as never, privateCollection('watch-zones') as never)
    personalAssets.apply(map as never, privateCollection('personal-assets') as never)

    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: 'operational-map-private-watch-zones-outline',
      type: 'line',
      paint: expect.objectContaining({ 'line-dasharray': [3, 2] }),
    }))
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: 'operational-map-private-personal-assets-points',
      type: 'circle',
      paint: expect.objectContaining({ 'circle-color': '#0f766e' }),
    }))

    watchZones.remove(map as never)
    personalAssets.remove(map as never)
    expect(map.removeSource).toHaveBeenCalledWith(watchZones.sourceId)
    expect(map.removeSource).toHaveBeenCalledWith(personalAssets.sourceId)
  })
})
