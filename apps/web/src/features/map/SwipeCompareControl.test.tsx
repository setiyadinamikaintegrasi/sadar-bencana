import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach } from 'vitest'

import { SwipeCompareControl } from './SwipeCompareControl'

// Map mock: getCanvas dipakai untuk clip-path; cukup objek minimal.
const mapMock = {
  getCanvas: () => ({
    style: {} as CSSStyleDeclaration,
    parentElement: { style: {} as CSSStyleDeclaration } as HTMLElement,
  }),
} as never

describe('SwipeCompareControl (S11b)', () => {
  afterEach(cleanup)

  it('tidak merender apa pun saat map null', () => {
    const { container } = render(<SwipeCompareControl map={null} active={false} onToggle={() => {}} />)
    expect(container.querySelector('button')).toBeNull()
  })

  it('non-aktif: hanya tombol toggle, tanpa slider/garis/label', () => {
    render(<SwipeCompareControl map={mapMock} active={false} onToggle={() => {}} />)
    expect(screen.getByRole('button')).toBeTruthy()
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.getByRole('group', { name: /pembanding geser/i })).toBeTruthy()
  })

  it('aktif: slider + garis + label satelit & data muncul', () => {
    render(<SwipeCompareControl map={mapMock} active onToggle={() => {}} />)
    expect(screen.getByRole('slider')).toBeTruthy()
    expect(screen.getByText(/satelit/i)).toBeTruthy()
    expect(screen.getByText(/data/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /matikan pembanding/i })).toBeTruthy()
  })

  it('geser slider menerapkan clip-path pada canvas', () => {
    const canvasStyle: Record<string, string> = {}
    const mapWithStyle = {
      getCanvas: () => ({ style: canvasStyle }),
      parentElement: null,
    } as never
    render(<SwipeCompareControl map={mapWithStyle} active onToggle={() => {}} />)
    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '30' } })
    expect(canvasStyle.clipPath).toContain('30%')
  })

  it('klik tombol memanggil onToggle dengan nilai terbalik', () => {
    const onToggle = vi.fn()
    render(<SwipeCompareControl map={mapMock} active={false} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledWith(true)
  })
})
