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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
