import { request } from './client'

export type EvacuationLocationType =
  | 'shelter' | 'tes' | 'tea' | 'posko_bnpb_bpbd' | 'rumah_sakit'
  | 'puskesmas' | 'kantor_polisi' | 'damkar' | 'titik_kumpul'
  | 'pos_sar' | 'gudang_logistik'

export const EVACUATION_TYPE_META: Record<EvacuationLocationType, { label: string; glyph: string }> = {
  shelter: { label: 'Shelter', glyph: '⌂' },
  tes: { label: 'Tempat Evakuasi Sementara', glyph: '◧' },
  tea: { label: 'Tempat Evakuasi Akhir', glyph: '◨' },
  posko_bnpb_bpbd: { label: 'Posko BNPB/BPBD', glyph: '✚' },
  rumah_sakit: { label: 'Rumah Sakit', glyph: 'H' },
  puskesmas: { label: 'Puskesmas', glyph: '+' },
  kantor_polisi: { label: 'Kantor Polisi', glyph: 'P' },
  damkar: { label: 'Damkar', glyph: 'F' },
  titik_kumpul: { label: 'Titik Kumpul', glyph: '◎' },
  pos_sar: { label: 'Pos SAR', glyph: 'S' },
  gudang_logistik: { label: 'Gudang Logistik', glyph: '▤' },
}

export type EvacuationLocation = {
  id: string
  name: string
  location_type: EvacuationLocationType
  source_type: 'osm' | 'manual'
  latitude: number
  longitude: number
  address: string
  photo_url: string
  capacity: number | null
  is_open: boolean | null
  is_full: boolean | null
  phone: string
  person_in_charge: string
  facilities: string[]
  operating_hours: string
  created_at: string
  updated_at: string
  is_active: boolean
}

export type NearestSafePlace = EvacuationLocation & {
  distance_km: number
  walk_minutes: number
  drive_minutes: number
}

export type NearestResponse = {
  origin: { latitude: number; longitude: number }
  disaster_type: string | null
  detection: 'auto' | 'manual' | 'none'
  recommended_types: EvacuationLocationType[] | null
  type_fallback: boolean
  results: NearestSafePlace[]
  radius_km: number
  status_note: string
}

export async function fetchEvacuationLocations(params?: {
  locationType?: EvacuationLocationType
}): Promise<EvacuationLocation[]> {
  const query = params?.locationType ? `?location_type=${params.locationType}` : ''
  const res = await request<{ data: { locations: EvacuationLocation[] } }>(
    `/evacuation-locations${query}`,
  )
  return res.data.locations
}

export async function fetchAllEvacuationLocationsAdmin(): Promise<EvacuationLocation[]> {
  const res = await request<{ data: { locations: EvacuationLocation[] } }>('/evacuation-locations/all')
  return res.data.locations
}

export async function fetchNearestSafePlaces(params: {
  lat: number
  lon: number
  disasterType?: string
  radiusKm?: number
}): Promise<NearestResponse> {
  const qs = new URLSearchParams({ lat: String(params.lat), lon: String(params.lon) })
  if (params.disasterType) qs.set('disaster_type', params.disasterType)
  if (params.radiusKm) qs.set('radius_km', String(params.radiusKm))
  const res = await request<{ data: NearestResponse }>(`/evacuation-locations/nearest?${qs}`)
  return res.data
}

export type EvacuationLocationInput = {
  name: string
  location_type: EvacuationLocationType
  latitude: number
  longitude: number
  address?: string
  photo_url?: string
  capacity?: number | null
  is_open?: boolean | null
  is_full?: boolean | null
  phone?: string
  person_in_charge?: string
  facilities?: string[]
  operating_hours?: string
  is_active?: boolean
}

export async function createEvacuationLocation(input: EvacuationLocationInput): Promise<EvacuationLocation> {
  const res = await request<{ data: EvacuationLocation }>('/evacuation-locations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return res.data
}

export async function updateEvacuationLocation(
  id: string,
  input: EvacuationLocationInput,
): Promise<EvacuationLocation> {
  const res = await request<{ data: EvacuationLocation }>(`/evacuation-locations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return res.data
}

export async function deleteEvacuationLocation(id: string): Promise<void> {
  await request(`/evacuation-locations/${id}`, { method: 'DELETE' })
}

export async function importEvacuationCSV(file: File): Promise<{ inserted: number }> {
  const form = new FormData()
  form.append('file', file)
  const res = await request<{ data: { inserted: number } }>('/evacuation-locations/import', {
    method: 'POST',
    body: form,
  })
  return res.data
}

export async function uploadEvacuationPhoto(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await request<{ data: { photo_url: string } }>('/evacuation-locations/photo', {
    method: 'POST',
    body: form,
  })
  return res.data.photo_url
}
