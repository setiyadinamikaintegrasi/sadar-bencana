import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OperationalMap from './OperationalMap'

type MapEvent = { geolocateSource?: boolean }
type Listener = (event?: MapEvent) => void
type MapLibreTestInstance = {
  options: Record<string, unknown>
  addControl: ReturnType<typeof vi.fn>
  getCenter: ReturnType<typeof vi.fn>
  getZoom: ReturnType<typeof vi.fn>
  getStyle: ReturnType<typeof vi.fn>
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
    const listeners = new globalThis.Map<string, Listener>()
    let removed = false
    const assertLive = () => {
      if (removed) throw new Error('MapLibre map was used after removal')
    }
    const instance = {
      options,
      addControl: vi.fn(),
      getCenter: vi.fn(() => {
        assertLive()
        return { lng: 118, lat: -2.5 }
      }),
      getZoom: vi.fn(() => {
        assertLive()
        return 5
      }),
      getStyle: vi.fn(() => {
        assertLive()
        return { layers: [], sources: {} }
      }),
      off: vi.fn(() => assertLive()),
      on: vi.fn((event: string, listener: Listener) => listeners.set(event, listener)),
      once: vi.fn((event: string, listener: Listener) => listeners.set(event, listener)),
      remove: vi.fn(() => {
        assertLive()
        removed = true
      }),
      removeLayer: vi.fn(() => assertLive()),
      removeSource: vi.fn(() => assertLive()),
      resize: vi.fn(() => assertLive()),
      trigger: (event: string, data?: MapEvent) => listeners.get(event)?.(data),
    }
    instances.push(instance)
    return instance
  })

  return {
    instances,
    Map,
    NavigationControl: vi.fn(),
    GeolocateControl: vi.fn(),
  }
})

vi.mock('maplibre-gl', () => ({ default: maplibre }))

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
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
    expect(maplibre.instances[0].addControl).toHaveBeenCalledTimes(2)

    unmount()

    expect(maplibre.instances[0].remove).toHaveBeenCalledTimes(1)
  })

  it('excludes viewer controls in picker mode', () => {
    render(<OperationalMap mode="picker" />)

    expect(maplibre.instances[0].addControl).not.toHaveBeenCalled()
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

  it('shows an accessible fallback when MapLibre cannot construct a map', () => {
    maplibre.Map.mockImplementationOnce(function MapConstructionFailure() {
      throw new Error('WebGL unavailable')
    })

    render(<OperationalMap />)

    expect(screen.getByRole('alert').textContent).toContain('Peta tidak tersedia')
  })

  it('tears down a failed map once before unmounting and disconnects its observer', () => {
    const { unmount } = render(<OperationalMap />)
    const map = maplibre.instances[0]
    const observer = resizeObservers[0]

    act(() => map.trigger('error'))

    expect(screen.getByRole('alert').textContent).toContain('Peta tidak tersedia')
    expect(map.remove).toHaveBeenCalledTimes(1)
    expect(observer.disconnect).toHaveBeenCalledTimes(1)

    expect(() => unmount()).not.toThrow()
    expect(map.remove).toHaveBeenCalledTimes(1)
    expect(observer.disconnect).toHaveBeenCalledTimes(1)

    expect(() => observer.trigger()).not.toThrow()
    expect(map.resize).not.toHaveBeenCalled()
  })
})
