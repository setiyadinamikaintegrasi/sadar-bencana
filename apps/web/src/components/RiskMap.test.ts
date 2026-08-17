import { describe, expect, it, vi } from 'vitest'
import type { MapOverlay } from '../lib/api/client'
import {
  focusOverlay,
  isOverlayActiveAt,
  nextOverlayFocusRequest,
  openOverlayPopup,
  overlayPathOptions,
} from './RiskMap'

function overlay(overrides: Partial<MapOverlay> = {}): MapOverlay {
  return {
    id: 'overlay-1',
    layer_class: 'official',
    peril_type: 'weather',
    label: 'Peringatan BMKG',
    geometry: null,
    latitude: null,
    longitude: null,
    radius_km: null,
    effective_at: null,
    expires_at: null,
    data_vintage: null,
    attribution: 'BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)',
    source_url: null,
    ...overrides,
  }
}

describe('RiskMap official overlay focus', () => {
  it('focuses Polygon and MultiPolygon bounds', () => {
    const fitBounds = vi.fn()
    const flyTo = vi.fn()
    const map = { fitBounds, flyTo }
    const polygon = overlay({
      geometry: {
        type: 'Polygon',
        coordinates: [[[106, -6], [107, -6], [106, -6]]],
      },
    })
    const multiPolygon = overlay({
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[110, -7], [111, -7], [110, -7]]],
          [[[120, -2], [121, -2], [120, -2]]],
        ],
      },
    })

    focusOverlay(map, polygon)
    focusOverlay(map, multiPolygon)

    expect(fitBounds).toHaveBeenNthCalledWith(
      1,
      [[-6, 106], [-6, 107], [-6, 106]],
      { padding: [32, 32], maxZoom: 9 },
    )
    expect(fitBounds.mock.calls[1][0]).toHaveLength(6)
    expect(flyTo).not.toHaveBeenCalled()
  })

  it('focuses point overlays and opens their popup', () => {
    const map = { fitBounds: vi.fn(), flyTo: vi.fn() }
    const point = overlay({ latitude: -6.2, longitude: 106.8 })
    const layer = { openPopup: vi.fn() }

    focusOverlay(map, point)
    openOverlayPopup(layer)

    expect(map.flyTo).toHaveBeenCalledWith(
      [-6.2, 106.8],
      9,
      { animate: true, duration: 0.8 },
    )
    expect(layer.openPopup).toHaveBeenCalledTimes(1)
  })

  it('increments the focus nonce for repeated selection and exposes selected styling', () => {
    const first = nextOverlayFocusRequest(null, 'overlay-1')
    const second = nextOverlayFocusRequest(first, 'overlay-1')

    expect(first).toEqual({ id: 'overlay-1', nonce: 1 })
    expect(second).toEqual({ id: 'overlay-1', nonce: 2 })
    expect(overlayPathOptions(overlay(), true)).toMatchObject({
      color: '#f8fafc',
      weight: 4,
      fillOpacity: 0.4,
    })
    expect(overlayPathOptions(overlay(), false)).not.toMatchObject({
      color: '#f8fafc',
      weight: 4,
    })
  })

  it('does not treat a locally expired overlay as focusable', () => {
    const now = new Date('2026-07-15T05:00:00Z').getTime()
    expect(isOverlayActiveAt(overlay({ expires_at: '2026-07-15T04:59:59Z' }), now)).toBe(false)
    expect(isOverlayActiveAt(overlay({ expires_at: '2026-07-15T05:00:01Z' }), now)).toBe(true)
    expect(isOverlayActiveAt(overlay({ expires_at: 'malformed' }), now)).toBe(true)
  })
})
