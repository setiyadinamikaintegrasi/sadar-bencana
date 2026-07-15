import { createElement } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getConnectorHealth, type ConnectorHealth } from '../../lib/api/client'
import SourceHealthPage, { HAZARD_CONNECTORS, connectorRowsForCategory } from './SourceHealthPage'

vi.mock('../../lib/api/client', () => ({
  getConnectorHealth: vi.fn(),
}))

const fetchHealth = vi.mocked(getConnectorHealth)

beforeEach(() => {
  fetchHealth.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function connector(overrides: Partial<ConnectorHealth> = {}): ConnectorHealth {
  return {
    name: 'bmkg_cap',
    status: 'error',
    last_polled_at: '2026-07-15T04:00:00Z',
    items_fetched: 7,
    error_message: 'Feed gagal',
    threshold_seconds: 300,
    updated_at: '2026-07-15T04:01:00Z',
    ...overrides,
  }
}

describe('source health official connector rows', () => {
  it('lists BMKG warning connectors without dropping existing hazard sources', () => {
    expect(HAZARD_CONNECTORS).toEqual([
      'bmkg',
      'bmkg_cap',
      'bmkg_air_quality',
      'usgs',
      'gdacs_fl',
      'gdacs_vo',
      'nasa_firms',
    ])
  })

  it('preserves real connector data and synthesizes only missing official connectors', () => {
    const realCap = connector()
    const realUsgs = connector({ name: 'usgs', status: 'ok', error_message: null })
    const rows = connectorRowsForCategory(
      ['bmkg_cap', 'bmkg_air_quality', 'usgs', 'missing_other'],
      new Map([
        [realCap.name, realCap],
        [realUsgs.name, realUsgs],
      ]),
    )

    expect(rows[0]).toBe(realCap)
    expect(rows[1]).toEqual({
      name: 'bmkg_air_quality',
      status: 'stale',
      last_polled_at: null,
      items_fetched: 0,
      error_message: 'Belum aktif',
      threshold_seconds: 0,
      updated_at: null,
    })
    expect(rows[2]).toBe(realUsgs)
    expect(rows.map((row) => row.name)).not.toContain('missing_other')
  })

  it('never replaces real inactive-source health with the synthetic fallback', () => {
    const realAirQuality = connector({
      name: 'bmkg_air_quality',
      status: 'ok',
      items_fetched: 19,
      error_message: null,
    })

    expect(connectorRowsForCategory(
      ['bmkg_air_quality'],
      new Map([[realAirQuality.name, realAirQuality]]),
    )).toEqual([realAirQuality])
  })

  it('labels the API synthesized zero/null/no-error row as not active', () => {
    const apiSynthesized = connector({
      name: 'bmkg_air_quality',
      status: 'stale',
      last_polled_at: null,
      items_fetched: 0,
      error_message: null,
      threshold_seconds: 7200,
      updated_at: null,
    })

    expect(connectorRowsForCategory(
      ['bmkg_air_quality'],
      new Map([[apiSynthesized.name, apiSynthesized]]),
    )).toEqual([{
      ...apiSynthesized,
      error_message: 'Belum aktif',
    }])
  })

  it('renders mobile connector rows as one divided unframed list', async () => {
    fetchHealth.mockResolvedValue([connector({ name: 'bmkg', status: 'ok', error_message: null })])

    render(createElement(SourceHealthPage))

    const list = await screen.findByRole('list', { name: 'Hazard connectors' })
    expect(list.className).toContain('divide-y')
    const items = within(list).getAllByRole('listitem')
    expect(items.length).toBeGreaterThan(0)
    items.forEach((item) => {
      expect(item.className).not.toMatch(/rounded|\bborder\b|\bbg-/)
    })
  })
})
