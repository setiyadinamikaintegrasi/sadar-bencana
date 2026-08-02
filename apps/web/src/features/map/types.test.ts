import { describe, expect, it } from 'vitest'
import { sourceQualifiedOperationalMapID, type OperationalMapFeatureCollection } from './types'

describe('operational map wire contract', () => {
  it('accepts the API official-alert response layer independently from the UI layer key', () => {
    const response: OperationalMapFeatureCollection = {
      type: 'FeatureCollection',
      layer: 'alerts',
      truncated: false,
      features: [{
        type: 'Feature',
        id: 'bmkg:alert-1',
        geometry: { type: 'Point', coordinates: [106.8, -6.2] },
        properties: {
          id: 'bmkg:alert-1',
          layer: 'alerts',
          label: 'Heavy rain',
          source: 'bmkg',
          attribution: 'BMKG',
          verification_status: 'official',
        },
      }],
    }

    expect(response.layer).toBe('alerts')
    expect(response.features[0].properties.layer).toBe('alerts')
  })
})

describe('sourceQualifiedOperationalMapID', () => {
  it('matches the operational map API ID contract for events and official alerts', () => {
    expect(sourceQualifiedOperationalMapID('usgs', 'source-event-1')).toBe('usgs:source-event-1')
    expect(sourceQualifiedOperationalMapID('bmkg_cap', 'source-warning-1')).toBe('bmkg_cap:source-warning-1')
  })
})
