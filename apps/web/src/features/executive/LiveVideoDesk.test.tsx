import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LiveVideoDesk from './LiveVideoDesk'
import { liveVideoSources } from './liveVideoSources'

const videoSources = liveVideoSources.filter((source) => source.validateUrl)

function oembedRequestUrl(validateUrl: string): string {
  return `https://www.youtube.com/oembed?url=${encodeURIComponent(validateUrl)}&format=json`
}

function mockOembed(statusFor: (validateUrl: string) => number) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input)
    for (const source of videoSources) {
      if (url === oembedRequestUrl(source.validateUrl!)) {
        const status = statusFor(source.validateUrl!)
        return Promise.resolve(new Response(status === 200 ? '{"title":"live"}' : '{}', { status }))
      }
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('LiveVideoDesk validasi kanal live', () => {
  it('menandai kanal scheduled OFFLINE dan menampilkan panel jujur tanpa iframe', async () => {
    mockOembed((validateUrl) => (validateUrl.includes('vz1RLz9A5ZU') ? 200 : 404))
    render(<LiveVideoDesk />)

    // Badge OFFLINE muncul untuk keempat kanal scheduled setelah validasi.
    expect(await screen.findAllByText('OFFLINE')).toHaveLength(4)
    expect(await screen.findByText('LIVE')).toBeTruthy()

    // Pilih kanal offline -> panel jujur, tanpa iframe rusak.
    fireEvent.click(screen.getByRole('button', { name: /Info BMKG/ }))
    expect(await screen.findByText(/Info BMKG sedang tidak live/)).toBeTruthy()
    expect(screen.queryByTitle(/Live video Info BMKG/)).toBeNull()
  })

  it('me-render iframe ketika kanal tervalidasi LIVE', async () => {
    mockOembed(() => 200)
    render(<LiveVideoDesk />)

    await waitFor(() => expect(screen.findAllByText('LIVE')).resolves.toHaveLength(videoSources.length))
    fireEvent.click(screen.getByRole('button', { name: /Info BMKG/ }))

    const iframe = screen.getByTitle(/Live video Info BMKG/) as HTMLIFrameElement
    expect(iframe.src).toContain('youtube-nocookie.com/embed/live_stream?channel=UC8Do0tOnpnz1ydOZV0XKS3g')
  })

  it('tetap optimis (iframe) bila validasi gagal karena jaringan/CSP', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('blocked by CSP'))
    render(<LiveVideoDesk />)

    // Tunggu seluruh upaya validasi selesai (semua gagal -> unknown).
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(videoSources.length))
    await waitFor(() => expect(screen.queryByText('OFFLINE')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /KOMPAS TV/ }))

    // Status unknown -> iframe optimis dirender seperti perilaku lama.
    expect(screen.getByTitle(/Live video KOMPAS TV/)).toBeTruthy()
    expect(screen.queryByText(/sedang tidak live/)).toBeNull()
  })

  it('memvalidasi hanya sumber video (peta cuaca tanpa validateUrl) dan interval dibersihkan', async () => {
    const fetchMock = mockOembed(() => 404)
    render(<LiveVideoDesk />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(videoSources.length))
    for (const source of videoSources) {
      expect(fetchMock).toHaveBeenCalledWith(oembedRequestUrl(source.validateUrl!), expect.anything())
    }
    // Windy tidak pernah divalidasi.
    expect(fetchMock.mock.calls.every((call) => !String(call[0]).includes('windy'))).toBe(true)
  })

  it('default menampilkan peta cuaca Windy yang selalu valid', () => {
    mockOembed(() => 404)
    render(<LiveVideoDesk />)

    expect(screen.getByTitle(/Peta cuaca Windy Indonesia/)).toBeTruthy()
  })
})
