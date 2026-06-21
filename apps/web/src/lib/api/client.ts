const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1'

export type Meta = {
  appName: string
  environment: string
  version: string
  apiStatus: string
  timestamp: string | null
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
