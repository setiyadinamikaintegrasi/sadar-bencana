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
  return request<Event[]>('/events')
}
