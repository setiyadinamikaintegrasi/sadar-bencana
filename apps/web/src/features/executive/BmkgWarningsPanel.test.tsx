import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OfficialAlert } from '../../lib/api/client'
import BmkgWarningsPanel from './BmkgWarningsPanel'

function alert(overrides: Partial<OfficialAlert> = {}): OfficialAlert {
  return {
    id: 'warning-1',
    source: 'bmkg_cap',
    source_alert_id: 'source-warning-1',
    revision: 1,
    message_type: 'alert',
    status: 'active',
    sent_at: '2026-07-15T04:00:00Z',
    effective_at: null,
    expires_at: '2027-07-15T06:00:00Z',
    peril_type: 'weather',
    severity: 'High',
    category: null,
    headline: 'Peringatan hujan lebat',
    description: 'Peringatan cuaca dengan rincian panjang untuk memverifikasi tinggi panel tidak bergantung pada tab aktif.',
    area_name: 'Jawa Barat',
    area_geojson: null,
    latitude: -6.9,
    longitude: 107.6,
    source_url: 'https://www.bmkg.go.id/cuaca/peringatan-dini-cuaca',
    ...overrides,
  }
}

function renderPanel() {
  return render(
    <BmkgWarningsPanel
      weatherAlerts={[alert()]}
      airQualityAlerts={[alert({
        id: 'air-warning-1',
        source: 'bmkg_air_quality',
        source_alert_id: 'source-air-warning-1',
        peril_type: 'air_quality',
        headline: 'Kualitas udara tidak sehat',
      })]}
      observations={[]}
      sourceActive={false}
      loading={false}
      errors={{}}
      status={{
        weather: { loaded: true, uncertain: false },
        air_quality: { loaded: true, uncertain: false },
        observations: { loaded: true, uncertain: false },
      }}
      now={new Date('2026-07-15T05:00:00Z').getTime()}
      onFocusAlert={vi.fn()}
      onRetry={vi.fn()}
    />,
  )
}

afterEach(cleanup)

describe('BmkgWarningsPanel', () => {
  it('keeps tab contents in a shared grid cell and makes inactive controls inert', () => {
    renderPanel()

    const weatherTab = screen.getByRole('tab', { name: 'Cuaca Ekstrem' })
    const airTab = screen.getByRole('tab', { name: 'Kualitas Udara' })
    const weatherPanel = document.getElementById(weatherTab.getAttribute('aria-controls') ?? '')
    const airPanel = document.getElementById(airTab.getAttribute('aria-controls') ?? '')

    expect(weatherPanel).not.toBeNull()
    expect(airPanel).not.toBeNull()
    expect(weatherPanel?.parentElement?.classList.contains('grid')).toBe(true)
    for (const panel of [weatherPanel, airPanel]) {
      expect(panel?.classList.contains('col-start-1')).toBe(true)
      expect(panel?.classList.contains('row-start-1')).toBe(true)
      expect(panel?.hidden).toBe(false)
    }

    expect(airPanel?.getAttribute('aria-hidden')).toBe('true')
    expect(airPanel?.hasAttribute('inert')).toBe(true)
    expect(airPanel?.classList.contains('invisible')).toBe(true)
    expect(airPanel?.classList.contains('pointer-events-none')).toBe(true)
    expect(Array.from(airPanel?.querySelectorAll('a') ?? []).every((link) => link.tabIndex === -1)).toBe(true)
    expect(Array.from(airPanel?.querySelectorAll('button') ?? []).every((button) => button.disabled)).toBe(true)

    fireEvent.click(airTab)

    expect(weatherPanel?.getAttribute('aria-hidden')).toBe('true')
    expect(weatherPanel?.hasAttribute('inert')).toBe(true)
    expect(Array.from(weatherPanel?.querySelectorAll('a') ?? []).every((link) => link.tabIndex === -1)).toBe(true)
    expect(Array.from(weatherPanel?.querySelectorAll('button') ?? []).every((button) => button.disabled)).toBe(true)
    expect(airPanel?.getAttribute('aria-hidden')).toBe('false')
    expect(airPanel?.hasAttribute('inert')).toBe(false)
  })
})
