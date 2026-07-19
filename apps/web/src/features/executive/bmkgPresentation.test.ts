import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type {
  AirQualityObservation,
  AirQualityObservationsResponse,
  MapOverlay,
  OfficialAlert,
} from '../../lib/api/client'
import { overlayPolygons } from '../../components/RiskMap'
import BmkgWarningsPanel from './BmkgWarningsPanel'
import type { BmkgEndpointStatuses } from './useBmkgWarnings'
import {
  categoryRank,
  filterActiveOfficialAlerts,
  formatIndonesiaTime,
  formatTimeRemaining,
  lifecycleStatusText,
  safeBmkgSourceUrl,
  sortAirQualityObservations,
  sortOfficialAlerts,
  toOfficialAlertOverlays,
  unpackBmkgResults,
} from './bmkgPresentation'

afterEach(cleanup)

function officialAlert(overrides: Partial<OfficialAlert>): OfficialAlert {
  return {
    id: 'alert-1',
    source: 'bmkg_cap',
    source_alert_id: 'source-alert-1',
    revision: 1,
    message_type: 'alert',
    status: 'active',
    sent_at: '2026-07-15T04:00:00Z',
    effective_at: null,
    expires_at: null,
    peril_type: 'weather',
    severity: 'Moderate',
    category: null,
    headline: 'Peringatan cuaca',
    description: null,
    area_name: null,
    area_geojson: null,
    latitude: null,
    longitude: null,
    source_url: null,
    ...overrides,
  }
}

function observation(overrides: Partial<AirQualityObservation>): AirQualityObservation {
  return {
    id: 'observation-1',
    source: 'bmkg',
    station_id: 'station-1',
    station_name: 'Kemayoran',
    latitude: -6.16,
    longitude: 106.84,
    pollutant: 'pm25',
    value: 18,
    unit: 'ug/m3',
    category: 'Baik',
    observed_at: '2026-07-15T04:00:00Z',
    source_url: null,
    stale: false,
    ingested_at: '2026-07-15T04:05:00Z',
    ...overrides,
  }
}

describe('BMKG presentation', () => {
  it('sorts severity before effective time without mutating the input', () => {
    const input = [
      officialAlert({ id: 'moderate', severity: 'Moderate', sent_at: '2026-07-15T10:00:00Z' }),
      officialAlert({ id: 'critical', severity: 'Critical', sent_at: '2026-07-15T09:00:00Z' }),
      officialAlert({ id: 'high-newer', severity: 'High', effective_at: '2026-07-15T11:00:00Z' }),
      officialAlert({ id: 'high-older', severity: 'High', effective_at: '2026-07-15T08:00:00Z' }),
    ]

    expect(sortOfficialAlerts(input).map((item) => item.id)).toEqual([
      'critical',
      'high-newer',
      'high-older',
      'moderate',
    ])
    expect(input.map((item) => item.id)).toEqual(['moderate', 'critical', 'high-newer', 'high-older'])
  })

  it('orders air quality categories from low to dangerous', () => {
    expect(categoryRank('Berbahaya')).toBeGreaterThan(categoryRank('Sedang'))
    expect(categoryRank('Tidak dikenal')).toBe(0)
  })

  it('sorts observations by category and then observation time', () => {
    const sorted = sortAirQualityObservations([
      observation({ id: 'good', category: 'Baik' }),
      observation({ id: 'unhealthy-old', category: 'Tidak Sehat', observed_at: '2026-07-15T03:00:00Z' }),
      observation({ id: 'unhealthy-new', category: 'Tidak Sehat', observed_at: '2026-07-15T05:00:00Z' }),
    ])

    expect(sorted.map((item) => item.id)).toEqual(['unhealthy-new', 'unhealthy-old', 'good'])
  })

  it.each([
    ['Asia/Jakarta', 'WIB'],
    ['Asia/Makassar', 'WITA'],
    ['Asia/Jayapura', 'WIT'],
  ])('formats %s with %s', (timeZone, suffix) => {
    expect(formatIndonesiaTime('2026-07-15T04:00:00Z', timeZone)).toContain(suffix)
  })

  it('falls back to WIB and handles malformed timestamps', () => {
    expect(formatIndonesiaTime('2026-07-15T04:00:00Z', 'UTC')).toContain('WIB')
    expect(formatIndonesiaTime('not-a-date')).toBe('Waktu tidak tersedia')
  })

  it('filters cancelled, expired, and locally elapsed alerts', () => {
    const now = new Date('2026-07-15T05:00:00Z').getTime()
    const active = officialAlert({ id: 'active', expires_at: '2026-07-15T06:00:00Z' })
    const noExpiry = officialAlert({ id: 'no-expiry' })
    const elapsed = officialAlert({ id: 'elapsed', expires_at: '2026-07-15T04:59:59Z' })
    const cancelled = officialAlert({ id: 'cancelled', status: 'cancelled' })
    const updated = officialAlert({ id: 'updated', status: 'updated' })
    const future = officialAlert({
      id: 'future',
      effective_at: '2026-07-15T05:00:01Z',
      expires_at: '2026-07-15T07:00:00Z',
    })

    expect(filterActiveOfficialAlerts(
      [active, noExpiry, elapsed, cancelled, updated, future],
      now,
    ).map((alert) => alert.id)).toEqual(['active', 'no-expiry'])
  })

  it('formats lifecycle and remaining time safely', () => {
    const now = new Date('2026-07-15T05:00:00Z').getTime()
    expect(lifecycleStatusText(officialAlert({ expires_at: '2026-07-15T05:45:00Z' }), now, false))
      .toBe('Aktif · segera berakhir')
    expect(lifecycleStatusText(officialAlert({ expires_at: null }), now, true))
      .toBe('Status aktif belum terkonfirmasi')
    expect(formatTimeRemaining('2026-07-15T06:30:00Z', now)).toBe('1 jam 30 menit tersisa')
    expect(formatTimeRemaining('2026-07-15T05:00:30Z', now)).toBe('< 1 menit tersisa')
    expect(formatTimeRemaining(null, now)).toBe('Waktu berakhir tidak tersedia')
    expect(formatTimeRemaining('not-a-time', now)).toBe('Waktu berakhir tidak tersedia')
  })

  it.each([
    ['https://www.bmkg.go.id/cuaca/peringatan-dini-cuaca', true],
    ['https://iklim.bmkg.go.id/id/kualitas-udara/', true],
    ['http://www.bmkg.go.id/cuaca', false],
    ['https://bmkg.go.id.evil.example/cuaca', false],
    ['not-a-url', false],
  ])('validates trusted BMKG source URL %s', (value, trusted) => {
    expect(safeBmkgSourceUrl(value)).toBe(trusted ? value : null)
  })

  it('converts geocoded alerts into official map overlays', () => {
    const polygon = {
      type: 'Polygon' as const,
      coordinates: [[[106.7, -6.3], [107.0, -6.3], [107.0, -6.0], [106.7, -6.3]]],
    }
    const overlays = toOfficialAlertOverlays([
      officialAlert({ id: 'polygon', area_geojson: polygon, area_name: 'Jawa Barat' }),
      officialAlert({ id: 'point', latitude: -6.2, longitude: 106.8, headline: null }),
      officialAlert({ id: 'unmapped' }),
    ])

    expect(overlays).toHaveLength(2)
    expect(overlays[0]).toMatchObject({
      id: 'polygon',
      layer_class: 'official',
      geometry: polygon,
      attribution: 'BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)',
    })
    expect(overlays[1]).toMatchObject({
      id: 'point',
      label: 'Peringatan resmi BMKG',
      latitude: -6.2,
      longitude: 106.8,
    })
  })

  it('retains fulfilled BMKG sources when another source fails', () => {
    const weather = [officialAlert({ id: 'weather-success' })]
    const observationsResponse: AirQualityObservationsResponse = {
      data: [observation({ id: 'observation-success' })],
      meta: { count: 1, limit: 50, latest: true, source_active: true },
    }
    const result = unpackBmkgResults([
      { status: 'fulfilled', value: weather },
      { status: 'rejected', reason: new Error('air alerts unavailable') },
      { status: 'fulfilled', value: observationsResponse },
    ])

    expect(result.weatherAlerts).toEqual(weather)
    expect(result.airQualityAlerts).toBeUndefined()
    expect(result.observationsResponse).toEqual(observationsResponse)
    expect(result.errors).toEqual({ air_quality: 'Error: air alerts unavailable' })
  })

  it('converts polygon and multipolygon coordinates for Leaflet bounds', () => {
    const polygon = {
      id: 'polygon',
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[106.7, -6.3], [107, -6.3], [106.7, -6.3]]],
      },
    } as MapOverlay
    const multiPolygon = {
      id: 'multi-polygon',
      geometry: {
        type: 'MultiPolygon' as const,
        coordinates: [
          [[[110, -7], [111, -7], [110, -7]]],
          [[[120, -2], [121, -2], [120, -2]]],
        ],
      },
    } as MapOverlay

    expect(overlayPolygons(polygon)).toEqual([[[-6.3, 106.7], [-6.3, 107], [-6.3, 106.7]]])
    expect(overlayPolygons(multiPolygon)).toHaveLength(2)
    expect(overlayPolygons({ ...polygon, geometry: null })).toEqual([])
  })
})

describe('BmkgWarningsPanel', () => {
  function renderPanel(overrides: Record<string, unknown> = {}) {
    const onFocusAlert = vi.fn()
    const onRetry = vi.fn()
    const props = {
      weatherAlerts: [] as OfficialAlert[],
      airQualityAlerts: [] as OfficialAlert[],
      observations: [] as AirQualityObservation[],
      sourceActive: true,
      loading: false,
      errors: {} as Record<string, string>,
      status: {
        weather: { loaded: true, uncertain: false },
        air_quality: { loaded: true, uncertain: false },
        observations: { loaded: true, uncertain: false },
      } satisfies BmkgEndpointStatuses,
      now: new Date('2026-07-15T05:00:00Z').getTime(),
      onFocusAlert,
      onRetry,
      ...overrides,
    }
    return { ...render(createElement(BmkgWarningsPanel, props)), onFocusAlert, onRetry }
  }

  it('renders accessible segmented controls and focuses a mapped weather alert', () => {
    const alert = officialAlert({
      id: 'weather-map-alert',
      headline: 'Hujan lebat disertai petir',
      area_name: 'Jawa Barat',
      severity: 'High',
      latitude: -6.9,
      longitude: 107.6,
      source_url: 'https://www.bmkg.go.id/cuaca/peringatan-dini-cuaca',
    })
    const { onFocusAlert } = renderPanel({ weatherAlerts: [alert] })

    expect(screen.getByRole('tab', { name: 'Cuaca Ekstrem' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Kualitas Udara' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByLabelText('Tingkat keparahan High').textContent).toContain('High')
    expect(screen.getByLabelText('1 peringatan cuaca aktif').textContent).toBe('1')
    expect(screen.getByText('Aktif')).not.toBeNull()
    expect(screen.getByText('Waktu berakhir tidak tersedia')).not.toBeNull()

    const source = screen.getByRole('link', { name: 'Sumber BMKG' })
    expect(source.getAttribute('target')).toBe('_blank')
    expect(source.getAttribute('rel')).toBe('noopener noreferrer')

    fireEvent.click(screen.getByRole('button', { name: 'Fokuskan Hujan lebat disertai petir di peta' }))
    expect(onFocusAlert).toHaveBeenCalledWith('weather-map-alert')
  })

  it('shows official air alerts before observations and explains an inactive source', () => {
    const airAlert = officialAlert({
      id: 'air-alert',
      peril_type: 'air_quality',
      category: 'Berbahaya',
      severity: 'Critical',
      headline: 'Peringatan kualitas udara resmi',
      source: 'bmkg_air_quality',
      latitude: -6.2,
      longitude: 106.8,
    })
    const staleObservation = observation({
      id: 'stale-observation',
      station_name: 'Jakarta Kemayoran',
      category: 'Tidak Sehat',
      stale: true,
    })
    const { container } = renderPanel({
      airQualityAlerts: [airAlert],
      observations: [staleObservation],
      sourceActive: false,
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Kualitas Udara' }))

    expect(screen.getByText('Integrasi kualitas udara BMKG belum aktif')).not.toBeNull()
    const officialInfo = screen.getByRole('link', { name: 'Lihat informasi PM2.5 BMKG' })
    expect(officialInfo.getAttribute('target')).toBe('_blank')
    expect(officialInfo.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByLabelText('Kategori kualitas udara Berbahaya').textContent).toContain('Berbahaya')
    expect(screen.getByLabelText('Kategori kualitas udara Tidak Sehat').textContent).toContain('Tidak Sehat')
    expect(screen.getByText('Data terlambat')).not.toBeNull()

    const content = container.textContent ?? ''
    expect(content.indexOf('Peringatan kualitas udara resmi')).toBeLessThan(
      content.indexOf('Jakarta Kemayoran'),
    )
  })

  it('keeps successful rows visible beside a tab error and retries', () => {
    const { onRetry } = renderPanel({
      weatherAlerts: [officialAlert({ headline: 'Peringatan yang berhasil dimuat' })],
      errors: { weather: 'network unavailable' },
    })

    expect(screen.getByText('Peringatan yang berhasil dimuat')).not.toBeNull()
    expect(screen.getByText('Gagal memuat sebagian data cuaca BMKG.')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('shows unknown source status after an initial observation failure without a confirmed empty state', () => {
    renderPanel({
      sourceActive: null,
      errors: { observations: 'network unavailable' },
      status: {
        weather: { loaded: true, uncertain: false },
        air_quality: { loaded: true, uncertain: false },
        observations: { loaded: false, uncertain: false },
      } satisfies BmkgEndpointStatuses,
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Kualitas Udara' }))
    const panel = screen.getByRole('tabpanel')

    expect(within(panel).getByText('Status integrasi kualitas udara BMKG belum diketahui')).not.toBeNull()
    expect(within(panel).queryByText('Integrasi kualitas udara BMKG belum aktif')).toBeNull()
    expect(within(panel).queryByText('Tidak ada peringatan aktif.')).toBeNull()
  })

  it('keeps cached retry rows visible and marks their lifecycle uncertain', () => {
    renderPanel({
      weatherAlerts: [officialAlert({ headline: 'Peringatan tersimpan' })],
      errors: { weather: 'refresh failed' },
      status: {
        weather: { loaded: true, uncertain: true },
        air_quality: { loaded: true, uncertain: false },
        observations: { loaded: true, uncertain: false },
      } satisfies BmkgEndpointStatuses,
    })

    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByText('Peringatan tersimpan')).not.toBeNull()
    expect(within(panel).getByText('Status aktif belum terkonfirmasi')).not.toBeNull()
    expect(within(panel).queryByText('Tidak ada peringatan aktif.')).toBeNull()
  })

  it('does not present a cached inactive source status as current after refresh failure', () => {
    renderPanel({
      sourceActive: false,
      errors: { observations: 'refresh failed' },
      status: {
        weather: { loaded: true, uncertain: false },
        air_quality: { loaded: true, uncertain: false },
        observations: { loaded: true, uncertain: true },
      } satisfies BmkgEndpointStatuses,
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Kualitas Udara' }))
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByText(
      'Status terakhir: integrasi kualitas udara BMKG belum aktif; status terbaru belum diketahui',
    )).not.toBeNull()
    expect(within(panel).queryByText('Integrasi kualitas udara BMKG belum aktif')).toBeNull()
  })

  it('defensively removes locally expired and cancelled rows', () => {
    renderPanel({
      weatherAlerts: [
        officialAlert({ id: 'expired', headline: 'Sudah lewat', expires_at: '2026-07-15T04:00:00Z' }),
        officialAlert({ id: 'cancelled', headline: 'Sudah dibatalkan', status: 'cancelled' }),
      ],
    })

    const panel = screen.getByRole('tabpanel')
    expect(within(panel).queryByText('Sudah lewat')).toBeNull()
    expect(within(panel).queryByText('Sudah dibatalkan')).toBeNull()
    expect(within(panel).getByText('Tidak ada peringatan aktif.')).not.toBeNull()
  })

  it('uses unique persistent shared-grid tab panels and roving keyboard focus', () => {
    const first = renderPanel()
    const firstTabs = Array.from(first.container.querySelectorAll<HTMLElement>('[role="tab"]'))
    const firstPanels = Array.from(first.container.querySelectorAll<HTMLElement>('[role="tabpanel"]'))
    expect(firstPanels).toHaveLength(2)
    expect(firstPanels[0].hidden).toBe(false)
    expect(firstPanels[1].hidden).toBe(false)
    expect(firstPanels[0].parentElement?.classList.contains('grid')).toBe(true)
    for (const panel of firstPanels) {
      expect(panel.classList.contains('col-start-1')).toBe(true)
      expect(panel.classList.contains('row-start-1')).toBe(true)
    }
    expect(firstPanels[1].getAttribute('aria-hidden')).toBe('true')
    expect(firstPanels[1].hasAttribute('inert')).toBe(true)
    expect(firstTabs[0].tabIndex).toBe(0)
    expect(firstTabs[1].tabIndex).toBe(-1)
    expect(firstTabs[0].getAttribute('aria-controls')).toBe(firstPanels[0].id)
    expect(firstPanels[0].getAttribute('aria-labelledby')).toBe(firstTabs[0].id)

    fireEvent.keyDown(firstTabs[0], { key: 'ArrowRight' })
    expect(firstTabs[1].getAttribute('aria-selected')).toBe('true')
    expect(firstTabs[1].tabIndex).toBe(0)
    expect(document.activeElement).toBe(firstTabs[1])

    fireEvent.keyDown(firstTabs[1], { key: 'Home' })
    expect(document.activeElement).toBe(firstTabs[0])
    fireEvent.keyDown(firstTabs[0], { key: 'End' })
    expect(document.activeElement).toBe(firstTabs[1])
    fireEvent.keyDown(firstTabs[1], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(firstTabs[0])
    fireEvent.keyDown(firstTabs[0], { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(firstTabs[1])

    const firstIds = new Set([...firstTabs, ...firstPanels].map((element) => element.id))
    const second = renderPanel()
    const secondIds = Array.from(second.container.querySelectorAll<HTMLElement>('[role="tab"], [role="tabpanel"]'))
      .map((element) => element.id)
    expect(secondIds.every((id) => !firstIds.has(id))).toBe(true)
  })

  it('keeps the full BMKG attribution wrapping at narrow widths', () => {
    const { container } = renderPanel()
    const attribution = screen.getByText('BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)')
    expect(attribution.className).toContain('whitespace-normal')
    expect(attribution.className).toContain('break-words')
    expect(attribution.className).not.toContain('truncate')
    expect(container.textContent).toContain('BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)')
  })

  it('renders stable loading and empty states', () => {
    const loadingView = renderPanel({ loading: true })
    const status = screen.getByRole('status', { name: 'Memuat peringatan BMKG' })
    expect(status.style.minHeight).toBe('18rem')
    expect(loadingView.container.querySelectorAll('[data-skeleton-row="true"]')).toHaveLength(6)

    loadingView.unmount()
    renderPanel()
    expect(within(screen.getByRole('tabpanel')).getByText('Tidak ada peringatan aktif.')).not.toBeNull()
  })
})
