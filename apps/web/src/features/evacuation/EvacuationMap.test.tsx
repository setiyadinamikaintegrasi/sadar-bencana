import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EvacuationMap from './EvacuationMap'

const engine = vi.hoisted(() => ({ value: 'leaflet' as 'leaflet' | 'maplibre' }))

vi.mock('../../config/mapEngine', () => ({ getOperationalMapEngine: () => engine.value }))
vi.mock('./MapLibreEvacuationMap', () => ({ default: () => <div data-testid="maplibre-evacuation" /> }))
vi.mock('leaflet', () => ({ default: { divIcon: vi.fn(() => ({})), latLngBounds: vi.fn() } }))
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="leaflet-evacuation">{children}</div>,
  Marker: () => null,
  Polyline: () => null,
  Popup: ({ children }: { children: React.ReactNode }) => children,
  TileLayer: () => null,
  useMap: () => ({ getContainer: () => document.createElement('div'), scrollWheelZoom: { enable: vi.fn(), disable: vi.fn() }, fitBounds: vi.fn(), setView: vi.fn() }),
  useMapEvents: () => ({ getBounds: () => ({ getSouth: () => -6.4, getNorth: () => -6, getWest: () => 106.7, getEast: () => 107.1 }), getZoom: () => 5 }),
}))

const props = {
  locations: [], userPos: null, routeTo: null, manualPinMode: false,
  onMapClick: vi.fn(), onSelect: vi.fn(), onViewportChange: vi.fn(),
}

beforeEach(() => { engine.value = 'leaflet' })
afterEach(cleanup)

describe('EvacuationMap engine wrapper', () => {
  it('retains Leaflet unless MapLibre is explicitly enabled', () => {
    const { rerender } = render(<EvacuationMap {...props} />)
    expect(screen.getByTestId('leaflet-evacuation')).toBeTruthy()
    expect(screen.queryByTestId('maplibre-evacuation')).toBeNull()

    engine.value = 'maplibre'
    rerender(<EvacuationMap {...props} />)
    expect(screen.getByTestId('maplibre-evacuation')).toBeTruthy()
    expect(screen.queryByTestId('leaflet-evacuation')).toBeNull()
  })
})
