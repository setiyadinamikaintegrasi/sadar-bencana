import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../../lib/auth/AuthProvider'
import {
  createMyWatchZone,
  fetchMyChannelStatus,
  fetchMyNotifications,
  fetchMyPrefs,
  fetchMyProfile,
  fetchMyWatchZones,
  updateMyPref,
  type EWSNotificationPref,
} from '../../lib/api/ews'
import EwsPage from './EwsPage'

vi.mock('../../lib/auth/AuthProvider', () => ({ useAuth: vi.fn() }))
vi.mock('../../lib/api/ews', () => ({
  createMyWatchZone: vi.fn(),
  deleteMyWatchZone: vi.fn(),
  fetchMyChannelStatus: vi.fn(),
  fetchMyNotifications: vi.fn(),
  fetchMyPrefs: vi.fn(),
  fetchMyProfile: vi.fn(),
  fetchMyWatchZones: vi.fn(),
  testMyChannel: vi.fn(),
  updateMyPref: vi.fn(),
  updateMyProfile: vi.fn(),
}))
vi.mock('./ActiveWarningsTab', () => ({
  default: ({ onViewOnMap }: { onViewOnMap: (id: string) => void }) => (
    <div>
      Konten peringatan aktif
      <button type="button" onClick={() => onViewOnMap('warning-1')}>Lihat warning uji</button>
    </div>
  ),
}))
vi.mock('./WatchZoneMapPicker', () => ({
  default: ({ onChange }: { onChange: (lat: number, lon: number, radius: number) => void }) => (
    <button type="button" onClick={() => onChange(-6.2, 106.8, 75)}>Pilih titik uji</button>
  ),
}))

const auth = vi.mocked(useAuth)
const notifications = vi.mocked(fetchMyNotifications)
const prefs = vi.mocked(fetchMyPrefs)
const profile = vi.mocked(fetchMyProfile)
const channelStatus = vi.mocked(fetchMyChannelStatus)
const watchZones = vi.mocked(fetchMyWatchZones)
const createWatchZone = vi.mocked(createMyWatchZone)
const updatePref = vi.mocked(updateMyPref)

beforeEach(() => {
  auth.mockReturnValue({
    session: { user: { email: 'user@example.com' } } as never,
    loading: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
  })
  notifications.mockResolvedValue([])
  prefs.mockResolvedValue([])
  profile.mockResolvedValue({
    id: 'subscriber-1',
    name: 'User',
    email: 'user@example.com',
    telegram_chat_id: null,
    timezone: 'Asia/Jakarta',
    role: 'viewer',
    is_active: true,
    created_at: '2026-07-15T00:00:00Z',
  })
  channelStatus.mockResolvedValue([])
  watchZones.mockResolvedValue([])
  createWatchZone.mockResolvedValue({
    id: 'zone-created',
    subscriber_id: 'subscriber-1',
    label: 'Kantor',
    latitude: -6.2,
    longitude: 106.8,
    radius_km: 75,
    peril_types: ['weather', 'air_quality'],
    thresholds: {},
    is_active: true,
  })
  updatePref.mockImplementation(async (value) => value as EWSNotificationPref)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EwsPage', () => {
  it('opens Peringatan Aktif first and exposes linked, keyboard-operable tabs', async () => {
    render(<EwsPage onViewOnMap={vi.fn()} />)

    const tablist = screen.getByRole('tablist', { name: 'Navigasi Early Warning System' })
    const warningsTab = within(tablist).getByRole('tab', { name: 'Peringatan Aktif' })
    const zonesTab = within(tablist).getByRole('tab', { name: 'Watch Zones' })
    expect(warningsTab.getAttribute('aria-selected')).toBe('true')
    expect(warningsTab.getAttribute('tabindex')).toBe('0')
    expect(zonesTab.getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tabpanel').textContent).toContain('Konten peringatan aktif')
    const panels = screen.getAllByRole('tabpanel', { hidden: true })
    expect(panels).toHaveLength(4)
    for (const tab of within(tablist).getAllByRole('tab')) {
      const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '')
      expect(panel).not.toBeNull()
    }
    expect(panels.filter((panel) => panel.hidden)).toHaveLength(3)

    fireEvent.keyDown(warningsTab, { key: 'ArrowRight' })

    await waitFor(() => expect(zonesTab.getAttribute('aria-selected')).toBe('true'))
    expect(document.activeElement).toBe(zonesTab)
    expect(await screen.findByText('Belum ada watch zone.')).not.toBeNull()
  })

  it('forwards warning map actions to the app', () => {
    const onViewOnMap = vi.fn()
    render(<EwsPage onViewOnMap={onViewOnMap} />)

    fireEvent.click(screen.getByRole('button', { name: 'Lihat warning uji' }))

    expect(onViewOnMap).toHaveBeenCalledWith('warning-1')
  })

  it('offers weather and air-quality perils in watch zones and preferences', async () => {
    render(<EwsPage onViewOnMap={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Watch Zones' }))
    await screen.findByText('Belum ada watch zone.')
    fireEvent.click(screen.getByRole('button', { name: '+ Zona' }))
    expect(screen.getByRole('button', { name: 'weather' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'air_quality' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }))

    fireEvent.click(screen.getByRole('tab', { name: 'Preferences' }))
    await screen.findByText('Kontak saya')
    expect(screen.getAllByLabelText('weather')).toHaveLength(2)
    expect(screen.getAllByLabelText('air_quality')).toHaveLength(2)
  })

  it('renders enriched notification audit metadata and Indonesian delivery time', async () => {
    notifications.mockResolvedValue([{
      id: 'notification-1',
      subscriber_id: 'subscriber-1',
      alert_id: 'alert-1',
      channel: 'telegram',
      status: 'sent',
      error_message: null,
      sent_at: '2026-07-15T04:00:00Z',
      created_at: '2026-07-15T04:00:00Z',
      headline: 'Kualitas udara berbahaya',
      peril_type: 'air_quality',
      lifecycle_action: 'update',
      matched_watch_zone_label: 'Kantor Jakarta',
    }])
    render(<EwsPage onViewOnMap={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Notifikasi Saya' }))

    const row = await screen.findByRole('row', { name: /Kualitas udara berbahaya/ })
    expect(within(row).getByText('Kualitas Udara')).not.toBeNull()
    expect(within(row).getByText('Pembaruan')).not.toBeNull()
    expect(within(row).getByText('Watch zone: Kantor Jakarta')).not.toBeNull()
    expect(within(row).getByText(/WIB/)).not.toBeNull()
  })

  it('does not invent notification metadata when every enriched field is null', async () => {
    notifications.mockResolvedValue([{
      id: 'notification-null',
      subscriber_id: 'subscriber-1',
      alert_id: null,
      channel: 'telegram',
      status: 'failed',
      error_message: null,
      sent_at: null,
      created_at: '2026-07-15T04:00:00Z',
      headline: null,
      peril_type: null,
      lifecycle_action: null,
      matched_watch_zone_label: null,
    }])
    render(<EwsPage onViewOnMap={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Notifikasi Saya' }))

    const row = await screen.findByRole('row', { name: /telegram/i })
    expect(within(row).queryByText('Notifikasi peringatan')).toBeNull()
    expect(within(row).queryByText(/Watch zone:/)).toBeNull()
    expect(within(row).getAllByRole('cell')[0].textContent).toBe('—')
  })

  it('keeps weather and air-quality watch-zone save payloads exact', async () => {
    render(<EwsPage onViewOnMap={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Watch Zones' }))
    await screen.findByText('Belum ada watch zone.')
    fireEvent.click(screen.getByRole('button', { name: '+ Zona' }))
    fireEvent.change(screen.getByPlaceholderText('Label'), { target: { value: ' Kantor ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pilih titik uji' }))
    fireEvent.click(screen.getByRole('button', { name: 'weather' }))
    fireEvent.click(screen.getByRole('button', { name: 'air_quality' }))
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(createWatchZone).toHaveBeenCalledWith({
      label: 'Kantor',
      latitude: -6.2,
      longitude: 106.8,
      radius_km: 75,
      peril_types: ['weather', 'air_quality'],
      thresholds: {},
    }))
  })

  it('preserves the complete preference payload while adding weather and air quality', async () => {
    prefs.mockResolvedValue([{
      channel: 'telegram',
      min_severity: 'Critical',
      alert_types: ['earthquake'],
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',
      is_enabled: true,
    }])
    render(<EwsPage onViewOnMap={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Preferences' }))
    await screen.findByText('Kontak saya')
    fireEvent.click(screen.getAllByLabelText('weather')[0])

    await waitFor(() => expect(updatePref).toHaveBeenNthCalledWith(1, {
      channel: 'telegram',
      min_severity: 'Critical',
      alert_types: ['earthquake', 'weather'],
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',
      is_enabled: true,
    }))
    fireEvent.click(screen.getAllByLabelText('air_quality')[0])

    await waitFor(() => expect(updatePref).toHaveBeenNthCalledWith(2, {
      channel: 'telegram',
      min_severity: 'Critical',
      alert_types: ['earthquake', 'weather', 'air_quality'],
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',
      is_enabled: true,
    }))
  })
})
