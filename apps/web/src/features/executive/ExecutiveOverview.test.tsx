import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExecutiveOverview from './ExecutiveOverview'

const { event, dashboardState, operationalMapState } = vi.hoisted(() => {
  const event = {
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
  }
  return {
    event,
    dashboardState: {
      events: [event],
      mapOverlays: [] as Array<Record<string, unknown>>,
      weatherAlerts: [] as Array<Record<string, unknown>>,
      mapEngine: 'leaflet' as 'leaflet' | 'maplibre',
      session: { user: { id: 'user-1' } } as object | null,
    },
    operationalMapState: { props: {} as Record<string, unknown> },
  }
})

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
  getEvents: vi.fn(() => Promise.resolve(dashboardState.events)),
  getMapOverlays: vi.fn(() => Promise.resolve(dashboardState.mapOverlays)),
  getMeta: vi.fn().mockResolvedValue({ service: 'api', environment: 'test', version: '1' }),
  getNews: vi.fn().mockResolvedValue([]),
  getRiskScores: vi.fn().mockResolvedValue({ data: [], meta: { count: 0, limit: 0 } }),
}))
vi.mock('../../config/mapEngine', () => ({
  getOperationalMapEngine: () => dashboardState.mapEngine,
}))
vi.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ session: dashboardState.session }),
}))
vi.mock('../map/OperationalMap', () => ({
  default: (props: {
    authenticated?: boolean
    initialLayers?: string[]
    perils?: string[]
    visibleLayers?: string[]
    privateOwnerKey?: string
  }) => {
    operationalMapState.props = props
    return (
      <div
        data-testid="operational-map"
        data-authenticated={String(Boolean(props.authenticated))}
        data-owner={props.privateOwnerKey}
        data-layers={(props.visibleLayers ?? props.initialLayers)?.join(',')}
        data-perils={props.perils?.join(',')}
      />
    )
  },
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
vi.mock('./BmkgWarningsPanel', () => ({
  default: ({ onFocusAlert }: { onFocusAlert: (id: string) => void }) => (
    <button type="button" onClick={() => onFocusAlert('warning-1')}>Pilih warning resmi</button>
  ),
}))
vi.mock('./LiveVideoDesk', () => ({ default: () => null }))
vi.mock('../../components/NewsPanel', () => ({ default: () => null }))
vi.mock('../../components/SourceBadge', () => ({ default: () => null }))
vi.mock('../../components/MagnitudeFilter', () => ({ default: () => null }))

beforeEach(() => {
  dashboardState.events = [event]
  dashboardState.mapOverlays = []
  dashboardState.weatherAlerts = [warning]
  dashboardState.mapEngine = 'leaflet'
  dashboardState.session = { user: { id: 'user-1' } }
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
  it('keeps the existing Leaflet risk map as the default engine', async () => {
    render(<ExecutiveOverview onOfficialAlertFocusCleared={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'Pilih event biasa' })).toBeTruthy()
    expect(screen.queryByTestId('operational-map')).toBeNull()
  })

  it('uses the operational map only for the MapLibre flag and gates private layers on session', async () => {
    dashboardState.mapEngine = 'maplibre'
    const { rerender } = render(<ExecutiveOverview onOfficialAlertFocusCleared={vi.fn()} />)

    const operationalMap = await screen.findByTestId('operational-map')
    expect(operationalMap.getAttribute('data-authenticated')).toBe('true')
    expect(operationalMap.getAttribute('data-owner')).toBe('user-1')
    expect(operationalMap.getAttribute('data-layers')).toBe('events,official-alerts,air-quality')
    expect(operationalMap.getAttribute('data-perils')).toBe('')
    expect(screen.queryByRole('button', { name: 'Pilih event biasa' })).toBeNull()

    dashboardState.session = null
    rerender(<ExecutiveOverview onOfficialAlertFocusCleared={vi.fn()} />)
    expect(screen.getByTestId('operational-map').getAttribute('data-authenticated')).toBe('false')
  })

  it('drives MapLibre event requests from the existing executive peril selection', async () => {
    dashboardState.mapEngine = 'maplibre'
    dashboardState.events = [{ ...event, source: 'BMKG' }]
    render(<ExecutiveOverview onOfficialAlertFocusCleared={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Fokuskan di peta' }))

    expect(screen.getByTestId('operational-map').getAttribute('data-perils')).toBe('earthquake')
    expect((operationalMapState.props.focusRequest as { id: string }).id).toBe('BMKG:source-event-1')
  })

  it('adapts source-qualified map feature IDs and warning actions into controlled focus requests', async () => {
    dashboardState.mapEngine = 'maplibre'
    render(<ExecutiveOverview onOfficialAlertFocusCleared={vi.fn()} />)
    await screen.findByTestId('operational-map')

    act(() => {
      ;(operationalMapState.props.onFeatureSelect as (feature: Record<string, unknown>) => void)({
        type: 'Feature',
        id: 'usgs:source-event-1',
        geometry: { type: 'Point', coordinates: [106.8, -6.2] },
        properties: {
          id: 'usgs:source-event-1', layer: 'events', label: 'Jakarta', source: 'usgs', attribution: 'USGS', verification_status: 'source-reported',
        },
      })
    })
    expect((operationalMapState.props.focusRequest as { id: string }).id).toBe('usgs:source-event-1')

    fireEvent.click(screen.getByRole('button', { name: 'Pilih warning resmi' }))
    expect((operationalMapState.props.focusRequest as { id: string }).id).toBe('bmkg_cap:source-warning-1')
  })

  it('exposes every Executive map control and applies it to MapLibre layers', async () => {
    dashboardState.mapEngine = 'maplibre'
    dashboardState.mapOverlays = [overlay({
      id: 'static-risk-1',
      layer_class: 'static_risk',
      geometry: {
        type: 'Polygon',
        coordinates: [[[106.7, -6.3], [106.9, -6.3], [106.9, -6.1], [106.7, -6.3]]],
      },
    })]
    render(<ExecutiveOverview onOfficialAlertFocusCleared={vi.fn()} />)
    await screen.findByTestId('operational-map')

    const filters = [
      ['Semua', []],
      ['Gempa', ['earthquake']],
      ['Karhutla', ['wildfire']],
      ['Vulkanik', ['volcano']],
      ['Banjir', ['flood']],
      ['News', []],
    ] as const
    for (const [name, expectedPerils] of filters) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }))
      expect(operationalMapState.props.perils).toEqual(expectedPerils)
      if (name === 'News') expect(operationalMapState.props.visibleLayers).not.toContain('events')
      else expect(operationalMapState.props.visibleLayers).toContain('events')
    }
    fireEvent.click(screen.getByRole('button', { name: /^Semua/ }))
    expect(operationalMapState.props.perils).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Warning resmi' }))
    expect(operationalMapState.props.visibleLayers).not.toContain('official-alerts')
    fireEvent.click(screen.getByRole('button', { name: 'Watch zone' }))
    expect(operationalMapState.props.privateLayers).toEqual(['personal-assets'])
    expect((operationalMapState.props.localOverlay as GeoJSON.FeatureCollection).features).toEqual([
      expect.objectContaining({ id: 'static-risk-1' }),
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Kajian risiko' }))
    expect((operationalMapState.props.localOverlay as GeoJSON.FeatureCollection).features).toEqual([])

    fireEvent.change(screen.getByRole('slider', { name: 'Waktu lifecycle peta' }), { target: { value: '24' } })
    expect(typeof operationalMapState.props.mapTime).toBe('string')
  })

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

describe('ExecutiveOverview BMKG earthquake provenance', () => {
  it('does not label a source that only contains bmkg as official', async () => {
    dashboardState.events = [{
      ...event,
      id: 'seed-event',
      event_id: 'seed-id:regional-demo',
      source: 'seed-bmkg',
    }]

    render(
      <ExecutiveOverview
        onOfficialAlertFocusCleared={vi.fn()}
      />,
    )

    expect(await screen.findByText('Belum ada event gempa BMKG pada data aktif.')).toBeTruthy()
    expect(screen.queryByText('Gempa Terbaru BMKG')).toBeNull()
  })

  it('accepts the normalized production BMKG source', async () => {
    dashboardState.events = [{ ...event, source: ' BMKG ' }]

    render(
      <ExecutiveOverview
        onOfficialAlertFocusCleared={vi.fn()}
      />,
    )

    expect(await screen.findByText('Gempa Terbaru BMKG')).toBeTruthy()
  })
})
