import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OverlayFocusRequest } from './components/RiskMap'
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
  default: ({ initialOfficialAlertFocus }: { initialOfficialAlertFocus?: OverlayFocusRequest | null }) => (
    <p data-testid="dashboard-focus">
      {initialOfficialAlertFocus
        ? `${initialOfficialAlertFocus.id}:${initialOfficialAlertFocus.nonce}`
        : 'none'}
    </p>
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

    fireEvent.click(screen.getByRole('button', { name: 'Ke EWS' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lihat warning di peta' }))
    expect(screen.getByTestId('dashboard-focus').textContent).toBe('warning-1:2')
  })
})
