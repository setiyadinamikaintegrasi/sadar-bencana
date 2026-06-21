import { request } from './client'

// --- Vessel (AIS / maritime) ---

export type Vessel = {
  mmsi: string
  name: string | null
  ship_type: string | null
  latitude: number
  longitude: number
  sog: number | null // speed over ground (knots)
  cog: number | null // course over ground (degrees)
  heading: number | null
  timestamp: string
  source: string
}

export type VesselsResponse = {
  data: Vessel[]
  meta: { count: number }
}

export async function getVessels(): Promise<Vessel[]> {
  try {
    const res = await request<VesselsResponse>('/assets/marine')
    return res.data
  } catch {
    return []
  }
}

// --- Aircraft (aviation) ---

export type Aircraft = {
  icao24: string
  callsign: string | null
  origin_country: string
  latitude: number
  longitude: number
  altitude: number | null
  velocity: number | null
  heading: number | null
  on_ground: boolean
  timestamp: string
}

export type AircraftResponse = {
  data: Aircraft[]
  meta: { count: number }
}

export async function getAircraft(): Promise<Aircraft[]> {
  try {
    const res = await request<AircraftResponse>('/assets/aviation')
    return res.data
  } catch {
    return []
  }
}
