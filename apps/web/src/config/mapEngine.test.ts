import { describe, expect, it } from 'vitest'
import { getOperationalMapEngine } from './mapEngine'

describe('getOperationalMapEngine', () => {
  it('selects MapLibre only for the explicit maplibre build flag', () => {
    expect(getOperationalMapEngine('maplibre')).toBe('maplibre')
  })

  it('defaults to Leaflet when the build flag is omitted', () => {
    expect(getOperationalMapEngine(undefined)).toBe('leaflet')
  })

  it('defaults to Leaflet for malformed build flag values', () => {
    expect(getOperationalMapEngine('MAPLIBRE')).toBe('leaflet')
    expect(getOperationalMapEngine('leaflet')).toBe('leaflet')
  })
})
