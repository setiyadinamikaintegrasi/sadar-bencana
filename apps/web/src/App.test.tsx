import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OverlayFocusRequest } from './components/RiskMap'
import { GITHUB_REPOSITORY_URL } from './navigation'
import App from './App'

vi.mock('./components/TopNav', () => ({
  default: ({ onNavigate }: { onNavigate: (section: string) => void }) => (
    <nav aria-label="Test navigation">
      <button type="button" onClick={() => onNavigate('Early Warning')}>Ke EWS</button>
      <button type="button" onClick={() => onNavigate('Executive Overview')}>Ke Dashboard</button>
    </nav>
  ),
}))
vi.mock('./components/BrandLogo', () => ({ default: () => null }))
vi.mock('./features/ews/EwsPage', () => ({
  default: ({ onViewOnMap }: { onViewOnMap: (id: string) => void }) => (
    <button type="button" onClick={() => onViewOnMap('warning-1')}>Lihat warning di peta</button>
  ),
}))
vi.mock('./features/executive/ExecutiveOverview', () => ({
  default: ({
    initialOfficialAlertFocus,
    onOfficialAlertFocusCleared,
  }: {
    initialOfficialAlertFocus?: OverlayFocusRequest | null
    onOfficialAlertFocusCleared: () => void
  }) => (
    <div>
      <p data-testid="dashboard-focus">
        {initialOfficialAlertFocus
          ? `${initialOfficialAlertFocus.id}:${initialOfficialAlertFocus.nonce}`
          : 'none'}
      </p>
      <button type="button" onClick={onOfficialAlertFocusCleared}>Konsumsi fokus</button>
    </div>
  ),
}))

afterEach(cleanup)

describe('App EWS map navigation', () => {
  it('creates a fresh focus request when the same warning is opened repeatedly', () => {
    render(<App />)
    expect(screen.getByTestId('dashboard-focus').textContent).toBe('none')

    fireEvent.click(screen.getByRole('button', { name: 'Ke EWS' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lihat warning di peta' }))
    expect(screen.getByTestId('dashboard-focus').textContent).toBe('warning-1:1')
    fireEvent.click(screen.getByRole('button', { name: 'Konsumsi fokus' }))
    expect(screen.getByTestId('dashboard-focus').textContent).toBe('none')

    fireEvent.click(screen.getByRole('button', { name: 'Ke EWS' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lihat warning di peta' }))
    expect(screen.getByTestId('dashboard-focus').textContent).toBe('warning-1:2')
  })

  it('does not resurrect consumed focus after dashboard navigation remounts', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Ke EWS' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lihat warning di peta' }))
    expect(screen.getByTestId('dashboard-focus').textContent).toBe('warning-1:1')
    fireEvent.click(screen.getByRole('button', { name: 'Konsumsi fokus' }))

    fireEvent.click(screen.getByRole('button', { name: 'Ke EWS' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ke Dashboard' }))

    expect(screen.getByTestId('dashboard-focus').textContent).toBe('none')
  })
})

describe('App mobile navigation', () => {
  it('prioritizes public safety workflows and exposes grouped secondary navigation', () => {
    render(<App />)

    const navigation = screen.getByRole('navigation', { name: 'Navigasi mobile' })
    expect(within(navigation).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Overview', 'Early Warning', 'Evakuasi', 'Belajar', 'Menu',
    ])

    fireEvent.click(within(navigation).getByRole('button', { name: 'Early Warning' }))
    expect(screen.getByRole('button', { name: 'Lihat warning di peta' })).toBeTruthy()

    const github = screen.getByRole('link', { name: 'GitHub Open Source' })
    expect(github.getAttribute('href')).toBe(GITHUB_REPOSITORY_URL)
    expect(github.getAttribute('target')).toBe('_blank')
    expect(github.getAttribute('rel')).toBe('noreferrer')

    fireEvent.click(within(navigation).getByRole('button', { name: 'Menu' }))
    expect(screen.getByText('Pemantauan')).toBeTruthy()
    expect(screen.getByText('Analisis')).toBeTruthy()
    expect(screen.getByText('Administrasi')).toBeTruthy()
  })
})
