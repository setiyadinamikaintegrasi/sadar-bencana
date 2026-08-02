import { describe, expect, it } from 'vitest'
import { readMapViewState, writeMapViewState } from './state'

describe('operational map URL state', () => {
  it('round-trips the camera, public layers, and map time', () => {
    const search = writeMapViewState({
      mapLng: 106.8456,
      mapLat: -6.2088,
      mapZoom: 9,
      mapLayers: ['events', 'official-alerts'],
      mapTime: '2026-08-02T00:00:00Z',
    })

    expect(readMapViewState(search)).toEqual({
      mapLng: 106.8456,
      mapLat: -6.2088,
      mapZoom: 9,
      mapLayers: ['events', 'official-alerts'],
      mapTime: '2026-08-02T00:00:00Z',
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
    expect(writeMapViewState({
      mapLng: 118,
      mapLat: -2.5,
      mapZoom: 5,
      mapLayers: ['evacuations'],
      mapTime: '2026-08-02T01:30:00Z',
    }, '?section=dashboard&source=notification')).toBe(
      '?section=dashboard&source=notification&mapLng=118&mapLat=-2.5&mapZoom=5&mapLayers=evacuations&mapTime=2026-08-02T01%3A30%3A00Z',
    )
  })
})
