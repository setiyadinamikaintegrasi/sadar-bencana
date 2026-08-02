import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  it('uses the shared viewer with only the evacuation layer enabled', () => {
    render(<MapLibreEvacuationMap
      locations={[]}
      userPos={[-6.2, 106.8]}
      routeTo={[-6.1, 106.9]}
      manualPinMode={false}
      onMapClick={vi.fn()}
      onSelect={vi.fn()}
      onViewportChange={vi.fn()}
    />)

    expect(operationalMap.props).toMatchObject({
      mode: 'viewer',
      initialLayers: ['evacuations'],
      focusCenter: [106.9, -6.1],
    })
    expect((operationalMap.props.localOverlay as GeoJSON.FeatureCollection).features).toHaveLength(2)
  })
})
