import { afterEach, describe, expect, it, vi } from 'vitest'
import { readMapViewState, writeMapViewState } from './state'

describe('operational map URL state', () => {
  it('round-trips the camera, public layers, and map time', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-02T12:00:00Z')

    const search = writeMapViewState({
      mapLng: 106.8456,
      mapLat: -6.2088,
      mapZoom: 9,
      mapLayers: ['events', 'official-alerts'],
      mapTime: '2026-08-02T00:00:00.000Z',
    })

    expect(readMapViewState(search)).toEqual({
      mapLng: 106.8456,
      mapLat: -6.2088,
      mapZoom: 9,
      mapLayers: ['events', 'official-alerts'],
      mapTime: '2026-08-02T00:00:00.000Z',
    })
  })

  it('falls back to the default map view state when parameters are absent', () => {
    expect(readMapViewState('')).toMatchObject({
      mapLng: 118,
      mapLat: -2.5,
      mapZoom: 4.3,
    })
  })

  it('clamps the camera to the supported world and zoom bounds', () => {
    expect(readMapViewState('?mapLng=250&mapLat=-100&mapZoom=99')).toMatchObject({
      mapLng: 180,
      mapLat: -85.051129,
      mapZoom: 18,
    })

    expect(readMapViewState('?mapLng=-250&mapLat=100&mapZoom=-2')).toMatchObject({
      mapLng: -180,
      mapLat: 85.051129,
      mapZoom: 0,
    })
  })

  it('discards unknown and private URL layers', () => {
    expect(readMapViewState('?mapLayers=events,watch-zones,unknown,air-quality,personal-assets')).toMatchObject({
      mapLayers: ['events', 'air-quality'],
    })
  })

  it('preserves unrelated parameters when writing map state', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-02T12:00:00Z')

    expect(writeMapViewState({
      mapLng: 118,
      mapLat: -2.5,
      mapZoom: 5,
      mapLayers: ['evacuations'],
      mapTime: '2026-08-02T01:30:00.000Z',
    }, '?section=dashboard&source=notification')).toBe(
      '?section=dashboard&source=notification&mapLng=118&mapLat=-2.5&mapZoom=5&mapLayers=evacuations&mapTime=2026-08-02T01%3A30%3A00.000Z',
    )
  })

  it('normalizes RFC3339 map time within the 72-hour operational window', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-02T12:00:00Z')

    expect(readMapViewState('?mapTime=2026-08-02T18:30:00%2B07:00')).toMatchObject({
      mapTime: '2026-08-02T11:30:00.000Z',
    })
  })

  it('discards malformed, whitespace, oversized, and out-of-range map time values', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-02T12:00:00Z')

    for (const mapTime of [
      'not-a-timestamp',
      ' 2026-08-02T11:30:00Z ',
      `2026-08-02T11:30:00.${'1'.repeat(20)}Z`,
      '2026-07-30T11:59:59Z',
      '2026-08-02T12:00:01Z',
    ]) {
      expect(readMapViewState(`?mapTime=${encodeURIComponent(mapTime)}`)).not.toHaveProperty('mapTime')
    }

    expect(writeMapViewState({
      mapLng: 118,
      mapLat: -2.5,
      mapZoom: 5,
      mapLayers: ['events'],
      mapTime: 'not-a-timestamp',
    }, '?section=dashboard')).toBe('?section=dashboard&mapLng=118&mapLat=-2.5&mapZoom=5&mapLayers=events')
  })
})

afterEach(() => vi.useRealTimers())
