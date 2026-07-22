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

    const github = screen.getByRole('link', { name: 'GitHub Open Source' })
    expect(github.getAttribute('href')).toBe(GITHUB_REPOSITORY_URL)
    expect(github.getAttribute('target')).toBe('_blank')
    expect(github.getAttribute('rel')).toBe('noreferrer')
    expect(github.querySelector('svg')).toBeTruthy()
    expect(screen.getByText('GitHub').className).not.toContain('hidden')
    expect(screen.getByText('· Open Source').className).toContain('hidden')
    expect(screen.getByText('· Open Source').className).toContain('xl:inline')

    const header = screen.getByRole('banner')
    expect(header.className).toContain('md:px-3')
    expect(header.className).toContain('lg:px-6')

    const logos = header.querySelectorAll('img')
    expect(logos).toHaveLength(2)
    expect(logos[0].getAttribute('src')).toBe('/brand/logo-mark.svg')
    expect(logos[1].getAttribute('src')).toBe('/brand/logo-horizontal.svg')
    expect(logos[0].parentElement?.className).toContain('md:block')
    expect(logos[0].parentElement?.className).toContain('lg:hidden')
    expect(logos[1].parentElement?.className).toContain('hidden')
    expect(logos[1].parentElement?.className).toContain('lg:block')
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
