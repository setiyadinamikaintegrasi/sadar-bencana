// apps/web/src/lib/api/aseanAirQuality.ts
import { request } from './client'

export type AseanAirQualityEntry = {
  hub_code: string
  hub_name: string
  country: string
  station_name: string
  pm25: number
  aqi_category: string
  measured_at: string
  fetched_at: string
  is_stale: boolean
  age_hours: number
  model_pm25?: number
}

export type AseanAirQualityResponse = {
  data: AseanAirQualityEntry[]
  unhealthy_count: number
  generated_at: string
}

export async function fetchAseanAirQuality(): Promise<AseanAirQualityResponse> {
  return request<AseanAirQualityResponse>('/air-quality/asean')
}

export const COUNTRY_FLAGS: Record<string, string> = {
  MY: '🇲🇾', SG: '🇸🇬', BN: '🇧🇳', TH: '🇹🇭', ID: '🇮🇩',
}

const CATEGORY_TONES: Record<string, string> = {
  'Baik': 'text-emerald-300 bg-emerald-500/10 border-emerald-400/30',
  'Sedang': 'text-amber-300 bg-amber-500/10 border-amber-400/30',
  'Tidak Sehat (rentan)': 'text-orange-300 bg-orange-500/10 border-orange-400/30',
  'Tidak Sehat': 'text-rose-300 bg-rose-500/10 border-rose-400/30',
  'Sangat Tidak Sehat': 'text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-400/30',
  'Berbahaya': 'text-purple-300 bg-purple-500/15 border-purple-400/40',
}

export function aqiTone(category: string): string {
  return CATEGORY_TONES[category] ?? 'text-slate-400 bg-slate-800 border-slate-700'
}

export function pm25BarWidth(pm25: number): number {
  // Skala 0-250 µg/m³ -> 2-100%
  return Math.min(100, Math.max(2, (pm25 / 250) * 100))
}
