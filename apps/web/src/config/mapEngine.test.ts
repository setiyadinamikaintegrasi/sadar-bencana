import { afterEach, describe, expect, it, vi } from 'vitest'
import { getOperationalMapEngine } from './mapEngine'

describe('getOperationalMapEngine', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('selects MapLibre only for the explicit maplibre build flag', () => {
    expect(getOperationalMapEngine('maplibre')).toBe('maplibre')
  })

  it('defaults to Leaflet when the build flag is omitted', () => {
    // Hermetik: jangan biarkan .env.local developer (mis. maplibre)
    // memengaruhi nilai default import.meta.env.
    vi.stubEnv('VITE_OPERATIONAL_MAP_ENGINE', '')
    expect(getOperationalMapEngine(undefined)).toBe('leaflet')
  })

  it('defaults to Leaflet for malformed build flag values', () => {
    expect(getOperationalMapEngine('MAPLIBRE')).toBe('leaflet')
    expect(getOperationalMapEngine('leaflet')).toBe('leaflet')
  })
})
