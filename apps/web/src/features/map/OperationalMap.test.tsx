import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MapDetailSheet } from './MapDetailSheet'
import { MapLegend } from './MapLegend'
import OperationalMap from './OperationalMap'

type MapEvent = {
  error?: Error
  geolocateSource?: boolean
  lngLat?: { lat: number; lng: number }
  features?: Array<{
    id?: string | number
    geometry: GeoJSON.Geometry
    properties: Record<string, unknown>
  }>
}
type Listener = (event?: MapEvent) => void
type MapLibreTestInstance = {
  options: Record<string, unknown>
  addControl: ReturnType<typeof vi.fn>
  addImage: ReturnType<typeof vi.fn>
  addLayer: ReturnType<typeof vi.fn>
  addSource: ReturnType<typeof vi.fn>
  easeTo: ReturnType<typeof vi.fn>
  fitBounds: ReturnType<typeof vi.fn>
  getBounds: ReturnType<typeof vi.fn>
  getCenter: ReturnType<typeof vi.fn>
  getLayer: ReturnType<typeof vi.fn>
  getSource: ReturnType<typeof vi.fn>
  getZoom: ReturnType<typeof vi.fn>
  getStyle: ReturnType<typeof vi.fn>
  hasImage: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  removeLayer: ReturnType<typeof vi.fn>
  removeSource: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  trigger: (event: string, data?: MapEvent) => void
}

const resizeObservers: TestResizeObserver[] = []

class TestResizeObserver {
  readonly disconnect = vi.fn()
  readonly observe = vi.fn()

  constructor(readonly callback: ResizeObserverCallback) {
    resizeObservers.push(this)
  }

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver)
  }
}

const maplibre = vi.hoisted(() => {
  const instances: MapLibreTestInstance[] = []
  const Map = vi.fn(function MapLibreMap(options: Record<string, unknown>) {
    const listeners = new globalThis.Map<string, Set<Listener>>()
    const sources = new globalThis.Map<string, {
      getClusterExpansionZoom: ReturnType<typeof vi.fn>
      setData: ReturnType<typeof vi.fn>
    }>()
    const layers = new Set<string>()
    const canvas = document.createElement('canvas')
    canvas.className = 'maplibregl-canvas'
    const container = options.container as HTMLElement
    container.append(canvas)
    let removed = false
    const assertLive = () => {
      if (removed) throw new Error('MapLibre map was used after removal')
    }
    const instance = {
      options,
      addControl: vi.fn(),
      addImage: vi.fn(),
      addLayer: vi.fn((layer: { id: string }) => layers.add(layer.id)),
      addSource: vi.fn((id: string) => sources.set(id, {
        getClusterExpansionZoom: vi.fn().mockResolvedValue(12),
        setData: vi.fn(),
      })),
      easeTo: vi.fn(),
      fitBounds: vi.fn(),
      getBounds: vi.fn(() => ({ getWest: () => 106.7, getSouth: () => -6.4, getEast: () => 107.1, getNorth: () => -6 })),
      getCenter: vi.fn(() => {
        assertLive()
        return { lng: 118, lat: -2.5 }
      }),
      getLayer: vi.fn((id: string) => layers.has(id) ? { id } : undefined),
      getSource: vi.fn((id: string) => sources.get(id)),
      setLayoutProperty: vi.fn(),
      getZoom: vi.fn(() => {
        assertLive()
        return 5
      }),
      getPitch: vi.fn(() => 0),
      getBearing: vi.fn(() => 0),
      getStyle: vi.fn(() => {
        assertLive()
        return { layers: [], sources: {} }
      }),
      hasImage: vi.fn(() => false),
      off: vi.fn((event: string, layerOrListener: string | Listener, possibleListener?: Listener) => {
        assertLive()
        const listener = possibleListener ?? layerOrListener
        if (typeof listener === 'function') listeners.get(event)?.delete(listener)
      }),
      on: vi.fn((event: string, layerOrListener: string | Listener, possibleListener?: Listener) => {
        const listener = possibleListener ?? layerOrListener
        if (typeof listener !== 'function') return
        const eventListeners = listeners.get(event) ?? new Set<Listener>()
        eventListeners.add(listener)
        listeners.set(event, eventListeners)
      }),
      once: vi.fn((event: string, listener: Listener) => {
        const onceListener: Listener = (data) => {
          listeners.get(event)?.delete(onceListener)
          listener(data)
        }
        const eventListeners = listeners.get(event) ?? new Set<Listener>()
        eventListeners.add(onceListener)
        listeners.set(event, eventListeners)
      }),
      remove: vi.fn(() => {
        assertLive()
        removed = true
        canvas.remove()
      }),
      removeLayer: vi.fn((id: string) => {
        assertLive()
        layers.delete(id)
      }),
      removeSource: vi.fn((id: string) => {
        assertLive()
        sources.delete(id)
      }),
      resize: vi.fn(() => assertLive()),
      trigger: (event: string, data?: MapEvent) => listeners.get(event)?.forEach((listener) => listener(data)),
    }
    instances.push(instance)
    return instance
  })

  return {
    instances,
    Map,
    NavigationControl: vi.fn(),
    GeolocateControl: vi.fn(),
    ScaleControl: vi.fn(),
    FullscreenControl: vi.fn(),
  }
})

vi.mock('maplibre-gl', () => ({ default: maplibre }))

const privateApi = vi.hoisted(() => ({ fetchPrivateMapLayer: vi.fn() }))

vi.mock('./mapApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('./mapApi')>()
  return { ...original, fetchPrivateMapLayer: privateApi.fetchPrivateMapLayer }
})

// Radar cuaca diuji terpisah; di sini frame dimock agar tidak ada fetch
// network dan jumlah pemanggilan fetch publik tetap deterministik.
const radarApi = vi.hoisted(() => ({ fetchLatestWeatherRadarFrame: vi.fn() }))
vi.mock('./layers/weatherRadar', async (importOriginal) => {
  const original = await importOriginal<typeof import('./layers/weatherRadar')>()
  return {
    ...original,
    fetchLatestWeatherRadarFrame: radarApi.fetchLatestWeatherRadarFrame,
  }
})

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  privateApi.fetchPrivateMapLayer.mockReset()
  radarApi.fetchLatestWeatherRadarFrame.mockReset()
  radarApi.fetchLatestWeatherRadarFrame.mockResolvedValue({
    time: 1787000000,
    tiles: ['https://fixture.rainviewer.example/256/{z}/{x}/{y}/2/1_1.png'],
    nowcast: false,
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resizeObservers.splice(0)
  maplibre.instances.splice(0)
  maplibre.Map.mockClear()
  maplibre.NavigationControl.mockClear()
  maplibre.GeolocateControl.mockClear()
  window.history.replaceState({}, '', '/')
})

describe('OperationalMap', () => {
  it('creates one viewer map from the URL camera and removes it on unmount', () => {
    window.history.replaceState({}, '', '/?mapLng=106.8456&mapLat=-6.2088&mapZoom=9')

    const { unmount } = render(<OperationalMap />)

    expect(maplibre.Map).toHaveBeenCalledTimes(1)
    expect(maplibre.Map).toHaveBeenCalledWith(expect.objectContaining({
      center: [106.8456, -6.2088],
      zoom: 9,
    }))
    // Viewer menambahkan Navigation, Geolocate, Scale, dan Fullscreen control.
    expect(maplibre.instances[0].addControl).toHaveBeenCalledTimes(4)

    unmount()

    expect(maplibre.instances[0].remove).toHaveBeenCalledTimes(1)
  })

  it('excludes viewer controls in picker mode', () => {
    render(<OperationalMap mode="picker" />)

    expect(maplibre.instances[0].addControl).not.toHaveBeenCalled()
  })

  it('does not request or expose private layers without an authenticated session', async () => {
    render(<OperationalMap authenticated={false} privateOwnerKey={undefined} privateLayers={['watch-zones', 'personal-assets']} />)

    await act(async () => {
      maplibre.instances[0].trigger('load')
      await Promise.resolve()
    })

    expect(privateApi.fetchPrivateMapLayer).not.toHaveBeenCalled()
    expect(screen.queryByRole('checkbox', { name: /watch zone|aset pribadi/i })).toBeNull()
  })

  it('removes private sources, click handlers, and selection immediately on logout', async () => {
    privateApi.fetchPrivateMapLayer.mockImplementation((layer: 'watch-zones' | 'personal-assets') => Promise.resolve({
      layer,
      state: 'ready',
      collection: {
        type: 'FeatureCollection',
        layer,
        truncated: false,
        features: [{
          type: 'Feature',
          id: `${layer}:1`,
          geometry: { type: 'Point', coordinates: [106.8, -6.2] },
          properties: {
            id: `${layer}:1`,
            layer,
            label: layer === 'watch-zones' ? 'Zona rumah' : 'Gudang pribadi',
            source: 'account',
            attribution: 'Private account data',
            verification_status: 'user-provided',
          },
        }],
      },
    }))
    const { rerender } = render(
      <OperationalMap authenticated privateOwnerKey="user-a" privateLayers={['watch-zones', 'personal-assets']} initialLayers={[]} />,
    )
    const map = maplibre.instances[0]

    await act(async () => {
      map.trigger('load')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(privateApi.fetchPrivateMapLayer).toHaveBeenCalledTimes(2)
    expect(map.addSource).toHaveBeenCalledWith('operational-map-private-watch-zones-source', expect.anything())
    expect(map.addSource).toHaveBeenCalledWith('operational-map-private-personal-assets-source', expect.anything())

    act(() => map.trigger('click', {
      features: [{
        id: 'watch-zones:1',
        geometry: { type: 'Point', coordinates: [106.8, -6.2] },
        properties: {
          id: 'watch-zones:1', layer: 'watch-zones', label: 'Zona rumah', source: 'account', attribution: 'Private account data', verification_status: 'user-provided',
        },
      }],
    }))
    expect(screen.getByRole('heading', { name: 'Zona rumah' })).toBeTruthy()

    rerender(<OperationalMap authenticated={false} privateOwnerKey={undefined} privateLayers={['watch-zones', 'personal-assets']} initialLayers={[]} />)

    expect(screen.queryByRole('heading', { name: 'Zona rumah' })).toBeNull()
    expect(map.removeSource).toHaveBeenCalledWith('operational-map-private-watch-zones-source')
    expect(map.removeSource).toHaveBeenCalledWith('operational-map-private-personal-assets-source')
    expect(map.off).toHaveBeenCalledWith('click', 'operational-map-private-watch-zones-outline', expect.any(Function))
    expect(map.off).toHaveBeenCalledWith('click', 'operational-map-private-personal-assets-points', expect.any(Function))
  })

  it('clears owner A artifacts and aborts its requests before loading owner B', async () => {
    const pending: Array<{ signal?: AbortSignal; resolve: (value: unknown) => void }> = []
    privateApi.fetchPrivateMapLayer.mockImplementation((layer: 'watch-zones' | 'personal-assets', _viewport: unknown, signal?: AbortSignal) => {
      if (privateApi.fetchPrivateMapLayer.mock.calls.length <= 2) return Promise.resolve({
        layer,
        state: 'ready',
        collection: {
          type: 'FeatureCollection', layer, truncated: false,
          features: layer === 'watch-zones' ? [{
            type: 'Feature', id: 'zone-a', geometry: { type: 'Point', coordinates: [106.8, -6.2] },
            properties: { id: 'zone-a', layer, label: 'Zona milik A', source: 'account', attribution: 'Private account data', verification_status: 'user-provided' },
          }] : [],
        },
      })
      return new Promise((resolve) => pending.push({ signal, resolve }))
    })
    const { rerender } = render(
      <OperationalMap authenticated privateOwnerKey="user-a" privateLayers={['watch-zones', 'personal-assets']} initialLayers={[]} />,
    )
    const map = maplibre.instances[0]
    await act(async () => {
      map.trigger('load')
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => map.trigger('click', { features: [{
      id: 'zone-a', geometry: { type: 'Point', coordinates: [106.8, -6.2] },
      properties: { id: 'zone-a', layer: 'watch-zones', label: 'Zona milik A', source: 'account', attribution: 'Private account data', verification_status: 'user-provided' },
    }] }))
    expect(screen.getByRole('heading', { name: 'Zona milik A' })).toBeTruthy()

    act(() => map.trigger('moveend'))
    expect(pending).toHaveLength(2)
    rerender(<OperationalMap authenticated privateOwnerKey="user-b" privateLayers={['watch-zones', 'personal-assets']} initialLayers={[]} />)

    expect(pending.slice(0, 2).every((request) => request.signal?.aborted)).toBe(true)
    expect(screen.queryByRole('heading', { name: 'Zona milik A' })).toBeNull()
    expect(map.removeSource).toHaveBeenCalledWith('operational-map-private-watch-zones-source')
    expect(privateApi.fetchPrivateMapLayer).toHaveBeenCalledTimes(6)
  })

  it('closes private selection after a successful refresh removes it', async () => {
    let refresh = false
    privateApi.fetchPrivateMapLayer.mockImplementation((layer: 'watch-zones' | 'personal-assets') => Promise.resolve({
      layer,
      state: refresh ? 'empty' : 'ready',
      collection: {
        type: 'FeatureCollection', layer, truncated: false,
        features: !refresh && layer === 'watch-zones' ? [{
          type: 'Feature', id: 'zone-1', geometry: { type: 'Point', coordinates: [106.8, -6.2] },
          properties: { id: 'zone-1', layer, label: 'Zona lama', source: 'account', attribution: 'Private account data', verification_status: 'user-provided' },
        }] : [],
      },
    }))
    render(<OperationalMap authenticated privateOwnerKey="user-a" privateLayers={['watch-zones']} initialLayers={[]} />)
    const map = maplibre.instances[0]
    await act(async () => {
      map.trigger('load')
      await Promise.resolve()
    })
    act(() => map.trigger('click', { features: [{
      id: 'zone-1', geometry: { type: 'Point', coordinates: [106.8, -6.2] },
      properties: { id: 'zone-1', layer: 'watch-zones', label: 'Zona lama', source: 'account', attribution: 'Private account data', verification_status: 'user-provided' },
    }] }))
    expect(screen.getByRole('heading', { name: 'Zona lama' })).toBeTruthy()

    refresh = true
    await act(async () => {
      map.trigger('moveend')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.queryByRole('heading', { name: 'Zona lama' })).toBeNull()
  })

  it('updates private selection from a successful replacement refresh', async () => {
    let label = 'Zona lama'
    privateApi.fetchPrivateMapLayer.mockImplementation((layer: 'watch-zones' | 'personal-assets') => Promise.resolve({
      layer,
      state: 'ready',
      collection: {
        type: 'FeatureCollection', layer, truncated: false,
        features: [{
          type: 'Feature', id: 'zone-1', geometry: { type: 'Point', coordinates: [106.8, -6.2] },
          properties: { id: 'zone-1', layer, label, source: 'account', attribution: 'Private account data', verification_status: 'user-provided' },
        }],
      },
    }))
    render(<OperationalMap authenticated privateOwnerKey="user-a" privateLayers={['watch-zones']} initialLayers={[]} />)
    const map = maplibre.instances[0]
    await act(async () => {
      map.trigger('load')
      await Promise.resolve()
    })
    act(() => map.trigger('click', { features: [{
      id: 'zone-1', geometry: { type: 'Point', coordinates: [106.8, -6.2] },
      properties: { id: 'zone-1', layer: 'watch-zones', label, source: 'account', attribution: 'Private account data', verification_status: 'user-provided' },
    }] }))

    label = 'Zona diperbarui'
    await act(async () => {
      map.trigger('moveend')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByRole('heading', { name: 'Zona diperbarui' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Zona lama' })).toBeNull()
  })

  it('keeps picker clicks and camera changes out of URL state', () => {
    window.history.replaceState({}, '', '/?section=watch-zone')
    const onPick = vi.fn()
    render(<OperationalMap mode="picker" initialLayers={[]} onPick={onPick} />)
    const map = maplibre.instances[0]

    act(() => map.trigger('click', { lngLat: { lat: -6.2, lng: 106.8 } }))
    act(() => map.trigger('moveend'))

    expect(onPick).toHaveBeenCalledWith(-6.2, 106.8)
    expect(window.location.search).toBe('?section=watch-zone')
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('renders and removes transient local geometry without serializing it', async () => {
    window.history.replaceState({}, '', '/?section=evacuation')
    const localOverlay: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [106.8, -6.2] },
        properties: { kind: 'user-position' },
      }],
    }
    const { unmount } = render(<OperationalMap mode="picker" initialLayers={[]} localOverlay={localOverlay} />)
    const map = maplibre.instances[0]

    await act(async () => {
      map.trigger('load')
      await Promise.resolve()
    })

    expect(map.addSource).toHaveBeenCalledWith('operational-map-private-local-source', expect.objectContaining({ data: localOverlay }))
    expect(window.location.search).toBe('?section=evacuation')
    unmount()
    expect(map.removeSource).toHaveBeenCalledWith('operational-map-private-local-source')
  })

  it('does not serialize a private programmatic focus movement in viewer mode', async () => {
    window.history.replaceState({}, '', '/?section=evacuation')
    render(<OperationalMap initialLayers={[]} focusCenter={[106.8, -6.2]} />)
    const map = maplibre.instances[0]
    map.getCenter = vi.fn(() => ({ lng: 106.8, lat: -6.2 }))
    map.getZoom = vi.fn(() => 8)

    await act(async () => {
      map.trigger('load')
      await Promise.resolve()
    })
    expect(map.easeTo).toHaveBeenCalledWith({ center: [106.8, -6.2], zoom: 8 })

    act(() => map.trigger('moveend'))
    expect(window.location.search).toBe('?section=evacuation')
  })

  it('synchronizes camera changes without replacing unrelated URL parameters', () => {
    window.history.replaceState({}, '', '/?section=dashboard&mapLayers=events')
    const replaceState = vi.spyOn(window.history, 'replaceState')
    const { unmount } = render(<OperationalMap />)
    const map = maplibre.instances[0]

    map.getCenter = vi.fn(() => ({ lng: 106.8, lat: -6.2 }))
    map.getZoom = vi.fn(() => 8)
    act(() => map.trigger('moveend'))

    expect(window.location.search).toBe('?section=dashboard&mapLayers=events&mapLng=106.8&mapLat=-6.2&mapZoom=8')
    expect(replaceState).toHaveBeenCalled()
    unmount()
    replaceState.mockRestore()
  })

  it('does not serialize a MapLibre geolocation-sourced camera movement', () => {
    window.history.replaceState({}, '', '/?section=dashboard&mapLayers=events')
    render(<OperationalMap />)
    const map = maplibre.instances[0]
    map.getCenter = vi.fn(() => ({ lng: 106.812345, lat: -6.212345 }))
    map.getZoom = vi.fn(() => 16)

    act(() => map.trigger('moveend', { geolocateSource: true }))

    expect(window.location.search).toBe('?section=dashboard&mapLayers=events')

    act(() => map.trigger('moveend'))

    expect(window.location.search).toBe('?section=dashboard&mapLayers=events&mapLng=106.812345&mapLat=-6.212345&mapZoom=16')
  })

  it('aborts a geolocation-superseded request, keeps coordinates out of the URL, and schedules the replacement viewport load', async () => {
    vi.useFakeTimers()
    window.history.replaceState({}, '', '/?section=dashboard&mapLayers=events')
    const requests: Array<{ signal: AbortSignal | undefined }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise<Response>(() => {
      requests.push({ signal: init?.signal ?? undefined })
    }))
    render(<OperationalMap />)
    const map = maplibre.instances[0]
    await act(async () => {
      map.trigger('load')
      await Promise.resolve()
    })
    expect(requests).toHaveLength(1)

    map.getCenter = vi.fn(() => ({ lng: 106.812345, lat: -6.212345 }))
    map.getZoom = vi.fn(() => 16)
    act(() => map.trigger('moveend', { geolocateSource: true }))

    expect(requests[0].signal?.aborted).toBe(true)
    expect(window.location.search).toBe('?section=dashboard&mapLayers=events')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(requests).toHaveLength(2)
  })

  it('shows an accessible fallback when MapLibre cannot construct a map', () => {
    maplibre.Map.mockImplementationOnce(function MapConstructionFailure() {
      throw new Error('WebGL unavailable')
    })

    render(<OperationalMap />)

    expect(screen.getByRole('alert').textContent).toContain('Peta tidak tersedia')
  })

  it('keeps a loaded map canvas after a recoverable source error', () => {
    const { container } = render(<OperationalMap />)
    const map = maplibre.instances[0]
    const canvas = container.querySelector('.operational-map__canvas canvas.maplibregl-canvas')

    act(() => map.trigger('load'))
    act(() => map.trigger('error', { error: new Error('Failed to load source tile') }))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(container.querySelector('.operational-map__canvas canvas.maplibregl-canvas')).toBe(canvas)
    expect(map.remove).not.toHaveBeenCalled()
  })

  it('tears down a map once after WebGL context loss before unmounting and disconnects its observer', () => {
    const { unmount } = render(<OperationalMap />)
    const map = maplibre.instances[0]
    const observer = resizeObservers[0]

    act(() => map.trigger('webglcontextlost'))

    expect(screen.getByRole('alert').textContent).toContain('Peta tidak tersedia')
    expect(map.remove).toHaveBeenCalledTimes(1)
    expect(observer.disconnect).toHaveBeenCalledTimes(1)

    expect(() => unmount()).not.toThrow()
    expect(map.remove).toHaveBeenCalledTimes(1)
    expect(observer.disconnect).toHaveBeenCalledTimes(1)

    expect(() => observer.trigger()).not.toThrow()
    expect(map.resize).not.toHaveBeenCalled()
  })

  it('loads enabled public layers in parallel and opens typed feature details from map clicks', async () => {
    const responseFor = (url: string) => {
      const wireLayer = url.includes('/alerts') ? 'alerts' : url.includes('/air-quality')
        ? 'air-quality' : url.includes('/evacuations') ? 'evacuations'
        : url.includes('/aircraft') ? 'aircraft' : 'events'
      return new Response(JSON.stringify({
        type: 'FeatureCollection',
        layer: wireLayer,
        truncated: false,
        features: [{
          type: 'Feature',
          id: `${wireLayer}:1`,
          geometry: { type: 'Point', coordinates: [106.8, -6.2] },
          properties: {
            id: `${wireLayer}:1`,
            layer: wireLayer,
            label: 'Jakarta',
            source: 'bmkg',
            attribution: 'BMKG',
            verification_status: 'official',
          },
        }],
      }), { status: 200 })
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => Promise.resolve(responseFor(String(url))))

    render(<OperationalMap />)
    const map = maplibre.instances[0]
    fetchMock.mockClear()

    await act(async () => {
      map.trigger('load')
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(map.addSource).toHaveBeenCalledWith('operational-map-events-source', expect.anything())
    expect(map.addSource).toHaveBeenCalledWith('operational-map-official-alerts-source', expect.anything())
    expect(map.addSource).toHaveBeenCalledWith('operational-map-air-quality-source', expect.anything())
    expect(map.addSource).toHaveBeenCalledWith('operational-map-evacuations-source', expect.anything())

    await act(async () => {
      map.trigger('click', {
        features: [{
          id: 'air-quality:1',
          geometry: { type: 'Point', coordinates: [106.8, -6.2] },
          properties: {
            id: 'air-quality:1',
            layer: 'air-quality',
            label: 'Stasiun Jakarta',
            source: 'bmkg',
            attribution: 'BMKG',
            verification_status: 'official',
            category: 'Sedang',
          },
        }],
      })
    })

    expect(screen.getByRole('heading', { name: 'Stasiun Jakarta' })).toBeTruthy()
    expect(screen.queryByText('FeatureCollection')).toBeNull()

    await act(async () => {
      map.trigger('click', {
        features: [{
          id: 'events:1',
          geometry: { type: 'Point', coordinates: [106.8, -6.2] },
          properties: {
            id: 'events:1', layer: 'events', label: 'Gempa Jakarta', source: 'bmkg', attribution: 'BMKG', verification_status: 'source-reported',
          },
        }],
      })
    })
    expect(screen.getByRole('heading', { name: 'Gempa Jakarta' })).toBeTruthy()

    await act(async () => {
      map.trigger('click', {
        features: [{
          id: 'alerts:1',
          geometry: { type: 'Point', coordinates: [106.8, -6.2] },
          properties: {
            id: 'alerts:1', layer: 'alerts', label: 'Peringatan Jakarta', source: 'bmkg', attribution: 'BMKG', verification_status: 'official',
          },
        }],
      })
    })
    expect(screen.getByRole('heading', { name: 'Peringatan Jakarta' })).toBeTruthy()
  })

  it('uses a controlled public collection without fetching and replaces its rendered data', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const collection = {
      type: 'FeatureCollection' as const,
      layer: 'evacuations' as const,
      truncated: false,
      features: [{
        type: 'Feature' as const,
        id: 'evacuation-1',
        geometry: { type: 'Point' as const, coordinates: [106.8, -6.2] },
        properties: {
          id: 'evacuation-1', layer: 'evacuations' as const, label: 'Shelter Jakarta', source: 'manual', attribution: 'SadarBencana', verification_status: 'operator-managed',
        },
      }],
    }
    const { rerender } = render(
      <OperationalMap
        initialLayers={['evacuations']}
        visibleLayers={['evacuations']}
        controlledCollections={{ evacuations: collection }}
      />,
    )
    const map = maplibre.instances[0]
    fetchMock.mockClear()

    await act(async () => {
      map.trigger('load')
      await Promise.resolve()
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(map.addSource).toHaveBeenCalledWith(
      'operational-map-evacuations-source',
      expect.objectContaining({ data: collection }),
    )

    const emptyCollection = { ...collection, features: [] }
    rerender(
      <OperationalMap
        initialLayers={['evacuations']}
        visibleLayers={['evacuations']}
        controlledCollections={{ evacuations: emptyCollection }}
      />,
    )
    const source = (map.getSource as unknown as (id: string) => { setData: ReturnType<typeof vi.fn> })(
      'operational-map-evacuations-source',
    )
    expect(source.setData).toHaveBeenCalledWith(emptyCollection)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('selects and refocuses a source-qualified controlled feature request', async () => {
    const eventFeature = {
      type: 'Feature' as const,
      id: 'usgs:source-event-1',
      geometry: { type: 'Point' as const, coordinates: [106.8, -6.2] },
      properties: {
        id: 'usgs:source-event-1', layer: 'events' as const, label: 'Gempa Jakarta', source: 'usgs', attribution: 'USGS', verification_status: 'source-reported',
      },
    }
    const collection = {
      type: 'FeatureCollection' as const,
      layer: 'events' as const,
      truncated: false,
      features: [eventFeature],
    }
    const { rerender } = render(
      <OperationalMap
        initialLayers={['events']}
        controlledCollections={{ events: collection }}
        focusRequest={{ id: 'usgs:source-event-1', geometry: eventFeature.geometry, nonce: 1 }}
      />,
    )
    const map = maplibre.instances[0]
    await act(async () => {
      map.trigger('load')
      await Promise.resolve()
    })

    expect(screen.getByRole('heading', { name: 'Gempa Jakarta' })).toBeTruthy()
    expect(map.easeTo).toHaveBeenCalledWith({ center: [106.8, -6.2], zoom: 7 })

    rerender(
      <OperationalMap
        initialLayers={['events']}
        controlledCollections={{ events: collection }}
        focusRequest={{ id: 'usgs:source-event-1', geometry: eventFeature.geometry, nonce: 2 }}
      />,
    )
    expect(map.easeTo).toHaveBeenCalledTimes(2)
  })

  it('selects a qualified official-alert response and fits its polygon focus', async () => {
    const geometry = {
      type: 'Polygon' as const,
      coordinates: [[[106.7, -6.3], [106.9, -6.3], [106.9, -6.1], [106.7, -6.3]]],
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      type: 'FeatureCollection',
      layer: 'alerts',
      truncated: false,
      features: [{
        type: 'Feature',
        id: 'bmkg_cap:source-warning-1',
        geometry,
        properties: {
          id: 'bmkg_cap:source-warning-1', layer: 'alerts', label: 'Peringatan BMKG', source: 'bmkg_cap', attribution: 'BMKG', verification_status: 'official',
        },
      }],
    }), { status: 200 }))
    render(
      <OperationalMap
        initialLayers={['official-alerts']}
        focusRequest={{ id: 'bmkg_cap:source-warning-1', geometry, nonce: 1 }}
      />,
    )
    const map = maplibre.instances[0]
    await act(async () => {
      map.trigger('load')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByRole('heading', { name: 'Peringatan BMKG' })).toBeTruthy()
    expect(map.fitBounds).toHaveBeenCalledWith(
      [[106.7, -6.3], [106.9, -6.1]],
      { padding: 32, maxZoom: 9 },
    )
  })

  it('renders only known public layer toggles with stale, truncation, and attribution indicators', () => {
    const onToggle = vi.fn()
    render(
      <MapLegend
        enabledLayers={['events', 'air-quality']}
        onToggle={onToggle}
        results={{
          events: {
            layer: 'events',
            state: 'stale',
            collection: {
              type: 'FeatureCollection',
              layer: 'events',
              truncated: true,
              features: [{
                type: 'Feature',
                id: 'bmkg:event-1',
                geometry: { type: 'Point', coordinates: [106.8, -6.2] },
                properties: {
                  id: 'bmkg:event-1',
                  layer: 'events',
                  label: 'Jakarta',
                  source: 'bmkg',
                  attribution: 'BMKG',
                  verification_status: 'source-reported',
                },
              }],
            },
          },
        }}
      />,
    )

    expect((screen.getByRole('checkbox', { name: 'Kejadian' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Peringatan resmi' }) as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByRole('checkbox', { name: /watch zone|aset pribadi/i })).toBeNull()
    expect(screen.getByText('Data mungkin terlambat.')).toBeTruthy()
    expect(screen.getByText('Hasil dibatasi untuk area ini.')).toBeTruthy()
    expect(screen.getByText('BMKG')).toBeTruthy()
    expect(screen.queryByText('FeatureCollection')).toBeNull()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Peringatan resmi' }))
    expect(onToggle).toHaveBeenCalledWith('official-alerts')
  })

  it('renders the severity awareness key with blink hints for critical and high', () => {
    render(
      <MapLegend
        enabledLayers={['events']}
        results={{}}
        onToggle={() => {}}
      />,
    )

    expect(screen.getByText('Tingkat kewaspadaan')).toBeTruthy()
    expect(screen.getByText('Kritis')).toBeTruthy()
    expect(screen.getByText('Tinggi')).toBeTruthy()
    expect(screen.getByText('Sedang')).toBeTruthy()
    expect(screen.getByText('Rendah')).toBeTruthy()
    // Kritis & tinggi ditandai berkedip; sedang & rendah tidak.
    expect(screen.getAllByText('berkedip')).toHaveLength(2)
  })

  it('toggles the events density heatmap from the legend and swaps point visibility', async () => {
    const onToggleHeatmap = vi.fn()
    const { rerender } = render(
      <MapLegend
        enabledLayers={['events']}
        results={{}}
        onToggle={() => {}}
        heatmapOn={false}
        onToggleHeatmap={onToggleHeatmap}
      />,
    )

    const toggle = screen.getByRole('checkbox', { name: 'Mode heatmap kepadatan' }) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    fireEvent.click(toggle)
    expect(onToggleHeatmap).toHaveBeenCalledWith(true)

    rerender(
      <MapLegend
        enabledLayers={['events']}
        results={{}}
        onToggle={() => {}}
        heatmapOn
        onToggleHeatmap={onToggleHeatmap}
      />,
    )
    expect((screen.getByRole('checkbox', { name: 'Mode heatmap kepadatan' }) as HTMLInputElement).checked).toBe(true)
  })

  it('disables the heatmap toggle when the events layer is off', () => {
    render(
      <MapLegend
        enabledLayers={['official-alerts']}
        results={{}}
        onToggle={() => {}}
        heatmapOn={false}
        onToggleHeatmap={() => {}}
      />,
    )
    expect((screen.getByRole('checkbox', { name: 'Mode heatmap kepadatan' }) as HTMLInputElement).disabled).toBe(true)
  })

  it('renders typed public feature details without raw GeoJSON and closes from its accessible icon control', () => {
    const onClose = vi.fn()
    render(
      <MapDetailSheet
        feature={{
          type: 'Feature',
          id: 'bmkg:station-1:pm25',
          geometry: { type: 'Point', coordinates: [106.8, -6.2] },
          properties: {
            id: 'bmkg:station-1:pm25',
            layer: 'air-quality',
            label: 'Stasiun Jakarta',
            source: 'bmkg',
            attribution: 'BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)',
            source_url: 'https://www.bmkg.go.id/',
            verification_status: 'official',
            observed_at: '2026-08-02T00:00:00.000Z',
            data_vintage: '2026-08-02T01:00:00.000Z',
            pollutant: 'PM2.5',
            value: 32,
            unit: 'µg/m³',
            category: 'Sedang',
          },
        }}
        onClose={onClose}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Stasiun Jakarta' })).toBeTruthy()
    expect(screen.getByText('BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)')).toBeTruthy()
    expect(screen.getByText('official')).toBeTruthy()
    expect(screen.getByText('PM2.5 32 µg/m³')).toBeTruthy()
    expect(screen.getByText('Kategori udara')).toBeTruthy()
    expect(screen.getByText('Sedang')).toBeTruthy()
    expect(screen.getByText('Diamati')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Buka sumber' }).getAttribute('href')).toBe('https://www.bmkg.go.id/')
    expect(screen.queryByText('FeatureCollection')).toBeNull()
    expect(screen.queryByText('coordinates')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Tutup detail' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows evacuation availability with an explicit unknown state and rejects unapproved source URLs', () => {
    render(
      <MapDetailSheet
        feature={{
          type: 'Feature',
          id: 'evacuation:1',
          geometry: { type: 'Point', coordinates: [106.8, -6.2] },
          properties: {
            id: 'evacuation:1',
            layer: 'evacuations',
            label: 'Gedung Aman',
            source: 'sadarbencana',
            attribution: 'SadarBencana',
            source_url: 'http://evil.example/redirect',
            verification_status: 'operator-reported',
            location_type: 'shelter',
          },
        }}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Jenis lokasi')).toBeTruthy()
    expect(screen.getByText('shelter')).toBeTruthy()
    expect(screen.getByText('Status evakuasi')).toBeTruthy()
    expect(screen.getByText('Status belum diketahui')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Buka sumber' })).toBeNull()
  })

  it('immediately aborts and invalidates an in-flight viewport request before debounce completion', async () => {
    const requests: Array<{ resolve: (response: Response) => void; signal: AbortSignal | undefined }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise<Response>((resolve) => {
      requests.push({ resolve, signal: init?.signal ?? undefined })
    }))

    render(<OperationalMap />)
    const map = maplibre.instances[0]
    await act(async () => {
      map.trigger('load')
      await Promise.resolve()
    })

    expect(requests).toHaveLength(5)
    act(() => map.trigger('moveend'))
    expect(requests.every((request) => request.signal?.aborted)).toBe(true)

    for (const request of requests) {
      request.resolve(new Response(JSON.stringify({
        type: 'FeatureCollection',
        layer: 'events',
        truncated: false,
        features: [],
      }), { status: 200 }))
    }
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    // Radar cuaca & terrain memang dipasang saat load; layer data publik tidak boleh.
    const addSourceCalls = map.addSource.mock.calls.map((call) => String(call[0])).sort()
    expect(addSourceCalls).toEqual(['operational-map-terrain-dem-source', 'operational-map-weather-radar-source'])
  })

  it('expands an event cluster while leaf points continue to open details', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const layer = String(url).includes('/alerts') ? 'alerts' : String(url).includes('/air-quality')
        ? 'air-quality' : String(url).includes('/evacuations') ? 'evacuations' : 'events'
      return Promise.resolve(new Response(JSON.stringify({ type: 'FeatureCollection', layer, truncated: false, features: [] }), { status: 200 }))
    })
    render(<OperationalMap />)
    const map = maplibre.instances[0]
    await act(async () => {
      map.trigger('load')
      await Promise.resolve()
    })

    await act(async () => {
      map.trigger('click', {
        features: [{
          geometry: { type: 'Point', coordinates: [106.8, -6.2] },
          properties: { cluster_id: 42, point_count: 7 },
        }],
      })
      await Promise.resolve()
    })

    const eventSource = (map.getSource as unknown as (id: string) => { getClusterExpansionZoom: ReturnType<typeof vi.fn> } | undefined)('operational-map-events-source')
    expect(eventSource?.getClusterExpansionZoom).toHaveBeenCalledWith(42)
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [106.8, -6.2], zoom: 12 }))
  })

  it('shows per-layer failure and a disabled-all state instead of treating them as an empty response', () => {
    render(
      <MapLegend
        enabledLayers={['events', 'official-alerts']}
        onToggle={vi.fn()}
        results={{}}
        layerStates={{
          events: { health: 'stale', refreshFailed: true, refreshing: false },
          'official-alerts': { health: 'unavailable', refreshing: false },
        }}
      />,
    )
    expect(screen.getByText('Data tersimpan, muat ulang gagal.')).toBeTruthy()
    expect(screen.getByText('Tidak tersedia')).toBeTruthy()

    cleanup()
    render(<MapLegend enabledLayers={[]} onToggle={vi.fn()} results={{}} layerStates={{}} />)
    expect(screen.getByText('Aktifkan setidaknya satu lapisan.')).toBeTruthy()
  })

  it('retains stale public provenance and truncation notice after a failed refresh', () => {
    render(
      <MapLegend
        enabledLayers={['events']}
        onToggle={vi.fn()}
        results={{}}
        layerStates={{
          events: {
            health: 'stale',
            refreshFailed: true,
            refreshing: false,
            collection: {
              type: 'FeatureCollection',
              layer: 'events',
              truncated: true,
              features: [{
                type: 'Feature',
                id: 'bmkg:event-1',
                geometry: { type: 'Point', coordinates: [106.8, -6.2] },
                properties: {
                  id: 'bmkg:event-1', layer: 'events', label: 'Jakarta', source: 'bmkg', attribution: 'BMKG', verification_status: 'official',
                },
              }],
            },
          },
        }}
      />,
    )

    expect(screen.getByText('BMKG')).toBeTruthy()
    expect(screen.getByText('Hasil dibatasi untuk area ini.')).toBeTruthy()
    expect(screen.getByText('Data tersimpan, muat ulang gagal.')).toBeTruthy()
  })

  it('retains ready collections, provenance, and truncation after a deferred viewport refresh becomes unavailable', async () => {
    vi.useFakeTimers()
    let failedRefresh = false
    const deferredFailures: Array<(response: Response) => void> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const layer = String(url).includes('/alerts') ? 'alerts' : String(url).includes('/air-quality')
        ? 'air-quality' : String(url).includes('/evacuations') ? 'evacuations' : 'events'
      if (failedRefresh) return new Promise<Response>((resolve) => deferredFailures.push(resolve))
      return Promise.resolve(new Response(JSON.stringify({
        type: 'FeatureCollection', layer, truncated: layer === 'events',
        features: layer === 'events' ? [{
          type: 'Feature', id: 'events:1', geometry: { type: 'Point', coordinates: [106.8, -6.2] },
          properties: { id: 'events:1', layer: 'events', label: 'Jakarta', source: 'bmkg', attribution: 'BMKG', verification_status: 'official' },
        }] : [],
      }), { status: 200 }))
    })
    render(<OperationalMap />)
    const map = maplibre.instances[0]
    await act(async () => {
      map.trigger('load')
      await Promise.resolve()
    })
    expect(screen.getByText('BMKG')).toBeTruthy()

    failedRefresh = true
    act(() => map.trigger('moveend'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(deferredFailures).toHaveLength(5)
    for (const resolve of deferredFailures) resolve(new Response('{"error":"unavailable"}', { status: 503 }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('Data tersimpan, muat ulang gagal.')).toBeTruthy()
    expect(screen.getByText('BMKG')).toBeTruthy()
    expect(screen.getByText('Hasil dibatasi untuk area ini.')).toBeTruthy()
  })

  it('retains stale indicator and provenance after a deferred stale viewport refresh becomes unavailable', async () => {
    vi.useFakeTimers()
    let failedRefresh = false
    const deferredFailures: Array<(response: Response) => void> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const layer = String(url).includes('/alerts') ? 'alerts' : String(url).includes('/air-quality')
        ? 'air-quality' : String(url).includes('/evacuations') ? 'evacuations' : 'events'
      if (failedRefresh) return new Promise<Response>((resolve) => deferredFailures.push(resolve))
      return Promise.resolve(new Response(JSON.stringify({
        type: 'FeatureCollection', layer, truncated: false,
        features: layer === 'events' ? [{
          type: 'Feature', id: 'events:stale-1', geometry: { type: 'Point', coordinates: [106.8, -6.2] },
          properties: {
            id: 'events:stale-1', layer: 'events', label: 'Jakarta', source: 'petabencana', attribution: 'PetaBencana', verification_status: 'source-reported',
            stale: true, data_vintage: '2026-07-30T00:00:00.000Z',
          },
        }] : [],
      }), { status: 200 }))
    })
    render(<OperationalMap />)
    const map = maplibre.instances[0]
    await act(async () => {
      map.trigger('load')
      await Promise.resolve()
    })
    expect(screen.getByText('Data mungkin terlambat.')).toBeTruthy()
    expect(screen.getByText('PetaBencana')).toBeTruthy()

    failedRefresh = true
    act(() => map.trigger('moveend'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(deferredFailures).toHaveLength(5)
    for (const resolve of deferredFailures) resolve(new Response('{"error":"unavailable"}', { status: 503 }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('Data mungkin terlambat.')).toBeTruthy()
    expect(screen.getByText('Data tersimpan, muat ulang gagal.')).toBeTruthy()
    expect(screen.getByText('PetaBencana')).toBeTruthy()
  })

  it('closes a selected evacuation detail when a successful refresh removes it', async () => {
    vi.useFakeTimers()
    let batch = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const wireLayer = String(url).includes('/alerts') ? 'alerts' : String(url).includes('/air-quality')
        ? 'air-quality' : String(url).includes('/evacuations') ? 'evacuations' : 'events'
      const isEvacuation = wireLayer === 'evacuations'
      const features = isEvacuation && batch > 0 ? [] : [{
        type: 'Feature', id: `${wireLayer}:1`, geometry: { type: 'Point', coordinates: [106.8, -6.2] },
        properties: {
          id: `${wireLayer}:1`, layer: wireLayer, label: isEvacuation ? 'Gedung Aman' : 'Jakarta', source: 'bmkg', attribution: 'BMKG', verification_status: 'official',
          ...(isEvacuation ? { open: true, full: false } : {}),
        },
      }]
      return Promise.resolve(new Response(JSON.stringify({ type: 'FeatureCollection', layer: wireLayer, truncated: false, features }), { status: 200 }))
    })
    render(<OperationalMap />)
    const map = maplibre.instances[0]
    await act(async () => {
      map.trigger('load')
      await Promise.resolve()
    })
    await act(async () => {
      map.trigger('click', {
        features: [{
          id: 'evacuations:1', geometry: { type: 'Point', coordinates: [106.8, -6.2] },
          properties: { id: 'evacuations:1', layer: 'evacuations', label: 'Gedung Aman', source: 'bmkg', attribution: 'BMKG', verification_status: 'official', open: true, full: false },
        }],
      })
    })
    expect(screen.getByRole('heading', { name: 'Gedung Aman' })).toBeTruthy()

    batch = 1
    act(() => map.trigger('moveend'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
      await Promise.resolve()
    })
    expect(screen.queryByRole('heading', { name: 'Gedung Aman' })).toBeNull()
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'http://www.bmkg.go.id/cuaca',
    'https://operator:secret@www.bmkg.go.id/cuaca',
    'https://www.bmkg.go.id.evil.example/cuaca',
  ])('does not render an unsafe source link: %s', (sourceUrl) => {
    render(
      <MapDetailSheet
        feature={{
          type: 'Feature', id: 'bmkg:event-1', geometry: { type: 'Point', coordinates: [106.8, -6.2] },
          properties: { id: 'bmkg:event-1', layer: 'events', label: 'Jakarta', source: 'bmkg', attribution: 'BMKG', verification_status: 'official', source_url: sourceUrl },
        }}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByRole('link', { name: 'Buka sumber' })).toBeNull()
  })

  it.each([
    ['bmkg_cap', 'https://alerts.bmkg.go.id/cap/alert-1.xml'],
    ['nasa_firms', 'https://firms.modaps.eosdis.nasa.gov/active_fire/'],
    ['gdacs_fl', 'https://www.gdacs.org/events/123'],
    ['gdacs_vo', 'https://gdacs.org/events/456'],
    ['petabencana', 'https://petabencana.id/reports/report-1'],
    ['gvp', 'https://volcano.si.edu/volcano.cfm?vn=263300'],
    ['pvmbg', 'https://magma.esdm.go.id/v1/gunung-api/semeru'],
  ])('renders reviewed source URL for the production %s identifier', (source, sourceUrl) => {
    render(
      <MapDetailSheet
        feature={{
          type: 'Feature', id: `${source}:1`, geometry: { type: 'Point', coordinates: [106.8, -6.2] },
          properties: { id: `${source}:1`, layer: 'events', label: 'Jakarta', source, attribution: source, verification_status: 'official', source_url: sourceUrl },
        }}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('link', { name: 'Buka sumber' }).getAttribute('href')).toBe(sourceUrl)
  })
})
