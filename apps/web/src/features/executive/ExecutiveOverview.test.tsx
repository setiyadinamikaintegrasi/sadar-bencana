import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExecutiveOverview from './ExecutiveOverview'

const { event, dashboardState } = vi.hoisted(() => ({
  event: {
    id: 'event-1',
    event_id: 'source-event-1',
    source: 'usgs',
    event_type: 'earthquake',
    magnitude: 5.2,
    latitude: -6.2,
    longitude: 106.8,
    place: 'Jakarta',
    event_time: '2026-07-15T04:00:00Z',
    url: 'https://earthquake.usgs.gov/example',
    severity: 'High',
    created_at: '2026-07-15T04:01:00Z',
  },
  dashboardState: {
    mapOverlays: [] as Array<Record<string, unknown>>,
    weatherAlerts: [] as Array<Record<string, unknown>>,
  },
}))

const warning = {
  id: 'warning-1',
  source: 'bmkg_cap',
  source_alert_id: 'source-warning-1',
  revision: 1,
  message_type: 'alert',
  status: 'active',
  sent_at: '2026-07-15T04:00:00Z',
  effective_at: null,
  expires_at: '2027-07-15T04:00:00Z',
  peril_type: 'weather',
  severity: 'High',
  category: null,
  headline: 'Peringatan BMKG',
  description: null,
  area_name: 'Jakarta',
  area_geojson: null,
  latitude: -6.2,
  longitude: 106.8,
  source_url: null,
}

function overlay(overrides: Record<string, unknown> = {}) {
  return {
    id: 'warning-1',
    layer_class: 'official',
    peril_type: 'weather',
    label: 'Peringatan BMKG lengkap',
    geometry: null,
    latitude: -6.2,
    longitude: 106.8,
    radius_km: null,
    effective_at: null,
    expires_at: '2027-07-15T04:00:00Z',
    data_vintage: null,
    attribution: 'BMKG',
    source_url: null,
    ...overrides,
  }
}

vi.mock('../../lib/api/client', () => ({
  getAlerts: vi.fn().mockResolvedValue({ data: [], meta: { count: 0, unacknowledged: 0 } }),
  getConnectorHealth: vi.fn().mockResolvedValue([]),
  getEvents: vi.fn().mockResolvedValue([event]),
  getMapOverlays: vi.fn(() => Promise.resolve(dashboardState.mapOverlays)),
  getMeta: vi.fn().mockResolvedValue({ service: 'api', environment: 'test', version: '1' }),
  getNews: vi.fn().mockResolvedValue([]),
  getRiskScores: vi.fn().mockResolvedValue({ data: [], meta: { count: 0, limit: 0 } }),
}))
vi.mock('./useBmkgWarnings', () => ({
  useBmkgWarnings: () => ({
    weatherAlerts: dashboardState.weatherAlerts,
    airQualityAlerts: [],
    observations: [],
    sourceActive: false,
    loading: false,
    errors: {},
    status: {
      weather: { loaded: true, uncertain: false },
      air_quality: { loaded: true, uncertain: false },
      observations: { loaded: true, uncertain: false },
    },
    now: new Date('2026-07-15T05:00:00Z').getTime(),
    reload: vi.fn(),
  }),
}))
vi.mock('../../components/RiskMap', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../components/RiskMap')>()
  return {
    ...original,
    default: ({
      events,
      onEventClick,
      selectedOverlayId,
      overlayFocusNonce,
    }: {
      events: typeof event[]
      onEventClick: (selected: typeof event) => void
      selectedOverlayId?: string
      overlayFocusNonce?: number
    }) => (
      <div>
        <p data-testid="map-focus">
          {selectedOverlayId ? `${selectedOverlayId}:${overlayFocusNonce}` : 'none'}
        </p>
        <button type="button" onClick={() => onEventClick(events[0])}>Pilih event biasa</button>
      </div>
    ),
  }
})
vi.mock('./BmkgWarningsPanel', () => ({ default: () => null }))
vi.mock('./LiveVideoDesk', () => ({ default: () => null }))
vi.mock('../../components/NewsPanel', () => ({ default: () => null }))
vi.mock('../../components/SourceBadge', () => ({ default: () => null }))
vi.mock('../../components/MagnitudeFilter', () => ({ default: () => null }))

beforeEach(() => {
  dashboardState.mapOverlays = []
  dashboardState.weatherAlerts = [warning]
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ExecutiveOverview official warning navigation', () => {
  it('clears external focus on ordinary selection and honors a repeated focus nonce', async () => {
    const onFocusCleared = vi.fn()
    const { rerender } = render(
      <ExecutiveOverview
        initialOfficialAlertFocus={{ id: 'warning-1', nonce: 1 }}
        onOfficialAlertFocusCleared={onFocusCleared}
      />,
    )

    await waitFor(() => expect(screen.getByTestId('map-focus').textContent).toBe('warning-1:1'))
    expect(onFocusCleared).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Pilih event biasa' }))
    expect(screen.getByTestId('map-focus').textContent).toBe('none')
    expect(onFocusCleared).toHaveBeenCalledTimes(2)

    rerender(
      <ExecutiveOverview
        initialOfficialAlertFocus={{ id: 'warning-1', nonce: 2 }}
        onOfficialAlertFocusCleared={onFocusCleared}
      />,
    )
    await waitFor(() => expect(screen.getByTestId('map-focus').textContent).toBe('warning-1:2'))
  })

  it('keeps focus when the warning exists only in the complete map overlays response', async () => {
    dashboardState.weatherAlerts = []
    dashboardState.mapOverlays = [overlay()]

    render(
      <ExecutiveOverview
        initialOfficialAlertFocus={{ id: 'warning-1', nonce: 7 }}
        onOfficialAlertFocusCleared={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByTestId('map-focus').textContent).toBe('warning-1:7'))
  })

  it('clears parent and local focus when the complete overlay is already expired', async () => {
    dashboardState.weatherAlerts = []
    dashboardState.mapOverlays = [overlay({ expires_at: '2020-01-01T00:00:00Z' })]
    const onFocusCleared = vi.fn()

    render(
      <ExecutiveOverview
        initialOfficialAlertFocus={{ id: 'warning-1', nonce: 3 }}
        onOfficialAlertFocusCleared={onFocusCleared}
      />,
    )

    await waitFor(() => expect(screen.getByTestId('map-focus').textContent).toBe('none'))
    expect(onFocusCleared).toHaveBeenCalled()
  })
})
