import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../../lib/auth/AuthProvider'
import {
  fetchMyChannelStatus,
  fetchMyNotifications,
  fetchMyPrefs,
  fetchMyProfile,
  fetchMyWatchZones,
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
vi.mock('./WatchZoneMapPicker', () => ({ default: () => <div>Pemilih peta</div> }))

const auth = vi.mocked(useAuth)
const notifications = vi.mocked(fetchMyNotifications)
const prefs = vi.mocked(fetchMyPrefs)
const profile = vi.mocked(fetchMyProfile)
const channelStatus = vi.mocked(fetchMyChannelStatus)
const watchZones = vi.mocked(fetchMyWatchZones)

beforeEach(() => {
  auth.mockReturnValue({
    session: { user: { email: 'user@example.com' } } as never,
    loading: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    resendConfirmation: vi.fn(),
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
})
