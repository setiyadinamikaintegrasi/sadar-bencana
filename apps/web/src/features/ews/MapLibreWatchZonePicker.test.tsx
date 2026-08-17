import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MapLibreWatchZonePicker from './MapLibreWatchZonePicker'

const operationalMap = vi.hoisted(() => ({ props: {} as Record<string, unknown> }))

vi.mock('../map/OperationalMap', () => ({
  default: (props: Record<string, unknown>) => {
    operationalMap.props = props
    return <button type="button" onClick={() => (props.onPick as (lat: number, lon: number) => void)(-6.2, 106.8)}>Pilih titik MapLibre</button>
  },
}))

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  })
})

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('MapLibreWatchZonePicker', () => {
  it('emits the existing center/radius contract without persisting the private draft', () => {
    window.history.replaceState({}, '', '/?section=ews')
    localStorage.setItem('unrelated', 'keep')
    const onChange = vi.fn()
    render(<MapLibreWatchZonePicker latitude={null} longitude={null} radiusKm={100} onChange={onChange} />)

    expect(operationalMap.props).toMatchObject({ mode: 'picker', initialLayers: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Pilih titik MapLibre' }))
    expect(onChange).toHaveBeenCalledWith(-6.2, 106.8, 100)

    fireEvent.change(screen.getByRole('slider', { name: 'Radius' }), { target: { value: '150' } })
    expect(onChange).toHaveBeenLastCalledWith(-2.5, 118, 150)
    expect(window.location.search).toBe('?section=ews')
    expect(localStorage.getItem('unrelated')).toBe('keep')
    expect(localStorage.length).toBe(1)
  })

  it('passes a local center and radius overlay to the picker map', () => {
    render(<MapLibreWatchZonePicker latitude={-6.2} longitude={106.8} radiusKm={50} onChange={vi.fn()} />)

    expect(operationalMap.props.focusCenter).toEqual([106.8, -6.2])
    expect((operationalMap.props.localOverlay as GeoJSON.FeatureCollection).features).toHaveLength(2)
    expect((operationalMap.props.localOverlay as GeoJSON.FeatureCollection).features.map((feature) => feature.geometry.type)).toEqual(['Polygon', 'Point'])
  })
})
