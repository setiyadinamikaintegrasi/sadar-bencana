import { describe, expect, it, vi } from 'vitest'
import { airQualityLayer } from './airQuality'
import { evacuationsLayer } from './evacuations'
import { eventsLayer, rebuildClusterBadges, setEventsHeatmapVisible } from './events'
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
  const idleHandlers = new Set<() => void>()
  return {
    addImage: vi.fn(),
    addLayer: vi.fn((layer: { id: string }) => layers.add(layer.id)),
    addSource: vi.fn((id: string) => sources.set(id, { setData: vi.fn() })),
    getLayer: vi.fn((id: string) => layers.has(id) ? { id } : undefined),
    getSource: vi.fn((id: string) => sources.get(id)),
    hasImage: vi.fn(() => false),
    once: vi.fn((_event: string, handler: () => void) => idleHandlers.add(handler)),
    triggerIdle: () => idleHandlers.forEach((handler) => handler()),
    project: vi.fn(() => ({ x: 500, y: 300 })),
    unproject: vi.fn(([x, y]: [number, number]) => ({ lng: x, lat: y })),
    queryRenderedFeatures: vi.fn(() => []),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    setEventsHeatmapVisibleLayout: undefined,
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
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
    // Badge ikut disembunyikan saat mode heatmap aktif — cek SEBELUM remove
    // (remove menghapus layer dari index mock).
    const heatVisible: string[] = []
    const originalSetLayout = map.setLayoutProperty
    ;(map as unknown as Record<string, unknown>).setLayoutProperty = (id: string, key: string, value: string) => {
      if (key === 'visibility') heatVisible.push(`${id}=${value}`)
      originalSetLayout(id as never, key as never, value as never)
    }
    setEventsHeatmapVisible(map as never, true)
    ;(map as unknown as Record<string, unknown>).setLayoutProperty = originalSetLayout
    expect(heatVisible).toContain('operational-map-events-composition-earthquake=none')
    expect(heatVisible).toContain('operational-map-events-clusters=none')
    eventsLayer.remove(map as never)
    expect(map.removeLayer).toHaveBeenCalledWith('operational-map-events-composition-earthquake')
    expect(map.removeLayer).toHaveBeenCalledWith('operational-map-events-points')
    expect(map.removeSource).toHaveBeenCalledWith(eventsLayer.sourceId)

    expect(eventsLayer.sourceId).toBe('operational-map-events-source')
    expect(map.addSource).toHaveBeenCalledWith(eventsLayer.sourceId, expect.objectContaining({
      cluster: true,
      clusterProperties: expect.objectContaining({
        severity_rank: expect.any(Array),
        // P12: agregat jumlah per jenis bencana untuk badge komposisi klaster.
        n_earthquake: expect.any(Array),
        n_wildfire: expect.any(Array),
        n_flood: expect.any(Array),
        n_volcano: expect.any(Array),
        n_wind: expect.any(Array),
      }),
      data: enriched,
    }))
    expect(source?.setData).toHaveBeenCalledWith(enriched)
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'operational-map-events-clusters' }))
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'operational-map-events-pulse-critical', type: 'circle' }))
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'operational-map-events-pulse-high', type: 'circle' }))
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'operational-map-events-clusters-pulse', type: 'circle' }))
    // Angka klaster wajib text-font eksplisit "Noto Sans Bold": default
    // MapLibre tidak tersedia di server glyph OpenFreeMap -> 404 (P11).
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: 'operational-map-events-cluster-count',
      type: 'symbol',
      layout: expect.objectContaining({ 'text-font': ['Noto Sans Bold'] }),
    }))
    // P12: badge komposisi — source badge tersendiri + satu layer circle per
    // jenis bencana (tanpa translate; posisi digeser saat build titik badge).
    expect(map.addSource).toHaveBeenCalledWith('operational-map-events-badges-source', expect.objectContaining({ type: 'geojson' }))
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: 'operational-map-events-composition-earthquake',
      type: 'circle',
      filter: ['==', ['get', 'kind'], 'earthquake'],
    }))
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: 'operational-map-events-composition-wildfire',
      type: 'circle',
      filter: ['==', ['get', 'kind'], 'wildfire'],
    }))
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

describe('rebuildClusterBadges', () => {
  it('builds per-kind badge points from rendered clusters shifted 20px below', async () => {
    const map = createMap()
    const badgeSetData = vi.fn()
    const leaves = [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { peril_type: 'wildfire' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { peril_type: 'wildfire' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { peril_type: 'tsunami' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { peril_type: 'earthquake' } },
    ]
    const leavesFn = vi.fn(async () => leaves)
    map.getSource = vi.fn((id: string) => {
      if (id === 'operational-map-events-badges-source') return { setData: badgeSetData }
      if (id === eventsLayer.sourceId) return { setData: vi.fn(), getClusterLeaves: leavesFn }
      return undefined
    }) as never
    map.queryRenderedFeatures = vi.fn(() => ([
      { type: 'Feature', geometry: { type: 'Point', coordinates: [113, -2] }, properties: { cluster: true, cluster_id: 7, point_count: 4 } },
    ])) as never

    eventsLayer.apply(map as never, collection('events'))
    map.triggerIdle()
    await new Promise((resolve) => { setTimeout(resolve, 50) })

    expect(map.queryRenderedFeatures).toHaveBeenCalledWith({ layers: ['operational-map-events-clusters'] })
    expect(leavesFn).toHaveBeenCalledWith(7, Infinity)
    expect(badgeSetData).toHaveBeenCalledTimes(1)
    const payload = badgeSetData.mock.calls[0][0] as { features: Array<{ properties: { kind: string; count: number }; geometry: { coordinates: [number, number] } }> }
    // Tsunami dipetakan ke banjir; earthquake & wildfire masing-masing satu dot.
    const kinds = payload.features.map((f) => `${f.properties.kind}:${f.properties.count}`).sort()
    expect(kinds).toEqual(['earthquake:1', 'flood:1', 'wildfire:2'])
    // Slot tetap per jenis (earthquake=0, wildfire=1, flood=2 dari 5 slot,
    // center=2): x = 500 + (slot-2)*12 → 476/488/500; y = 300+20.
    const xs = payload.features.map((f) => f.geometry.coordinates[0]).sort((a, b) => a - b)
    expect(xs).toEqual([476, 488, 500])
    expect(payload.features.every((f) => f.geometry.coordinates[1] === 320)).toBe(true)
  })

  it('is a no-op when the badge source is not installed', () => {
    const map = {
      getSource: vi.fn(() => undefined),
      queryRenderedFeatures: vi.fn(),
    }
    expect(() => rebuildClusterBadges(map as never)).not.toThrow()
    expect(map.queryRenderedFeatures).not.toHaveBeenCalled()
  })
})
