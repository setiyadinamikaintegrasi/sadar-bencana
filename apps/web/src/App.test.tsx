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
    expect(github.textContent).toContain('GitHub')

    fireEvent.click(within(navigation).getByRole('button', { name: 'Menu' }))
    expect(screen.getByText('Pemantauan')).toBeTruthy()
    expect(screen.getByText('Analisis')).toBeTruthy()
    expect(screen.getByText('Administrasi')).toBeTruthy()
  })

  it('opens a labelled modal, focuses its first control, and uses a stable five-column bar', () => {
    render(<App />)

    const navigation = screen.getByRole('navigation', { name: 'Navigasi mobile' })
    expect(navigation.className).toContain('grid-cols-5')
    for (const button of within(navigation).getAllByRole('button')) {
      expect(button.className).toContain('min-h-16')
      expect(button.className).toContain('grid-rows-[20px_24px]')
    }

    fireEvent.click(within(navigation).getByRole('button', { name: 'Menu' }))

    const dialog = screen.getByRole('dialog', { name: 'Menu navigasi' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Events' }))
    expect(screen.getByRole('main', { hidden: true }).getAttribute('aria-hidden')).toBe('true')
    expect(navigation.getAttribute('aria-hidden')).toBe('true')
  })

  it('contains Tab navigation within the mobile modal', () => {
    render(<App />)

    const navigation = screen.getByRole('navigation', { name: 'Navigasi mobile' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Menu' }))

    const dialog = screen.getByRole('dialog', { name: 'Menu navigasi' })
    const firstControl = within(dialog).getByRole('button', { name: 'Events' })
    const lastControl = within(dialog).getByRole('button', { name: 'Tutup' })

    lastControl.focus()
    fireEvent.keyDown(lastControl, { key: 'Tab' })
    expect(document.activeElement).toBe(firstControl)

    firstControl.focus()
    fireEvent.keyDown(firstControl, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(lastControl)
  })

  it('returns focus to Menu after Escape dismisses the mobile modal', () => {
    render(<App />)

    const navigation = screen.getByRole('navigation', { name: 'Navigasi mobile' })
    const menu = within(navigation).getByRole('button', { name: 'Menu' })
    menu.focus()
    fireEvent.click(menu)
    expect(screen.getByRole('dialog', { name: 'Menu navigasi' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Menu navigasi' })).toBeNull()
    expect(document.activeElement).toBe(menu)
    expect(screen.getByRole('main').getAttribute('aria-hidden')).toBeNull()
    expect(navigation.getAttribute('aria-hidden')).toBeNull()
  })

  it('returns focus to Menu after selecting a mobile secondary destination', () => {
    render(<App />)

    const navigation = screen.getByRole('navigation', { name: 'Navigasi mobile' })
    const menu = within(navigation).getByRole('button', { name: 'Menu' })
    menu.focus()
    fireEvent.click(menu)

    const dialog = screen.getByRole('dialog', { name: 'Menu navigasi' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Events' }))

    expect(screen.queryByRole('dialog', { name: 'Menu navigasi' })).toBeNull()
    expect(document.activeElement).toBe(menu)
  })
})
