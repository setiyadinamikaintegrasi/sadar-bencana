import { useEffect, useState } from 'react'

/**
 * Sprint 5 S1+S2 — ringkasan dampak area untuk event peta: populasi
 * terdampak (WorldPop zonal) dan fasilitas kritis dalam radius (OSM).
 *
 * Diambil saat pengguna membuka detail event (bukan per-render peta) agar
 * biaya query tetap proporsional dengan minat pengguna. Gagal-fetch tidak
 * mengganggu detail sheet — panel hanya menampilkan pesan ringkas.
 */

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1'
export const IMPACT_RADIUS_KM = 30

export interface LandcoverClass {
  classCode: number
  label: string
  fraction: number
}

export interface ImpactScore {
  score: number
  label: string
  radiusKm: number
  components: Partial<Record<string, number>>
  formulaVersion: string
}

export interface ElevationSummary {
  minM: number
  maxM: number
  meanM: number
  roughnessM: number
  steepPercent: number
  waterPercent: number
}

export interface ImpactSummary {
  score: ImpactScore | null
  population: number | null
  populationVintage: string | null
  facilities: Partial<Record<string, number>> | null
  facilitiesTotal: number | null
  truncated: boolean
  landcover: LandcoverClass[] | null
  elevation: ElevationSummary | null
}

export const LANDCOVER_LABELS: Record<number, string> = {
  10: 'Hutan',
  20: 'Semak',
  30: 'Padang rumput',
  40: 'Lahan pertanian',
  50: 'Kawasan terbangun',
  60: 'Lahan terbuka',
  70: 'Salju/es',
  80: 'Perairan',
  90: 'Lahan basah',
  95: 'Mangrove',
  100: 'Lumut',
}

export type ImpactSummaryState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; summary: ImpactSummary }
  | { status: 'unavailable' }

function toDegrees(value: number): string {
  return value.toFixed(4)
}

/** Bbox (derajat) ring-km di sekitar titik. */
export function impactBoundingBox(latitude: number, longitude: number, radiusKm: number): {
  minLon: string; minLat: string; maxLon: string; maxLat: string
} {
  const dLat = radiusKm / 111.32
  // Floor cosine diterapkan SEBELUM pembagian agar benar-benar membatasi
  // span bujur di lintang tinggi (cos(80°) ≈ 0.17 < floor 0.2).
  const cosLat = Math.max(0.2, Math.cos((latitude * Math.PI) / 180))
  const dLon = radiusKm / (111.32 * cosLat)
  return {
    minLon: toDegrees(longitude - dLon),
    maxLon: toDegrees(longitude + dLon),
    minLat: toDegrees(latitude - dLat),
    maxLat: toDegrees(latitude + dLat),
  }
}

/** Poligon kotak ring-km di sekitar titik (cukup untuk estimasi zonal cepat). */
export function impactBoundingBoxPolygon(latitude: number, longitude: number, radiusKm: number): string {
  const { minLon, minLat, maxLon, maxLat } = impactBoundingBox(latitude, longitude, radiusKm)
  return `POLYGON((${minLon} ${minLat}, ${maxLon} ${minLat}, ${maxLon} ${maxLat}, ${minLon} ${maxLat}, ${minLon} ${minLat}))`
}

/** Ambil ringkasan dampak (populasi + fasilitas + skor) untuk event. */
export async function fetchImpactSummary(
  latitude: number,
  longitude: number,
  radiusKm: number = IMPACT_RADIUS_KM,
  signal?: AbortSignal,
  eventId?: string | null,
): Promise<ImpactSummary | null> {
  const polygon = encodeURIComponent(impactBoundingBoxPolygon(latitude, longitude, radiusKm))
  // Bbox elevasi = bbox ring yang sama (min/max dari poligon dampak).
  const { minLon, minLat, maxLon, maxLat } = impactBoundingBox(latitude, longitude, radiusKm)
  const elevationQuery = `min_lng=${minLon}&min_lat=${minLat}&max_lng=${maxLon}&max_lat=${maxLat}`
  const [populationResponse, facilitiesResponse, landcoverResponse, elevationResponse] = await Promise.allSettled([
    fetch(`${API_BASE_URL}/spatial/population-summary?polygon=${polygon}`, { signal }),
    fetch(`${API_BASE_URL}/spatial/critical-facilities?lat=${latitude}&lon=${longitude}&radius_km=${radiusKm}`, { signal }),
    fetch(`${API_BASE_URL}/spatial/landcover-summary?polygon=${polygon}`, { signal }),
    fetch(`${API_BASE_URL}/spatial/elevation-summary?${elevationQuery}`, { signal }),
  ])

  let population: number | null = null
  let populationVintage: string | null = null
  if (populationResponse.status === 'fulfilled' && populationResponse.value.ok) {
    const body = (await populationResponse.value.json()) as {
      data?: { population?: number; dataset?: { vintage?: string } }
    }
    if (typeof body.data?.population === 'number') {
      population = body.data.population
      populationVintage = body.data.dataset?.vintage ?? null
    }
  }

  let facilities: Partial<Record<string, number>> | null = null
  let facilitiesTotal: number | null = null
  let truncated = false
  if (facilitiesResponse.status === 'fulfilled' && facilitiesResponse.value.ok) {
    const body = (await facilitiesResponse.value.json()) as {
      data?: { counts?: Partial<Record<string, number>>; total?: number; truncated?: boolean }
    }
    if (body.data?.counts) {
      facilities = body.data.counts
      facilitiesTotal = body.data.total ?? Object.values(body.data.counts).reduce((sum: number, n) => sum + (n ?? 0), 0)
      truncated = Boolean(body.data.truncated)
    }
  }

  let landcover: LandcoverClass[] | null = null
  if (landcoverResponse.status === 'fulfilled' && landcoverResponse.value.ok) {
    const body = (await landcoverResponse.value.json()) as {
      data?: { classes?: Array<{ class_code?: number; fraction?: number }> }
    }
    if (Array.isArray(body.data?.classes) && body.data.classes.length > 0) {
      landcover = body.data.classes
        .filter((entry) => typeof entry.class_code === 'number' && typeof entry.fraction === 'number')
        .map((entry) => ({
          classCode: entry.class_code as number,
          label: LANDCOVER_LABELS[entry.class_code as number] ?? `Kelas ${entry.class_code}`,
          fraction: entry.fraction as number,
        }))
        .sort((a, b) => b.fraction - a.fraction)
    }
  }

  let elevation: ElevationSummary | null = null
  if (elevationResponse.status === 'fulfilled' && elevationResponse.value.ok) {
    const body = (await elevationResponse.value.json()) as {
      data?: Partial<Record<'min_m' | 'max_m' | 'mean_m' | 'roughness_m' | 'steep_percent' | 'water_percent', number>>
    }
    if (typeof body.data?.min_m === 'number' && typeof body.data?.max_m === 'number') {
      elevation = {
        minM: body.data.min_m,
        maxM: body.data.max_m,
        meanM: body.data.mean_m ?? 0,
        roughnessM: body.data.roughness_m ?? 0,
        steepPercent: body.data.steep_percent ?? 0,
        waterPercent: body.data.water_percent ?? 0,
      }
    }
  }

  let score: ImpactScore | null = null
  if (eventId) {
    try {
      const scoreResponse = await fetch(`${API_BASE_URL}/spatial/impact-score?event_id=${encodeURIComponent(eventId)}`, { signal })
      if (scoreResponse.ok) {
        const body = (await scoreResponse.json()) as {
          data?: { score?: number; score_label?: string; radius_km?: number; components?: Partial<Record<string, number>>; formula_version?: string }
        }
        if (typeof body.data?.score === 'number') {
          score = {
            score: body.data.score,
            label: body.data.score_label ?? '',
            radiusKm: body.data.radius_km ?? radiusKm,
            components: body.data.components ?? {},
            formulaVersion: body.data.formula_version ?? '',
          }
        }
      }
    } catch {
      // Skor opsional — biarkan panel tetap tampil tanpa skor.
    }
  }

  if (population === null && facilities === null && landcover === null && elevation === null && score === null) return null
  return { score, population, populationVintage, facilities, facilitiesTotal, truncated, landcover, elevation }
}

/** Hook: muat ringkasan dampak + skor impact engine untuk event. */
export function useImpactSummary(latitude: number | null, longitude: number | null, eventId?: string | null): ImpactSummaryState {
  const [state, setState] = useState<ImpactSummaryState>({ status: 'idle' })

  useEffect(() => {
    if (latitude === null || longitude === null) {
      setState({ status: 'idle' })
      return
    }
    const controller = new AbortController()
    setState({ status: 'loading' })
    fetchImpactSummary(latitude, longitude, IMPACT_RADIUS_KM, controller.signal, eventId)
      .then((summary) => setState(summary ? { status: 'ready', summary } : { status: 'unavailable' }))
      .catch((error) => {
        if (controller.signal.aborted) return
        setState({ status: 'unavailable' })
      })
    return () => controller.abort()
  }, [latitude, longitude])

  return state
}
