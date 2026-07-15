import { describe, expect, it } from 'vitest'
import {
  filterBmkgActiveWarnings,
  type EWSActiveWarning,
} from './ews'

function warning(overrides: Partial<EWSActiveWarning> = {}): EWSActiveWarning {
  return {
    id: 'warning-1',
    source: 'bmkg_cap',
    message_type: 'alert',
    status: 'active',
    sent_at: '2026-07-15T04:00:00Z',
    peril_type: 'weather',
    severity: 'High',
    expires_at: '2026-07-15T06:00:00Z',
    matched_watch_zone_ids: ['zone-1'],
    matched_watch_zone_labels: ['Rumah'],
    ...overrides,
  }
}

describe('BMKG active-warning boundary', () => {
  it('keeps only active, unexpired BMKG warning sources', () => {
    const now = new Date('2026-07-15T05:00:00Z').getTime()
    const untrusted = {
      ...warning({ id: 'other-source' }),
      source: 'other_official',
    } as unknown as EWSActiveWarning

    expect(filterBmkgActiveWarnings([
      warning({ id: 'cap' }),
      warning({ id: 'air', source: 'bmkg_air_quality', peril_type: 'air_quality' }),
      warning({ id: 'cancel-message', message_type: 'cancel' }),
      warning({ id: 'inactive-status', status: 'updated' }),
      warning({ id: 'expired', expires_at: '2026-07-15T05:00:00Z' }),
      untrusted,
    ], now).map((item) => item.id)).toEqual(['cap', 'air'])
  })
})
