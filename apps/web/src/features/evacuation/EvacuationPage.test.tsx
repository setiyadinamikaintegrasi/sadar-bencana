import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EvacuationLocation } from '../../lib/api/evacuation'
import type { EvacuationMapProps } from './EvacuationMap'
import EvacuationPage from './EvacuationPage'

const state = vi.hoisted(() => ({
  mapProps: {} as EvacuationMapProps,
  fetchLocations: vi.fn(),
}))

vi.mock('./EvacuationMap', () => ({
  default: (props: EvacuationMapProps) => {
    state.mapProps = props
    return <div data-testid="evacuation-map" />
  },
}))

vi.mock('../../lib/api/evacuation', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/api/evacuation')>()
  return { ...original, fetchEvacuationLocations: state.fetchLocations }
})

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

beforeEach(() => {
  vi.useFakeTimers()
  state.fetchLocations.mockReset().mockResolvedValue([location])
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('EvacuationPage map collection lifecycle', () => {
  it('passes loaded locations to the map and clears them below the zoom-11 gate', async () => {
    render(<EvacuationPage />)
    const bbox = { minLat: -6.4, maxLat: -6, minLon: 106.7, maxLon: 107.1 }

    act(() => state.mapProps.onViewportChange(bbox, 12))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
      await Promise.resolve()
    })
    expect(state.mapProps.locations).toEqual([location])
    expect(state.fetchLocations).toHaveBeenCalledWith({ bbox })

    act(() => state.mapProps.onViewportChange(bbox, 10))
    expect(state.mapProps.locations).toEqual([])
    expect(screen.getByText(/Perbesar peta untuk memuat lokasi evakuasi/)).toBeTruthy()
  })
})
