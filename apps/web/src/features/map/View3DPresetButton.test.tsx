import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach } from 'vitest'

import { View3DPresetButton } from './View3DPresetButton'

describe('View3DPresetButton (S10b)', () => {
  afterEach(cleanup)

  it('render tombol dgn aria-label tampilan 3D saat non-aktif', () => {
    render(<View3DPresetButton active={false} onActivate={() => {}} onDeactivate={() => {}} />)
    const btn = screen.getByRole('button', { name: /Tampilan 3D/i })
    expect(btn.getAttribute('aria-pressed')).toBe('false')
  })

  it('render label kembali-standar saat aktif', () => {
    render(<View3DPresetButton active onActivate={() => {}} onDeactivate={() => {}} />)
    const btn = screen.getByRole('button', { name: /Kembali ke tampilan standar/i })
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })

  it('klik saat non-aktif memanggil onActivate', () => {
    const onActivate = vi.fn()
    const onDeactivate = vi.fn()
    render(<View3DPresetButton active={false} onActivate={onActivate} onDeactivate={onDeactivate} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onDeactivate).not.toHaveBeenCalled()
  })

  it('klik saat aktif memanggil onDeactivate', () => {
    const onActivate = vi.fn()
    const onDeactivate = vi.fn()
    render(<View3DPresetButton active onActivate={onActivate} onDeactivate={onDeactivate} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onDeactivate).toHaveBeenCalledTimes(1)
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('spam klik saat transisi dikunci (disabled sementara)', async () => {
    vi.useFakeTimers()
    const onActivate = vi.fn()
    render(<View3DPresetButton active={false} onActivate={onActivate} onDeactivate={() => {}} />)
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    fireEvent.click(btn) // harus terkunci
    expect(onActivate).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(800)
    fireEvent.click(btn) // terbuka lagi
    expect(onActivate).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
