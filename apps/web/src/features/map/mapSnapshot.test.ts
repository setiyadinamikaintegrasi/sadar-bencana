import { afterEach, describe, expect, it, vi } from 'vitest'
import { composeMapSnapshot, downloadMapSnapshot } from './mapSnapshot'

function createContextMock() {
  const state: Record<string, string> = {}
  return {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 42 })),
    set fillStyle(value: string) { state.fillStyle = value },
    get fillStyle() { return state.fillStyle ?? '' },
    set font(value: string) { state.font = value },
    get font() { return state.font ?? '' },
    set textBaseline(value: string) { state.textBaseline = value },
    get textBaseline() { return state.textBaseline ?? '' },
    set textAlign(value: string) { state.textAlign = value },
    get textAlign() { return state.textAlign ?? '' },
  }
}

function createCanvasMock(width = 800, height = 600, clientWidth = 400, clientHeight = 300) {
  const context = createContextMock()
  const canvas = {
    width,
    height,
    clientWidth,
    clientHeight,
    getContext: vi.fn(() => context),
    toBlob: vi.fn(),
  } as unknown as HTMLCanvasElement & { getContext: ReturnType<typeof vi.fn>; toBlob: ReturnType<typeof vi.fn> }
  return { canvas, context }
}

/** Pasang mock createElement untuk tag 'canvas' (komposisi offscreen). */
function stubCanvasCreation(canvas: HTMLCanvasElement) {
  return vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') return canvas
    return {} as HTMLElement
  })
}

describe('composeMapSnapshot', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('draws the WebGL canvas onto a taller canvas with an attribution footer', () => {
    const { canvas: composed, context } = createCanvasMock(800, 688, 400, 344)
    const spy = stubCanvasCreation(composed)
    const source = createCanvasMock(800, 600, 400, 300).canvas
    const result = composeMapSnapshot(source, { attributions: ['BMKG'], timestamp: new Date(2026, 7, 19, 10, 30) })

    expect(result).toBe(composed)
    expect(spy).toHaveBeenCalledWith('canvas')
    expect(composed.width).toBe(800)
    // Footer = 44 CSS px × rasio perangkat (800/400 = 2) = 88 px.
    expect(composed.height).toBe(688)
    expect(context.drawImage).toHaveBeenCalledWith(source, 0, 0)
    // Footer digambar sebagai persegi gelap sepanjang lebar penuh.
    expect(context.fillRect).toHaveBeenCalledWith(0, 600, 800, 88)
    // Dua teks: label brand+waktu (kiri) dan atribusi (kanan).
    expect(context.fillText).toHaveBeenCalledTimes(2)
    const texts = context.fillText.mock.calls.map((call) => String(call[0]))
    expect(texts[0]).toContain('Sadar Bencana — Peta Operasional')
    expect(texts[0]).toMatch(/2026.*10\.30/)
    expect(texts[1]).toContain('BMKG')
    expect(texts[1]).toContain('© OpenStreetMap contributors · OpenFreeMap')
  })

  it('deduplicates layer attributions and always appends the basemap attribution', () => {
    const { canvas: composed, context } = createCanvasMock()
    stubCanvasCreation(composed)
    const source = createCanvasMock().canvas
    composeMapSnapshot(source, {
      attributions: ['BMKG', 'BMKG', 'The OpenSky Network'],
      timestamp: new Date(2026, 7, 19, 10, 30),
    })

    const texts = context.fillText.mock.calls.map((call) => String(call[0]))
    expect(texts[1]).toBe('BMKG · The OpenSky Network · © OpenStreetMap contributors · OpenFreeMap')
  })

  it('returns null when a 2D context is unavailable for the composed canvas', () => {
    const dead = {
      width: 800, height: 688,
      getContext: vi.fn(() => null),
    } as unknown as HTMLCanvasElement
    stubCanvasCreation(dead)
    const source = createCanvasMock().canvas
    expect(composeMapSnapshot(source, { attributions: [] })).toBeNull()
  })
})

describe('downloadMapSnapshot', () => {
  const realCreateElement = document.createElement.bind(document)

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('triggers a PNG download with a timestamped filename', () => {
    const { canvas } = createCanvasMock(640, 480, 320, 240)
    const anchor = {
      href: '', download: '', rel: '', click: vi.fn(),
    } as unknown as HTMLAnchorElement
    const blobUrl = 'blob:fixture-snapshot'
    const createObjectURL = vi.fn(() => blobUrl)
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const { canvas: composed } = createCanvasMock(640, 528, 320, 264)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') return composed
      if (tag === 'a') return anchor
      return realCreateElement(tag)
    })

    const map = {
      getContainer: () => ({ querySelector: () => canvas }),
    } as never as Parameters<typeof downloadMapSnapshot>[0]

    const ok = downloadMapSnapshot(map, { attributions: ['BMKG'], timestamp: new Date(2026, 7, 19, 10, 30) })
    expect(ok).toBe(true)

    expect(composed.toBlob).toHaveBeenCalledTimes(1)
    const [callback, mimeType] = composed.toBlob.mock.calls[0] as [(blob: Blob) => void, string]
    expect(mimeType).toBe('image/png')

    // toBlob bersifat async — picu callback-nya lalu periksa anchor unduhan.
    callback(new Blob(['png'], { type: 'image/png' }))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(anchor.href).toBe(blobUrl)
    expect(anchor.download).toBe('sadar-bencana-peta-2026-08-19-1030.png')
    expect(anchor.click).toHaveBeenCalledTimes(1)
  })

  it('returns false when the map canvas is missing', () => {
    const map = {
      getContainer: () => ({ querySelector: () => null }),
    } as never as Parameters<typeof downloadMapSnapshot>[0]
    expect(downloadMapSnapshot(map, { attributions: [] })).toBe(false)
  })
})
