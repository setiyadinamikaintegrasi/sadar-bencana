import { describe, expect, it, vi } from 'vitest'
import { fetchLatestWeatherRadarFrame, weatherRadarLayer } from './weatherRadar'

function createMap() {
  const layers = new Set<string>()
  const sources = new Map<string, unknown>()
  return {
    addLayer: vi.fn((layer: { id: string }) => layers.add(layer.id)),
    addSource: vi.fn((id: string, source: unknown) => sources.set(id, source)),
    getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
    getSource: vi.fn((id: string) => sources.get(id)),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    setPaintProperty: vi.fn(),
    setLayoutProperty: vi.fn(),
  }
}

describe('fetchLatestWeatherRadarFrame', () => {
  it('memetakan respons RainViewer ke template tile + flag nowcast', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      host: 'https://tilecache.rainviewer.com',
      radar: {
        past: [{ time: 1787000000, path: '/v2/radar/past-frame' }],
        nowcast: [{ time: 1787000600, path: '/v2/radar/nowcast-frame' }],
      },
    }), { status: 200 }))

    const frame = await fetchLatestWeatherRadarFrame()
    expect(frame).not.toBeNull()
    expect(frame!.nowcast).toBe(true)
    expect(frame!.time).toBe(1787000600)
    expect(frame!.tiles[0]).toBe('https://tilecache.rainviewer.com/v2/radar/nowcast-frame/256/{z}/{x}/{y}/2/1_1.png')
  })

  it('memakai frame past terakhir bila nowcast kosong', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      radar: { past: [{ time: 1787000000, path: '/v2/radar/past-frame' }], nowcast: [] },
    }), { status: 200 }))

    const frame = await fetchLatestWeatherRadarFrame()
    expect(frame!.nowcast).toBe(false)
    expect(frame!.tiles[0]).toContain('/v2/radar/past-frame/')
  })

  it('null saat fetch gagal (jangan sampai peta rusak)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await fetchLatestWeatherRadarFrame()).toBeNull()
  })
})

describe('weatherRadarLayer adapter', () => {
  it('apply mendaftarkan source+layer raster sekali, idempoten untuk pembaruan', () => {
    const map = createMap()
    const frame = { time: 1, tiles: ['https://t.example/{z}/{x}/{y}/256/4.png'], nowcast: false }

    weatherRadarLayer.apply(map as never, frame)
    expect(map.addSource).toHaveBeenCalledTimes(1)
    expect(map.addLayer).toHaveBeenCalledTimes(1)

    // Frame kedua: source sudah ada. Mock tanpa setTiles memakai jalur
    // fallback (hapus+pasang ulang) — tetap hanya SATU layer radar aktif.
    weatherRadarLayer.apply(map as never, { ...frame, tiles: ['https://t2.example/{z}/{x}/{y}/256/4.png'] })
    expect(map.addLayer).toHaveBeenCalledTimes(2)
    expect(map.removeLayer).toHaveBeenCalledTimes(1)
    expect(map.removeSource).toHaveBeenCalledTimes(1)
  })

  it('setVisible mengubah visibility hanya bila layer terpasang', () => {
    const map = createMap()
    weatherRadarLayer.setVisible(map as never, true)
    expect(map.setLayoutProperty).not.toHaveBeenCalled()

    weatherRadarLayer.apply(map as never, { time: 1, tiles: ['https://t/{z}/{x}/{y}/256/4.png'], nowcast: false })
    weatherRadarLayer.setVisible(map as never, true)
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      expect.stringContaining('weather-radar'),
      'visibility',
      'visible',
    )
  })

  it('remove membersihkan layer dan source', () => {
    const map = createMap()
    weatherRadarLayer.apply(map as never, { time: 1, tiles: ['https://t/{z}/{x}/{y}/256/4.png'], nowcast: false })
    weatherRadarLayer.remove(map as never)
    expect(map.removeSource).toHaveBeenCalledWith(weatherRadarLayer.sourceId)
    expect(map.getSource(weatherRadarLayer.sourceId)).toBeUndefined()
  })
})
