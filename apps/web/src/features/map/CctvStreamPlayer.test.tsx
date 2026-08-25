import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { CctvStreamPlayer } from './CctvStreamPlayer'

// Mock hls.js agar tidak butuh browser sungguhan.
vi.mock('hls.js', () => {
  const HlsMock = class {
    static isSupported = () => true
    static Events = { MANIFEST_PARSED: 'manifest-parsed', ERROR: 'error' } as const
    loadSource = vi.fn()
    attachMedia = vi.fn()
    destroy = vi.fn()
    on = vi.fn()
  }
  return { default: HlsMock }
})

// Mock HTMLMediaElement.canPlayType
Object.defineProperty(window.HTMLMediaElement.prototype, 'canPlayType', {
  configurable: true,
  value: () => '',
})

describe('CctvStreamPlayer (S12b)', () => {
  afterEach(() => cleanup())

  it('menolak stream non-HTTPS', () => {
    render(<CctvStreamPlayer streamUrl="http://example.com/x.m3u8" label="test" />)
    expect(screen.getByText(/tidak dapat diputar langsung/i)).toBeTruthy()
  })

  it('menolak stream host lokal (anti-SSRF)', () => {
    const { unmount: u1 } = render(<CctvStreamPlayer streamUrl="https://192.168.1.1/x.m3u8" label="test" />)
    expect(screen.getByText(/tidak dapat diputar langsung/i)).toBeTruthy()
    u1()
    const { unmount: u2 } = render(<CctvStreamPlayer streamUrl="https://localhost/x.m3u8" label="test" />)
    expect(screen.getByText(/tidak dapat diputar langsung/i)).toBeTruthy()
    u2()
  })

  it('menerima stream publik resmi BUJT (hk/waskita/astra)', () => {
    const { unmount: u1 } = render(<CctvStreamPlayer streamUrl="https://pub2.hk-opt.com/hls/abc.m3u8" label="HK" />)
    expect(screen.getByLabelText('HK')).toBeTruthy()
    u1()
    const { unmount: u2 } = render(<CctvStreamPlayer streamUrl="https://cctv.waskitabumiwira.com/x.m3u8" label="Waskita" />)
    expect(screen.getByLabelText('Waskita')).toBeTruthy()
    u2()
  })

  it('menampilkan video utk host tepercaya (Jasa Marga)', () => {
    render(<CctvStreamPlayer streamUrl="https://jid.jasamarga.com/cctv2/abc?tx=1" label="JAGORAWI" />)
    expect(screen.getByLabelText('JAGORAWI')).toBeTruthy()
  })

  it('menampilkan video utk host tepercaya (Banyuwangi/Dishub)', () => {
    render(<CctvStreamPlayer streamUrl="https://live.banyuwangikab.go.id/hls/201/playlist.m3u8" label="Ketapang" />)
    expect(screen.getByLabelText('Ketapang')).toBeTruthy()
  })
})
