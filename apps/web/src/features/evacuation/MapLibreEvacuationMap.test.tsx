import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EvacuationLocation } from '../../lib/api/evacuation'
import type { OperationalMapFeature } from '../map/types'
import MapLibreEvacuationMap from './MapLibreEvacuationMap'

const operationalMap = vi.hoisted(() => ({ props: {} as Record<string, unknown> }))

vi.mock('../map/OperationalMap', () => ({
  default: (props: Record<string, unknown>) => {
    operationalMap.props = props
    return <div />
  },
}))

afterEach(cleanup)

describe('MapLibreEvacuationMap', () => {
  const location: EvacuationLocation = {
    id: 'evacuation-1',
    name: 'Shelter Jakarta',
    location_type: 'shelter',
    source_type: 'manual',
    latitude: -6.2,
    longitude: 106.8,
    address: 'Jakarta',
    photo_url: '',
    capacity: 100,
    is_open: true,
    is_full: false,
    phone: '',
    person_in_charge: '',
    facilities: [],
    operating_hours: '',
    created_at: '2026-08-03T00:00:00Z',
    updated_at: '2026-08-03T00:00:00Z',
    is_active: true,
  }

  it('renders only the parent-filtered locations and selects through the operational feature ID contract', () => {
    const onSelect = vi.fn()
    render(<MapLibreEvacuationMap
      locations={[location]}
      userPos={[-6.2, 106.8]}
      routeTo={[-6.1, 106.9]}
      manualPinMode={false}
      onMapClick={vi.fn()}
      onSelect={onSelect}
      onViewportChange={vi.fn()}
    />)

    expect(operationalMap.props).toMatchObject({
      mode: 'viewer',
      initialLayers: ['evacuations'],
      visibleLayers: ['evacuations'],
      showLegend: false,
      focusCenter: [106.9, -6.1],
    })
    const collection = (operationalMap.props.controlledCollections as Record<string, {
      features: OperationalMapFeature[]
    }>).evacuations
    expect(collection.features).toEqual([
      expect.objectContaining({
        id: 'evacuation-1',
        geometry: { type: 'Point', coordinates: [106.8, -6.2] },
        properties: expect.objectContaining({
          id: 'evacuation-1',
          layer: 'evacuations',
          label: 'Shelter Jakarta',
          location_type: 'shelter',
          open: true,
          full: false,
        }),
      }),
    ])
    expect((operationalMap.props.localOverlay as GeoJSON.FeatureCollection).features).toHaveLength(2)

    ;(operationalMap.props.onFeatureSelect as (feature: OperationalMapFeature) => void)(collection.features[0])
    expect(onSelect).toHaveBeenCalledWith(location)
  })

  it('replaces the controlled collection with the parent zoom-gated empty result', () => {
    const props = {
      userPos: null,
      routeTo: null,
      manualPinMode: false,
      onMapClick: vi.fn(),
      onSelect: vi.fn(),
      onViewportChange: vi.fn(),
    }
    const { rerender } = render(<MapLibreEvacuationMap locations={[location]} {...props} />)
    expect((operationalMap.props.controlledCollections as Record<string, {
      features: OperationalMapFeature[]
    }>).evacuations.features).toHaveLength(1)

    rerender(<MapLibreEvacuationMap locations={[]} {...props} />)
    expect((operationalMap.props.controlledCollections as Record<string, {
      features: OperationalMapFeature[]
    }>).evacuations.features).toEqual([])
  })
})
