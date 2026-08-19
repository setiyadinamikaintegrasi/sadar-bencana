import { describe, expect, it, vi } from 'vitest'
import { setGlobeProjection, terrainLayer } from './terrain'

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
    setLayoutProperty: vi.fn(),
    setTerrain: vi.fn(),
    setProjection: vi.fn(),
    getTerrain: vi.fn(() => null),
  }
}

describe('terrainLayer adapter', () => {
  it('apply mendaftarkan DEM source terrarium + hillshade, idempoten', () => {
    const map = createMap()
    terrainLayer.apply(map as never)
    expect(map.addSource).toHaveBeenCalledWith(
      'operational-map-terrain-dem-source',
      expect.objectContaining({ type: 'raster-dem', encoding: 'terrarium' }),
    )
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: 'operational-map-terrain-hillshade',
      type: 'hillshade',
    }))

    // apply kedua: tidak dobel.
    terrainLayer.apply(map as never)
    expect(map.addSource).toHaveBeenCalledTimes(1)
    expect(map.addLayer).toHaveBeenCalledTimes(1)
  })

  it('setVisible ON: setTerrain dengan source + hillshade visible; OFF: null + none', () => {
    const map = createMap()
    terrainLayer.apply(map as never)

    terrainLayer.setVisible(map as never, true)
    expect(map.setTerrain).toHaveBeenCalledWith(expect.objectContaining({
      source: 'operational-map-terrain-dem-source',
    }))
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      'operational-map-terrain-hillshade',
      'visibility',
      'visible',
    )

    terrainLayer.setVisible(map as never, false)
    expect(map.setTerrain).toHaveBeenLastCalledWith(null)
    expect(map.setLayoutProperty).toHaveBeenLastCalledWith(
      'operational-map-terrain-hillshade',
      'visibility',
      'none',
    )
  })

  it('remove membersihkan terrain, hillshade, dan source', () => {
    const map = createMap()
    terrainLayer.apply(map as never)
    terrainLayer.remove(map as never)
    expect(map.setTerrain).toHaveBeenCalledWith(null)
    expect(map.removeSource).toHaveBeenCalledWith(terrainLayer.sourceId)
    expect(map.getSource(terrainLayer.sourceId)).toBeUndefined()
  })
})

describe('terrainLayer.setPaused (hemat CPU di background tab)', () => {
  it('paused menghapus terrain aktif + menyembunyikan hillshade', () => {
    const map = createMap()
    map.getTerrain.mockReturnValue({ source: 'x' } as never)
    terrainLayer.apply(map as never)
    terrainLayer.setPaused(map as never, true)
    expect(map.setTerrain).toHaveBeenLastCalledWith(null)
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      'operational-map-terrain-hillshade',
      'visibility',
      'none',
    )
  })

  it('paused tanpa effect bila terrain nonaktif', () => {
    const map = createMap()
    terrainLayer.apply(map as never)
    terrainLayer.setPaused(map as never, true)
    expect(map.setTerrain).not.toHaveBeenCalledWith(null)
  })
})

describe('setGlobeProjection', () => {
  it('ganti proyeksi mercator <-> globe', () => {
    const map = createMap()
    setGlobeProjection(map as never, true)
    expect(map.setProjection).toHaveBeenCalledWith({ type: 'globe' })
    setGlobeProjection(map as never, false)
    expect(map.setProjection).toHaveBeenLastCalledWith({ type: 'mercator' })
  })
})
