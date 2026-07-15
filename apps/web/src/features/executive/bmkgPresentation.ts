import type {
  AirQualityObservation,
  AirQualityObservationsResponse,
  AlertSeverity,
  MapOverlay,
  OfficialAlert,
} from '../../lib/api/client'

const severityRank: Record<AlertSeverity, number> = {
  Critical: 3,
  High: 2,
  Moderate: 1,
}

const airRank: Record<string, number> = {
  Baik: 1,
  Sedang: 2,
  'Tidak Sehat': 3,
  'Sangat Tidak Sehat': 4,
  Berbahaya: 5,
}

const indonesiaZoneLabels: Record<string, string> = {
  'Asia/Jakarta': 'WIB',
  'Asia/Makassar': 'WITA',
  'Asia/Jayapura': 'WIT',
}

const BMKG_ATTRIBUTION = 'BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)'

type BmkgSettledResults = [
  PromiseSettledResult<OfficialAlert[]>,
  PromiseSettledResult<OfficialAlert[]>,
  PromiseSettledResult<AirQualityObservationsResponse>,
]

export type BmkgLoadResult = {
  weatherAlerts?: OfficialAlert[]
  airQualityAlerts?: OfficialAlert[]
  observationsResponse?: AirQualityObservationsResponse
  errors: Record<string, string>
}

function timestamp(value: string): number {
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

function optionalTimestamp(value: string | null): number | null {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

export function categoryRank(category: string): number {
  return airRank[category] ?? 0
}

export function formatIndonesiaTime(
  value: string,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Waktu tidak tersedia'

  const supportedZone = indonesiaZoneLabels[timeZone] ? timeZone : 'Asia/Jakarta'
  const formatted = new Intl.DateTimeFormat('id-ID', {
    timeZone: supportedZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
  return `${formatted} ${indonesiaZoneLabels[supportedZone]}`
}

export function sortOfficialAlerts(items: OfficialAlert[]): OfficialAlert[] {
  return [...items].sort((left, right) => {
    const severityDifference = severityRank[right.severity ?? 'Moderate']
      - severityRank[left.severity ?? 'Moderate']
    if (severityDifference !== 0) return severityDifference
    return timestamp(right.effective_at ?? right.sent_at)
      - timestamp(left.effective_at ?? left.sent_at)
  })
}

export function filterActiveOfficialAlerts(
  items: OfficialAlert[],
  now = Date.now(),
): OfficialAlert[] {
  return items.filter((alert) => {
    if (alert.status !== 'active') return false
    const expiresAt = optionalTimestamp(alert.expires_at)
    return expiresAt == null || expiresAt > now
  })
}

export function formatTimeRemaining(value: string | null, now = Date.now()): string {
  const expiresAt = optionalTimestamp(value)
  if (expiresAt == null) return 'Waktu berakhir tidak tersedia'
  const remainingMs = expiresAt - now
  if (remainingMs <= 0) return 'Sudah berakhir'
  const remainingMinutes = Math.floor(remainingMs / 60_000)
  if (remainingMinutes < 1) return '< 1 menit tersisa'
  const hours = Math.floor(remainingMinutes / 60)
  const minutes = remainingMinutes % 60
  if (hours === 0) return `${minutes} menit tersisa`
  if (minutes === 0) return `${hours} jam tersisa`
  return `${hours} jam ${minutes} menit tersisa`
}

export function lifecycleStatusText(
  alert: OfficialAlert,
  now = Date.now(),
  uncertain = false,
): string {
  if (uncertain) return 'Status aktif belum terkonfirmasi'
  const expiresAt = optionalTimestamp(alert.expires_at)
  if (expiresAt != null && expiresAt - now <= 60 * 60 * 1000) {
    return 'Aktif · segera berakhir'
  }
  return 'Aktif'
}

export function sortAirQualityObservations(
  items: AirQualityObservation[],
): AirQualityObservation[] {
  return [...items].sort((left, right) => {
    const categoryDifference = categoryRank(right.category) - categoryRank(left.category)
    if (categoryDifference !== 0) return categoryDifference
    return timestamp(right.observed_at) - timestamp(left.observed_at)
  })
}

export function safeBmkgSourceUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    const hostname = parsed.hostname.toLowerCase()
    if (parsed.protocol !== 'https:') return null
    if (hostname !== 'bmkg.go.id' && !hostname.endsWith('.bmkg.go.id')) return null
    return parsed.href
  } catch {
    return null
  }
}

export function toOfficialAlertOverlays(alerts: OfficialAlert[]): MapOverlay[] {
  return alerts
    .filter((alert) => alert.area_geojson != null
      || (alert.latitude != null && alert.longitude != null))
    .map((alert) => ({
      id: alert.id,
      layer_class: 'official',
      peril_type: alert.peril_type,
      label: alert.headline ?? 'Peringatan resmi BMKG',
      geometry: alert.area_geojson,
      latitude: alert.latitude,
      longitude: alert.longitude,
      radius_km: null,
      effective_at: alert.effective_at,
      expires_at: alert.expires_at,
      data_vintage: null,
      attribution: BMKG_ATTRIBUTION,
      source_url: safeBmkgSourceUrl(alert.source_url),
    }))
}

export function unpackBmkgResults(results: BmkgSettledResults): BmkgLoadResult {
  const errors: Record<string, string> = {}
  const result: BmkgLoadResult = { errors }
  const keys = ['weather', 'air_quality', 'observations'] as const

  results.forEach((settled, index) => {
    if (settled.status === 'rejected') errors[keys[index]] = String(settled.reason)
  })
  if (results[0].status === 'fulfilled') result.weatherAlerts = results[0].value
  if (results[1].status === 'fulfilled') result.airQualityAlerts = results[1].value
  if (results[2].status === 'fulfilled') result.observationsResponse = results[2].value
  return result
}
