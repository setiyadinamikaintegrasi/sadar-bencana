import { afterEach, describe, expect, it, vi } from 'vitest'
import { getOperationalMapEngine } from './mapEngine'

describe('getOperationalMapEngine', () => {
  it('selects MapLibre only for the explicit maplibre build flag', () => {
    expect(getOperationalMapEngine('maplibre')).toBe('maplibre')
  })

  it('defaults to Leaflet when the build flag is omitted', () => {
    // Pastikan env dari .env.local (mis. maplibre untuk dev) tidak bocor.
    vi.stubEnv('VITE_OPERATIONAL_MAP_ENGINE', '')
    expect(getOperationalMapEngine(undefined)).toBe('leaflet')
  })

  it('defaults to Leaflet for malformed build flag values', () => {
    expect(getOperationalMapEngine('MAPLIBRE')).toBe('leaflet')
    expect(getOperationalMapEngine('leaflet')).toBe('leaflet')
  })

  afterEach(() => vi.unstubAllEnvs())
})
