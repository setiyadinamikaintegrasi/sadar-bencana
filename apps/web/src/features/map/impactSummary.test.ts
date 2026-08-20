import { describe, expect, it, vi } from 'vitest'
import { fetchImpactSummary, impactBoundingBoxPolygon, IMPACT_RADIUS_KM } from './impactSummary'

function mockFetch(responses: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    for (const key of Object.keys(responses)) {
      if (!url.includes(key)) continue
      return new Response(JSON.stringify(responses[key]), { status: 200 })
    }
    return new Response('{"error":"not_found"}', { status: 404 })
  })
}

describe('impactBoundingBoxPolygon', () => {
  it('builds a closed WKT square around the point sized by the radius', () => {
    const polygon = impactBoundingBoxPolygon(-6.2, 106.8, 30)
    expect(polygon.startsWith('POLYGON((')).toBe(true)
    // Ring tertutup: titik pertama == terakhir.
    const body = polygon.slice(polygon.indexOf('((') + 2, polygon.lastIndexOf('))'))
    const points = body.split(', ')
    expect(points[0]).toBe(points[points.length - 1])
    expect(points).toHaveLength(5)
    // Titik[0]→[1] berpindah di bujur; [0]→[2] di lintang (Δ ≈ 2×30/111.32).
    const [lonA, latA] = points[0].split(' ').map(Number)
    const [lonB] = points[1].split(' ').map(Number)
    const [, latC] = points[2].split(' ').map(Number)
    expect(Math.abs(latC - latA)).toBeCloseTo(2 * (30 / 111.32), 3)
    expect(Math.abs(lonB - lonA)).toBeCloseTo(2 * (30 / (111.32 * Math.cos((-6.2 * Math.PI) / 180))), 3)
  })

  it('keeps a sane longitude span near the poles via cosine floor', () => {
    const polygon = impactBoundingBoxPolygon(80, 100, 50)
    const body = polygon.slice(polygon.indexOf('((') + 2, polygon.lastIndexOf('))'))
    const [lonMin] = body.split(', ')[0].split(' ').map(Number)
    const [lonMax] = body.split(', ')[1].split(' ').map(Number)
    // cos(80°) ≈ 0.17 < floor 0.2 → floor dipakai; span dibatasi wajar.
    const span = Math.abs(lonMax - lonMin)
    expect(span).toBeLessThanOrEqual(2 * (50 / (111.32 * 0.2)) + 0.01)
  })
})

describe('fetchImpactSummary', () => {
  it('merges population and facility summaries into one payload', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'population-summary': { data: { population: 1234.5, dataset: { vintage: '2020' } } },
      'critical-facilities': { data: { counts: { rumah_sakit: 3, damkar: 1 }, total: 4, truncated: false } },
      'landcover-summary': { data: { classes: [{ class_code: 50, fraction: 0.6 }, { class_code: 10, fraction: 0.4 }] } },
      'elevation-summary': { data: { min_m: 2, max_m: 45, mean_m: 12.5, roughness_m: 8, steep_percent: 0, water_percent: 0 } },
    }))
    const summary = await fetchImpactSummary(-6.2, 106.8)
    expect(summary).toEqual({
      score: null,
      population: 1234.5,
      populationVintage: '2020',
      facilities: { rumah_sakit: 3, damkar: 1 },
      facilitiesTotal: 4,
      truncated: false,
      landcover: [
        { classCode: 50, label: 'Kawasan terbangun', fraction: 0.6 },
        { classCode: 10, label: 'Hutan', fraction: 0.4 },
      ],
      elevation: { minM: 2, maxM: 45, meanM: 12.5, roughnessM: 8, steepPercent: 0, waterPercent: 0 },
    })
    vi.unstubAllGlobals()
  })

  it('still returns facility data when population endpoint fails', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'critical-facilities': { data: { counts: { kantor_polisi: 7 }, total: 7 } },
    }))
    const summary = await fetchImpactSummary(-6.2, 106.8)
    expect(summary?.population).toBeNull()
    expect(summary?.facilities).toEqual({ kantor_polisi: 7 })
    expect(summary?.facilitiesTotal).toBe(7)
    vi.unstubAllGlobals()
  })

  it('returns null when both endpoints fail', async () => {
    vi.stubGlobal('fetch', mockFetch({}))
    expect(await fetchImpactSummary(-6.2, 106.8)).toBeNull()
    vi.unstubAllGlobals()
  })

  it('uses the documented default radius', () => {
    expect(IMPACT_RADIUS_KM).toBe(30)
  })
})
