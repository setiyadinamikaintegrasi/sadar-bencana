import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activateOfficialSource,
  getConnectorHealth,
  getOfficialSourceHistory,
  getOfficialSourceSettings,
  type OfficialSourceHistory,
  type OfficialSourceSetting,
} from '../../lib/api/client'
import OfficialSourcesSettingsPage from './OfficialSourcesSettingsPage'

vi.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({
    session: { user: { email: 'admin@example.test' } },
    loading: false,
    signOut: vi.fn(),
  }),
}))

vi.mock('../../lib/api/client', () => ({
  activateOfficialSource: vi.fn(),
  dryRunOfficialSource: vi.fn(),
  getConnectorHealth: vi.fn(),
  getOfficialSourceHistory: vi.fn(),
  getOfficialSourceSettings: vi.fn(),
  previewOfficialSource: vi.fn(),
  previewBMKGDataOnlineWorkbook: vi.fn(),
  rollbackOfficialSource: vi.fn(),
  testOfficialSource: vi.fn(),
  updateOfficialSourceSetting: vi.fn(),
}))

const activateSource = vi.mocked(activateOfficialSource)
const fetchHealth = vi.mocked(getConnectorHealth)
const fetchHistory = vi.mocked(getOfficialSourceHistory)
const fetchSettings = vi.mocked(getOfficialSourceSettings)

function setting(overrides: Partial<OfficialSourceSetting> = {}): OfficialSourceSetting {
  return {
    source_name: 'bmkg_air_quality',
    display_name: 'BMKG Kualitas Udara',
    enabled: true,
    run_mode: 'dry_run',
    mode: 'custom_api',
    adapter_version: 'v1',
    field_mapping: {},
    config_version: 4,
    default_api_url: null,
    custom_api_url: 'https://data.bmkg.go.id/air-quality.json',
    has_api_token: true,
    attribution: 'BMKG',
    terms_url: null,
    poll_interval_seconds: 3600,
    expected_interval_seconds: 3600,
    notes: 'Approved machine-readable feed.',
    last_dry_run_at: '2026-07-15T04:02:00Z',
    last_dry_run_valid: true,
    updated_at: '2026-07-15T04:00:00Z',
    ...overrides,
  }
}

function history(overrides: Partial<OfficialSourceHistory> = {}): OfficialSourceHistory {
  return {
    versions: [],
    audit: [{
      action: 'dry_run',
      actor_email: 'worker@sadarbencana.local',
      config_version: 4,
      success: true,
      metadata: {
        stage: 'worker_shadow',
        zero_persistence: true,
        persistence_counts: {
          source_records: 0,
          disaster_observability_events: 0,
          official_alerts: 0,
          air_quality_observations: 0,
          ews_notification_log: 0,
        },
      },
      created_at: '2026-07-15T04:05:00Z',
    }],
    ...overrides,
  }
}

beforeEach(() => {
  fetchSettings.mockResolvedValue([setting()])
  fetchHistory.mockResolvedValue(history())
  fetchHealth.mockResolvedValue([{
    name: 'bmkg_air_quality',
    status: 'ok',
    last_polled_at: '2026-07-15T04:05:00Z',
    items_fetched: 2,
    error_message: null,
    threshold_seconds: 7200,
    updated_at: '2026-07-15T04:05:00Z',
  }])
  activateSource.mockResolvedValue()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('official source activation approval', () => {
  it('keeps activation disabled until readiness is verified and both approval fields are present', async () => {
    render(<OfficialSourcesSettingsPage />)

    const activateButton = await screen.findByRole('button', { name: 'Aktifkan' })
    await waitFor(() => expect(fetchHistory).toHaveBeenCalledWith('bmkg_air_quality'))
    expect(activateButton.hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByLabelText('Referensi persetujuan'), {
      target: { value: 'CHG-2026-0715' },
    })
    expect(activateButton.hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByLabelText('Catatan persetujuan'), {
      target: { value: 'Sudah disetujui setelah verifikasi shadow.' },
    })
    expect(activateButton.hasAttribute('disabled')).toBe(false)
  })

  it('remains fail-closed when current-version worker-shadow evidence is missing', async () => {
    fetchHistory.mockResolvedValue(history({ audit: [] }))
    render(<OfficialSourcesSettingsPage />)

    const activateButton = await screen.findByRole('button', { name: 'Aktifkan' })
    fireEvent.change(screen.getByLabelText('Referensi persetujuan'), { target: { value: 'CHG-1' } })
    fireEvent.change(screen.getByLabelText('Catatan persetujuan'), { target: { value: 'Disetujui.' } })

    await waitFor(() => expect(fetchHistory).toHaveBeenCalled())
    expect(activateButton.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/Worker shadow current config belum terverifikasi/)).not.toBeNull()
  })

  it('trims and submits approval metadata only after all readiness checks pass', async () => {
    render(<OfficialSourcesSettingsPage />)

    const activateButton = await screen.findByRole('button', { name: 'Aktifkan' })
    fireEvent.change(screen.getByLabelText('Referensi persetujuan'), {
      target: { value: '  CHG-2026-0715  ' },
    })
    fireEvent.change(screen.getByLabelText('Catatan persetujuan'), {
      target: { value: '  Approved after worker shadow.  ' },
    })
    await waitFor(() => expect(activateButton.hasAttribute('disabled')).toBe(false))
    fireEvent.click(activateButton)

    await waitFor(() => expect(activateSource).toHaveBeenCalledWith('bmkg_air_quality', {
      approval_reference: 'CHG-2026-0715',
      approval_note: 'Approved after worker shadow.',
    }))
  })
})
