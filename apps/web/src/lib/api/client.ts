const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1'

export type Meta = {
  service: string
  version: string
  environment: string
  endpoints: string[]
}

export type Event = {
  id: string
  event_id: string
  source: string
  event_type: string
  magnitude: number
  latitude: number
  longitude: number
  place: string
  event_time: string
  url: string
  severity: string | null
  created_at: string
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, init)

  if (!res.ok) {
    throw new Error(`API request failed: ${res.status} ${res.statusText}`)
  }

  return (await res.json()) as T
}

export async function getMeta(): Promise<Meta> {
  return request<Meta>('/meta')
}

export async function getEvents(): Promise<Event[]> {
  const res = await request<{ data: Event[]; meta: { count: number; limit: number } }>('/events')
  return res.data
}

export type NewsItem = {
  id: string
  item_id: string
  source: string
  title: string
  summary: string
  url: string
  published_at: string | null
  perils: string[]
  lat: number | null
  lon: number | null
  place_name: string | null
  created_at: string
}

export type NewsResponse = {
  data: NewsItem[]
  meta: { count: number; limit: number }
}

export async function getNews(): Promise<NewsItem[]> {
  const res = await request<NewsResponse>('/news')
  return res.data
}

export type RiskScore = {
  event_id: string
  place: string
  magnitude: number
  score: number
  band: string
  currency: string
  estimated_loss: number
  updated_at: string
}

export type RiskScoresResponse = {
  data: RiskScore[]
  meta: { count: number; limit: number }
}

export async function getRiskScores(): Promise<RiskScoresResponse> {
  return request<RiskScoresResponse>('/risk-scores')
}

export type BriefingTopEvent = {
  event_id: string
  magnitude: number
  place: string | null
  source: string | null
}

export type Briefing = {
  date: string
  summary: string
  event_count: number
  top_events: BriefingTopEvent[]
}

export type BriefingResponse = {
  data: Briefing
}

export async function getBriefing(): Promise<BriefingResponse> {
  return request<BriefingResponse>('/briefings/today')
}

export type ExposureRule = {
  id: string
  region_name: string
  region_keywords: string[]
  total_exposure: number
  currency: string
  risk_multiplier: number
  portfolio_name: string
  estimated_impact: number
}

export type ExposuresResponse = {
  data: ExposureRule[]
  meta: { count: number }
}

export async function getExposures(): Promise<ExposuresResponse> {
  return request<ExposuresResponse>('/exposures')
}

export type ExposureMatch = {
  matched_rule: ExposureRule | null
  estimated_impact: number | null
}

export type ExposureMatchResponse = {
  data: ExposureMatch
}

export async function matchExposure(place: string): Promise<ExposureMatchResponse> {
  const qs = new URLSearchParams({ place })
  return request<ExposureMatchResponse>(`/exposures/match?${qs.toString()}`)
}

export type AlertSeverity = 'Critical' | 'High' | 'Moderate'

export type Alert = {
  id: string
  event_id: string
  source: string
  place: string
  magnitude: number
  event_time: string
  alert_type: string
  severity: AlertSeverity
  message: string
  acknowledged: boolean
  created_at: string
}

export type AlertsResponse = {
  data: Alert[]
  meta: { count: number; unacknowledged: number }
}

export async function getAlerts(): Promise<AlertsResponse> {
  return request<AlertsResponse>('/alerts')
}

export async function acknowledgeAlert(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/alerts/${encodeURIComponent(id)}/acknowledge`, {
    method: 'PATCH',
  })
}
