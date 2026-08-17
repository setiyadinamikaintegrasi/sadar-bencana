import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WatchZoneMapPicker from './WatchZoneMapPicker'

const engine = vi.hoisted(() => ({ value: 'leaflet' as 'leaflet' | 'maplibre' }))

vi.mock('../../config/mapEngine', () => ({ getOperationalMapEngine: () => engine.value }))
vi.mock('./MapLibreWatchZonePicker', () => ({ default: () => <div data-testid="maplibre-picker" /> }))
vi.mock('leaflet', () => ({ default: { divIcon: vi.fn(() => ({})) } }))
vi.mock('react-leaflet', () => ({
  Circle: () => null,
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="leaflet-picker">{children}</div>,
  Marker: () => null,
  TileLayer: () => null,
  useMapEvents: vi.fn(),
}))

beforeEach(() => { engine.value = 'leaflet' })
afterEach(cleanup)

describe('WatchZoneMapPicker engine wrapper', () => {
  it('retains Leaflet unless MapLibre is explicitly enabled', () => {
    const props = { latitude: null, longitude: null, radiusKm: 100, onChange: vi.fn() }
    const { rerender } = render(<WatchZoneMapPicker {...props} />)
    expect(screen.getByTestId('leaflet-picker')).toBeTruthy()
    expect(screen.queryByTestId('maplibre-picker')).toBeNull()

    engine.value = 'maplibre'
    rerender(<WatchZoneMapPicker {...props} />)
    expect(screen.getByTestId('maplibre-picker')).toBeTruthy()
    expect(screen.queryByTestId('leaflet-picker')).toBeNull()
  })
})
