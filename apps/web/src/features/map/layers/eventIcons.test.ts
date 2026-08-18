import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_EVENT_ICON, EVENT_PERIL_ICONS, eventPerilLegend, registerEventIcons } from './eventIcons'

function createMap() {
  const images = new Set<string>()
  return {
    addImage: vi.fn((id: string) => images.add(id)),
    hasImage: vi.fn((id: string) => images.has(id)),
  }
}

describe('EVENT_PERIL_ICONS', () => {
  it('setiap peril punya imageId & glyph unik yang bisa dibedakan', () => {
    const imageIds = new Set(Object.values(EVENT_PERIL_ICONS).map((i) => i.imageId))
    expect(imageIds.size).toBe(Object.keys(EVENT_PERIL_ICONS).length)
    for (const peril of ['earthquake', 'wildfire', 'flood', 'volcano']) {
      expect(EVENT_PERIL_ICONS[peril].glyph).toBeTruthy()
    }
    // Ikon gempa vs karhutla harus berbeda (inti keluhan ambigu).
    expect(EVENT_PERIL_ICONS.earthquake.glyph).not.toBe(EVENT_PERIL_ICONS.wildfire.glyph)
  })

  it('eventPerilLegend mengembalikan daftar unik untuk kunci legenda', () => {
    const legend = eventPerilLegend()
    expect(legend.length).toBeGreaterThanOrEqual(5)
    const ids = new Set(legend.map((i) => i.imageId))
    expect(ids.size).toBe(legend.length)
    expect(legend.some((i) => i.label === 'Gempa')).toBe(true)
    expect(legend.some((i) => i.label === 'Karhutla')).toBe(true)
  })
})

describe('registerEventIcons', () => {
  it('mendaftarkan semua ikon sekali (idempoten) bila canvas tersedia', () => {
    // jsdom tanpa canvas 2D — mock elemen canvas beserta konteksnya.
    const ctx = {
      font: '',
      textAlign: '',
      textBaseline: '',
      fillText: vi.fn(),
      getImageData: vi.fn(() => ({ width: 36, height: 36, data: new Uint8ClampedArray(36 * 36 * 4) })),
    }
    const fakeCanvas = { width: 0, height: 0, getContext: vi.fn(() => ctx) }
    const createSpy = vi.spyOn(document, 'createElement').mockReturnValue(fakeCanvas as unknown as HTMLCanvasElement)

    const map = createMap()
    registerEventIcons(map as never)
    registerEventIcons(map as never)
    expect(map.addImage).toHaveBeenCalledTimes(Object.keys(EVENT_PERIL_ICONS).length + 1) // + default

    createSpy.mockRestore()
  })

  it('skip tanpa error bila konteks canvas tidak tersedia (jsdom murni)', () => {
    const map = createMap()
    registerEventIcons(map as never)
    expect(map.addImage).not.toHaveBeenCalled()
  })

  it('aman bila map tidak punya addImage/hasImage', () => {
    expect(() => registerEventIcons({} as never)).not.toThrow()
  })

  it('default icon tersedia untuk peril tak dikenal', () => {
    expect(DEFAULT_EVENT_ICON.imageId).toBe('operational-map-event-default')
  })
})
