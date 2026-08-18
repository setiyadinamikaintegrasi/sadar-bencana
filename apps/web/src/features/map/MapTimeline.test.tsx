import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MapTimeline, TIMELINE_WINDOW_HOURS } from './MapTimeline'

describe('MapTimeline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('menampilkan posisi waktu awal dan label yang sesuai', () => {
    render(<MapTimeline hoursAgo={30} onChange={() => {}} />)
    const slider = screen.getByRole('slider', { name: 'Posisi waktu replay' }) as HTMLInputElement
    expect(slider.value).toBe('30')
    expect(screen.getByText('30 jam lalu')).toBeTruthy()
  })

  it('slider mengubah hoursAgo melalui onChange', () => {
    const onChange = vi.fn()
    render(<MapTimeline hoursAgo={10} onChange={onChange} />)
    fireEvent.change(screen.getByRole('slider', { name: 'Posisi waktu replay' }), { target: { value: '5' } })
    expect(onChange).toHaveBeenCalledWith(5)
  })

  it('play menjalankan replay mundur 1 jam per tick dan berhenti di sekarang', () => {
    const onChange = vi.fn()
    render(<MapTimeline hoursAgo={3} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Putar replay' }))
    // Tick pertama: 3 -> 2
    act(() => { vi.advanceTimersByTime(1200) })
    expect(onChange).toHaveBeenLastCalledWith(2)
    // Tick kedua: 2 -> 1
    act(() => { vi.advanceTimersByTime(1200) })
    expect(onChange).toHaveBeenLastCalledWith(1)
    // Dua tick terakhir: 1 -> 0 lalu berhenti otomatis.
    act(() => { vi.advanceTimersByTime(2400) })
    expect(onChange).toHaveBeenLastCalledWith(0)
    const callsAfterStop = onChange.mock.calls.length
    act(() => { vi.advanceTimersByTime(3600) })
    expect(onChange.mock.calls.length).toBe(callsAfterStop)
  })

  it('restart mengembalikan ke 72 jam lalu dan langsung memutar', () => {
    const onChange = vi.fn()
    render(<MapTimeline hoursAgo={0} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ulangi dari 72 jam lalu' }))
    expect(onChange).toHaveBeenCalledWith(TIMELINE_WINDOW_HOURS)
    act(() => { vi.advanceTimersByTime(1200) })
    expect(onChange).toHaveBeenLastCalledWith(TIMELINE_WINDOW_HOURS - 1)
  })

  it('tombol kecepatan menaikkan laju (interval lebih pendek)', () => {
    const onChange = vi.fn()
    render(<MapTimeline hoursAgo={20} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Putar replay' }))
    // Kecepatan 2×: interval 600ms — satu tick sudah cukup memicu perubahan.
    fireEvent.click(screen.getByRole('button', { name: 'Kecepatan replay 1 jam per detik' }))
    act(() => { vi.advanceTimersByTime(600) })
    expect(onChange).toHaveBeenLastCalledWith(19)
  })
})
