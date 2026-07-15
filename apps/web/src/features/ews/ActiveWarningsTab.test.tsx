import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchMyActiveWarnings, type EWSActiveWarning } from '../../lib/api/ews'
import ActiveWarningsTab from './ActiveWarningsTab'

vi.mock('../../lib/api/ews', () => ({
  fetchMyActiveWarnings: vi.fn(),
}))

const fetchWarnings = vi.mocked(fetchMyActiveWarnings)

function warning(overrides: Partial<EWSActiveWarning> = {}): EWSActiveWarning {
  return {
    id: 'warning-1',
    source: 'bmkg_cap',
    message_type: 'update',
    status: 'active',
    sent_at: '2026-07-15T04:00:00Z',
    peril_type: 'weather',
    severity: 'High',
    category: 'Hujan Lebat',
    headline: 'Peringatan hujan lebat Jawa Barat',
    description: 'Hujan lebat disertai petir masih berpotensi terjadi.',
    area_name: 'Jawa Barat',
    effective_at: '2026-07-15T04:30:00Z',
    expires_at: '2026-07-15T08:00:00Z',
    source_url: 'https://www.bmkg.go.id/cuaca/peringatan-dini-cuaca',
    area_geojson: null,
    latitude: -6.9,
    longitude: 107.6,
    matched_watch_zone_ids: ['zone-1'],
    matched_watch_zone_labels: ['Rumah Bandung'],
    guidance: {
      before: ['Pantau pembaruan resmi.'],
      during: ['Hindari area terbuka.'],
      after: ['Periksa kondisi sekitar.'],
    },
    guidance_source: 'https://www.bmkg.go.id/cuaca/peringatan-dini-cuaca',
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ActiveWarningsTab', () => {
  it('shows an accessible loading state until the first request settles', () => {
    fetchWarnings.mockReturnValue(new Promise(() => undefined))

    render(<ActiveWarningsTab onViewOnMap={vi.fn()} />)

    expect(screen.getByRole('status', { name: 'Memuat peringatan aktif BMKG' })).not.toBeNull()
  })

  it('renders compact BMKG warning metadata, Indonesian times, guidance, and map navigation', async () => {
    fetchWarnings.mockResolvedValue([warning()])
    const onViewOnMap = vi.fn()

    render(<ActiveWarningsTab onViewOnMap={onViewOnMap} />)

    const row = await screen.findByRole('article', { name: 'Peringatan hujan lebat Jawa Barat' })
    expect(within(row).getByText('BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)')).not.toBeNull()
    expect(within(row).getByText('Cuaca')).not.toBeNull()
    expect(within(row).getByText('High')).not.toBeNull()
    expect(within(row).getByText('Aktif')).not.toBeNull()
    expect(within(row).getByText('Pembaruan')).not.toBeNull()
    expect(within(row).getByText('Hujan Lebat')).not.toBeNull()
    expect(within(row).getByText(/Jawa Barat · Watch zone: Rumah Bandung/)).not.toBeNull()
    expect(within(row).getByText(/Diterbitkan: .*WIB/)).not.toBeNull()
    expect(within(row).getByText(/Berlaku: .*WIB.*sampai.*WIB/)).not.toBeNull()

    const source = within(row).getByRole('link', { name: 'Sumber BMKG' })
    expect(source.getAttribute('href')).toBe('https://www.bmkg.go.id/cuaca/peringatan-dini-cuaca')
    expect(source.getAttribute('rel')).toBe('noopener noreferrer')

    fireEvent.click(within(row).getByRole('button', { name: 'Lihat di peta' }))
    expect(onViewOnMap).toHaveBeenCalledWith('warning-1')

    fireEvent.click(within(row).getByText('Panduan keselamatan'))
    expect(within(row).getByText('Pantau pembaruan resmi.')).not.toBeNull()
    expect(within(row).getByText('Hindari area terbuka.')).not.toBeNull()
    expect(within(row).getByText('Periksa kondisi sekitar.')).not.toBeNull()
    expect(within(row).getByText(/Ikuti arahan BMKG dan otoritas setempat/)).not.toBeNull()
  })

  it('does not render unsafe source links or a map action without geometry', async () => {
    fetchWarnings.mockResolvedValue([warning({
      source_url: 'https://operator:secret@www.bmkg.go.id/alert',
      guidance_source: 'https://www.bmkg.go.id:8443/panduan',
      area_geojson: null,
      latitude: null,
      longitude: null,
    })])

    render(<ActiveWarningsTab onViewOnMap={vi.fn()} />)

    await screen.findByText('Peringatan hujan lebat Jawa Barat')
    expect(screen.queryByRole('link', { name: 'Sumber BMKG' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Sumber panduan BMKG' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Lihat di peta' })).toBeNull()
  })

  it('renders the confirmed empty state', async () => {
    fetchWarnings.mockResolvedValue([])

    render(<ActiveWarningsTab onViewOnMap={vi.fn()} />)

    expect(await screen.findByText('Tidak ada peringatan aktif untuk watch zone Anda.')).not.toBeNull()
  })

  it('retries an initial error and renders the recovered warning', async () => {
    fetchWarnings
      .mockRejectedValueOnce(new Error('Layanan peringatan tidak tersedia.'))
      .mockResolvedValueOnce([warning()])

    render(<ActiveWarningsTab onViewOnMap={vi.fn()} />)

    expect(await screen.findByText('Layanan peringatan tidak tersedia.')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))

    expect(await screen.findByText('Peringatan hujan lebat Jawa Barat')).not.toBeNull()
    expect(fetchWarnings).toHaveBeenCalledTimes(2)
  })

  it('retains cached warnings and marks them uncertain when a refresh fails', async () => {
    fetchWarnings
      .mockResolvedValueOnce([warning()])
      .mockRejectedValueOnce(new Error('Refresh gagal.'))

    render(<ActiveWarningsTab onViewOnMap={vi.fn()} />)

    await screen.findByText('Peringatan hujan lebat Jawa Barat')
    fireEvent.click(screen.getByRole('button', { name: 'Perbarui peringatan aktif' }))

    await waitFor(() => expect(fetchWarnings).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/Data terbaru belum terkonfirmasi/)).not.toBeNull()
    expect(screen.getByText('Peringatan hujan lebat Jawa Barat')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Coba lagi' })).not.toBeNull()
  })
})
