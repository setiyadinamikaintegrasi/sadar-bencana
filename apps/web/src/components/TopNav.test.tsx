import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GITHUB_REPOSITORY_URL } from '../navigation'
import TopNav from './TopNav'

afterEach(cleanup)

describe('TopNav', () => {
  it('renders accessible primary navigation with active state and GitHub link', () => {
    const onNavigate = vi.fn()

    render(<TopNav activeSection="Early Warning" onNavigate={onNavigate} />)

    expect(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Early Warning' }).getAttribute('aria-current')).toBe('page')

    const github = screen.getByRole('link', { name: /GitHub.*Open Source/i })
    expect(github.getAttribute('href')).toBe(GITHUB_REPOSITORY_URL)
    expect(github.getAttribute('target')).toBe('_blank')
  })

  it('opens grouped secondary navigation and closes after navigating', () => {
    const onNavigate = vi.fn()

    render(<TopNav activeSection="Executive Overview" onNavigate={onNavigate} />)

    const menu = screen.getByRole('button', { name: 'Menu' })
    expect(menu.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(menu)

    expect(menu.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Pemantauan')).toBeTruthy()
    expect(screen.getByText('Analisis')).toBeTruthy()
    expect(screen.getByText('Administrasi')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Events' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Daftar Risiko' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Admin Evakuasi' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Events' }))

    expect(onNavigate).toHaveBeenCalledWith('Events')
    expect(menu.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes the secondary navigation on Escape', () => {
    render(<TopNav activeSection="Executive Overview" onNavigate={vi.fn()} />)

    const menu = screen.getByRole('button', { name: 'Menu' })
    fireEvent.click(menu)
    expect(menu.getAttribute('aria-expanded')).toBe('true')

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(menu.getAttribute('aria-expanded')).toBe('false')
  })
})
