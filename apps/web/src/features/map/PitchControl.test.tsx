import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PitchControl } from './PitchControl'

function createMap() {
  const listeners: Record<string, Array<() => void>> = {}
  const state = { pitch: 0, bearing: 0 }
  const container = document.createElement('div')
  document.body.appendChild(container)
  return {
    container,
    state,
    getPitch: vi.fn(() => state.pitch),
    getBearing: vi.fn(() => state.bearing),
    getContainer: vi.fn(() => container),
    easeTo: vi.fn((opts: { pitch?: number; bearing?: number }) => {
      if (opts.pitch !== undefined) state.pitch = opts.pitch
      if (opts.bearing !== undefined) state.bearing = opts.bearing
    }),
    on: vi.fn((event: string, fn: () => void) => {
      ;(listeners[event] ??= []).push(fn)
    }),
    off: vi.fn(),
  }
}

describe('PitchControl', () => {
  afterEach(cleanup)

  it('miringkan lebih menaikkan pitch dan tombol reset mengembalikan utara', () => {
    const map = createMap()
    render(<PitchControl map={map as never} />)

    fireEvent.click(screen.getByRole('button', { name: 'Miringkan peta lebih' }))
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ pitch: 20 }))

    // Naikkan dua kali lagi → pitch 60
    fireEvent.click(screen.getByRole('button', { name: 'Miringkan peta lebih' }))
    fireEvent.click(screen.getByRole('button', { name: 'Miringkan peta lebih' }))
    expect(map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ pitch: 60 }))

    fireEvent.click(screen.getByRole('button', { name: 'Reset kemiringan dan arah peta' }))
    expect(map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ pitch: 0, bearing: 0 }))
  })

  it('miringkan lebih sedikit menurunkan pitch', () => {
    const map = createMap()
    map.state.pitch = 60
    render(<PitchControl map={map as never} />)

    fireEvent.click(screen.getByRole('button', { name: 'Miringkan peta lebih sedikit' }))
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ pitch: 40 }))
  })

  it('tombol lebih dinonaktifkan pada batas maksimum', () => {
    const map = createMap()
    map.state.pitch = 70
    render(<PitchControl map={map as never} />)
    expect((screen.getByRole('button', { name: 'Miringkan peta lebih' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('aman tanpa map (tidak render apa pun)', () => {
    const { container } = render(<PitchControl map={null} />)
    expect(container.querySelector('.operational-map__pitch-ctrl')).toBeNull()
  })
})
