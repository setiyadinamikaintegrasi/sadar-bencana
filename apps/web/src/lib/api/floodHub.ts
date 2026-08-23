// apps/web/src/lib/api/floodHub.ts
import { request } from './client'

export type FloodHubGauge = {
  gauge_id: string
  latitude: number
  longitude: number
  river_name: string
  station_name: string
  state: string
  severity_level: number
  severity_label: string
  value: number
  issued_at: string
}

export type FloodHubResponse = {
  data: FloodHubGauge[]
  warning_count: number
  danger_count: number
  generated_at: string
}

export async function fetchFloodHubGauges(): Promise<FloodHubResponse> {
  return request<FloodHubResponse>('/flood-hub/gauges')
}

export const SEVERITY_TONES: Record<number, { color: string; ring: string; label: string }> = {
  1: { color: '#34d399', ring: '#34d399', label: 'Normal' },
  2: { color: '#fbbf24', ring: '#fbbf24', label: 'Waspada' },
  3: { color: '#fb7185', ring: '#fb7185', label: 'Bahaya' },
  4: { color: '#e879f9', ring: '#e879f9', label: 'Bahaya Ekstrem' },
}

export function severityTone(level: number) {
  return SEVERITY_TONES[level] ?? SEVERITY_TONES[1]
}
