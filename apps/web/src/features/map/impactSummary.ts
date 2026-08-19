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

export interface ImpactSummary {
  population: number | null
  populationVintage: string | null
  facilities: Partial<Record<string, number>> | null
  facilitiesTotal: number | null
  truncated: boolean
}

export type ImpactSummaryState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; summary: ImpactSummary }
  | { status: 'unavailable' }

function toDegrees(value: number): string {
  return value.toFixed(4)
}

/** Poligon kotak ring-km di sekitar titik (cukup untuk estimasi zonal cepat). */
export function impactBoundingBoxPolygon(latitude: number, longitude: number, radiusKm: number): string {
  const dLat = radiusKm / 111.32
  // Floor cosine diterapkan SEBELUM pembagian agar benar-benar membatasi
  // span bujur di lintang tinggi (cos(80°) ≈ 0.17 < floor 0.2).
  const cosLat = Math.max(0.2, Math.cos((latitude * Math.PI) / 180))
  const dLon = radiusKm / (111.32 * cosLat)
  const minLon = toDegrees(longitude - dLon)
  const maxLon = toDegrees(longitude + dLon)
  const minLat = toDegrees(latitude - dLat)
  const maxLat = toDegrees(latitude + dLat)
  return `POLYGON((${minLon} ${minLat}, ${maxLon} ${minLat}, ${maxLon} ${maxLat}, ${minLon} ${maxLat}, ${minLon} ${minLat}))`
}

/** Ambil ringkasan dampak (populasi + fasilitas) untuk satu titik event. */
export async function fetchImpactSummary(
  latitude: number,
  longitude: number,
  radiusKm: number = IMPACT_RADIUS_KM,
  signal?: AbortSignal,
): Promise<ImpactSummary | null> {
  const polygon = encodeURIComponent(impactBoundingBoxPolygon(latitude, longitude, radiusKm))
  const [populationResponse, facilitiesResponse] = await Promise.allSettled([
    fetch(`${API_BASE_URL}/spatial/population-summary?polygon=${polygon}`, { signal }),
    fetch(`${API_BASE_URL}/spatial/critical-facilities?lat=${latitude}&lon=${longitude}&radius_km=${radiusKm}`, { signal }),
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

  if (population === null && facilities === null) return null
  return { population, populationVintage, facilities, facilitiesTotal, truncated }
}

/** Hook: muat ringkasan dampak untuk koordinat event (sekali per koordinat). */
export function useImpactSummary(latitude: number | null, longitude: number | null): ImpactSummaryState {
  const [state, setState] = useState<ImpactSummaryState>({ status: 'idle' })

  useEffect(() => {
    if (latitude === null || longitude === null) {
      setState({ status: 'idle' })
      return
    }
    const controller = new AbortController()
    setState({ status: 'loading' })
    fetchImpactSummary(latitude, longitude, IMPACT_RADIUS_KM, controller.signal)
      .then((summary) => setState(summary ? { status: 'ready', summary } : { status: 'unavailable' }))
      .catch((error) => {
        if (controller.signal.aborted) return
        setState({ status: 'unavailable' })
      })
    return () => controller.abort()
  }, [latitude, longitude])

  return state
}
