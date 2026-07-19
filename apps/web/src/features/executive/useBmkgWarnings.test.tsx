import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AirQualityObservationsResponse,
  OfficialAlert,
} from '../../lib/api/client'
import { useBmkgWarnings } from './useBmkgWarnings'

function officialAlert(overrides: Partial<OfficialAlert> = {}): OfficialAlert {
  return {
    id: 'weather-1',
    source: 'bmkg_cap',
    source_alert_id: 'source-weather-1',
    revision: 1,
    message_type: 'alert',
    status: 'active',
    sent_at: '2026-07-15T04:00:00Z',
    effective_at: null,
    expires_at: '2027-07-15T06:00:00Z',
    peril_type: 'weather',
    severity: 'High',
    category: null,
    headline: 'Hujan lebat',
    description: null,
    area_name: 'Jawa Barat',
    area_geojson: null,
    latitude: -6.9,
    longitude: 107.6,
    source_url: null,
    ...overrides,
  }
}

const observationsResponse = (sourceActive: boolean): AirQualityObservationsResponse => ({
  data: [],
  meta: { count: 0, limit: 50, latest: true, source_active: sourceActive },
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useBmkgWarnings', () => {
  it('keeps source status unknown and does not confirm an empty observation result after initial failure', async () => {
    const { result } = renderHook(() => useBmkgWarnings({
      fetchWeather: vi.fn().mockResolvedValue([]),
      fetchAirQualityAlerts: vi.fn().mockResolvedValue([]),
      fetchObservations: vi.fn().mockRejectedValue(new Error('observations unavailable')),
      refreshIntervalMs: 60_000,
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.sourceActive).toBeNull()
    expect(result.current.status.observations.loaded).toBe(false)
    expect(result.current.status.observations.uncertain).toBe(false)
    expect(result.current.errors.observations).toContain('observations unavailable')
  })

  it('preserves successful cached rows and marks failed retry endpoints uncertain', async () => {
    const weather = officialAlert()
    const fetchWeather = vi.fn()
      .mockResolvedValueOnce([weather])
      .mockRejectedValueOnce(new Error('weather refresh failed'))
    const fetchAirQualityAlerts = vi.fn().mockResolvedValue([])
    const fetchObservations = vi.fn()
      .mockResolvedValueOnce(observationsResponse(true))
      .mockRejectedValueOnce(new Error('observation refresh failed'))

    const { result } = renderHook(() => useBmkgWarnings({
      fetchWeather,
      fetchAirQualityAlerts,
      fetchObservations,
      refreshIntervalMs: 60_000,
    }))
    await act(async () => {
      await result.current.reload()
    })
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await result.current.reload()
    })

    expect(result.current.weatherAlerts.map((alert) => alert.id)).toEqual(['weather-1'])
    expect(result.current.sourceActive).toBe(true)
    expect(result.current.status.weather.uncertain).toBe(true)
    expect(result.current.status.observations.uncertain).toBe(true)
  })

  it('expires cached alerts on the local clock and skips overlapping interval loads', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-07-15T05:00:00Z')
    let resolveWeather: ((alerts: OfficialAlert[]) => void) | undefined
    const firstWeather = new Promise<OfficialAlert[]>((resolve) => {
      resolveWeather = resolve
    })
    const fetchWeather = vi.fn().mockReturnValue(firstWeather)
    const fetchAirQualityAlerts = vi.fn().mockResolvedValue([])
    const fetchObservations = vi.fn().mockResolvedValue(observationsResponse(true))

    const { result } = renderHook(() => useBmkgWarnings({
      fetchWeather,
      fetchAirQualityAlerts,
      fetchObservations,
      refreshIntervalMs: 60_000,
    }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(fetchWeather).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveWeather?.([officialAlert({ expires_at: '2026-07-15T05:01:30Z' })])
      await firstWeather
    })
    expect(result.current.weatherAlerts).toHaveLength(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(result.current.weatherAlerts).toHaveLength(0)
    expect(fetchWeather).toHaveBeenCalledTimes(2)
  })
})
