// apps/web/src/lib/api/regions.ts
import { request } from './client'

export type RegionPeril = {
  peril_type: string
  count_72h: number
  count_today: number
  max_magnitude: number
  latest_at: string
  first_at: string
}

export type RegionForecastDay = {
  date: string
  rain_probability: number
  rain_sum_mm: number
  wind_max_kmh: number
  weather_label: string
}

export type RegionSituation = {
  forecast?: RegionForecastDay[]
  daylight?: {
    sunrise: string
    sunset: string
    daylight_remaining_hours: number
    is_night: boolean
  }
  code: string
  name: string
  bbox: [number, number, number, number]
  center: [number, number]
  perils: RegionPeril[]
  news_count_7d: number
  top_places: string[]
  severity_index: number
  total_events: number
}

export type RegionSituationResponse = {
  regions: RegionSituation[]
  generated_at: string
  window_hours: number
}

export async function fetchRegionSituation(): Promise<RegionSituationResponse> {
  return request<RegionSituationResponse>('/regions/situation')
}

const PERIL_GLYPHS: Record<string, string> = {
  wildfire: '🔥',
  earthquake: '💥',
  volcano: '🌋',
  flood: '🌊',
  wind: '🌀',
  storm: '🌀',
  tsunami: '🌊',
}

export function perilGlyph(perilType: string): string {
  return PERIL_GLYPHS[perilType] ?? '⚠'
}
