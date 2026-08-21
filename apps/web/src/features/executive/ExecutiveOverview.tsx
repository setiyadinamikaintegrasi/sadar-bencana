// apps/web/src/features/executive/ExecutiveOverview.tsx
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import SourceBadge from '../../components/SourceBadge'
import MagnitudeFilter from '../../components/MagnitudeFilter'
import RiskMap, {
  ExecutiveMapControls,
  isOverlayActiveAt,
  nextOverlayFocusRequest,
  operationalMapPerils,
  type OverlayFocusRequest,
  type PerilFilter,
  type RiskOverlayClass,
} from '../../components/RiskMap'
import OperationalMap, { type OperationalMapFocusRequest } from '../map/OperationalMap'
import { MapTimeline } from '../map/MapTimeline'
import { sourceQualifiedOperationalMapID, type PublicOperationalMapLayer } from '../map/types'
import { getOperationalMapEngine } from '../../config/mapEngine'
import { useAuth } from '../../lib/auth/AuthProvider'
import { GITHUB_REPOSITORY_URL } from '../../navigation'
import NewsPanel from '../../components/NewsPanel'
import LiveVideoDesk from './LiveVideoDesk'
import BmkgWarningsPanel from './BmkgWarningsPanel'
import { toOfficialAlertOverlays } from './bmkgPresentation'
import { useBmkgWarnings } from './useBmkgWarnings'
import {
  getAlerts,
  getConnectorHealth,
  getEventsWithMeta,
  getMapOverlays,
  getMeta,
  getNews,
  getRiskScores,
  type Alert,
  type ConnectorHealth,
  type Event,
  type Meta,
  type MapOverlay,
  type NewsItem,
  type RiskScore,
} from '../../lib/api/client'

type Severity = 'Critical' | 'High' | 'Medium' | 'Low'
type MomentKind = 'event' | 'news' | 'alert'

type IntelligenceMoment = {
  id: string
  kind: MomentKind
  title: string
  detail: string
  timestamp: string | null
  label: string
  tone: 'rose' | 'amber' | 'blue' | 'emerald' | 'slate'
  url?: string
}

const severityClasses: Record<Severity, string> = {
  Low: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30',
  Medium: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/30',
  High: 'bg-orange-500/15 text-orange-300 ring-1 ring-inset ring-orange-400/30 severity-blink severity-blink--high',
  Critical: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-400/30 severity-blink severity-blink--critical',
}

const perilLabels: Record<string, string> = {
  earthquake: 'Gempa',
  flood: 'Banjir',
  wind: 'Angin',
  storm: 'Badai',
  tsunami: 'Tsunami',
  wildfire: 'Karhutla',
  volcano: 'Vulkanik',
}

function severityFor(magnitude: number): Severity {
  if (magnitude >= 6) return 'Critical'
  if (magnitude >= 5) return 'High'
  if (magnitude >= 4) return 'Medium'
  return 'Low'
}

function isProductionBmkgSource(source: string): boolean {
  return source.trim().toLowerCase() === 'bmkg'
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '—'
  const timestamp = new Date(dateStr).getTime()
  if (Number.isNaN(timestamp)) return '—'
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'Baru saja'
  if (minutes < 60) return `${minutes} menit lalu`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} jam lalu`
  return `${Math.floor(hours / 24)} hari lalu`
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '—'
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  })
}

function earthquakeLocation(place: string): string {
  return place
    .replace(/\s*\((?:tidak\s+)?berpotensi tsunami[^)]*\)\s*$/i, '')
    .trim()
}

function tsunamiStatus(place: string): {
  label: string
  classes: string
} {
  const normalizedPlace = place.toLowerCase()
  if (normalizedPlace.includes('tidak berpotensi tsunami')) {
    return {
      label: 'Tidak berpotensi tsunami',
      classes: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
    }
  }
  if (normalizedPlace.includes('berpotensi tsunami')) {
    return {
      label: 'Berpotensi tsunami',
      classes: 'border-rose-400/40 bg-rose-500/15 text-rose-200',
    }
  }
  return {
    label: 'Status tsunami belum tersedia',
    classes: 'border-slate-600 bg-slate-800/70 text-slate-300',
  }
}

function toneClasses(tone: IntelligenceMoment['tone']): string {
  const map: Record<IntelligenceMoment['tone'], string> = {
    rose: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    blue: 'border-blue-500/30 bg-blue-500/10 text-blue-200',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    slate: 'border-slate-700 bg-slate-800/60 text-slate-200',
  }
  return map[tone]
}


function overlayGeometry(overlay: MapOverlay): GeoJSON.Geometry | undefined {
  if (overlay.geometry) return overlay.geometry as GeoJSON.Geometry
  if (overlay.latitude != null && overlay.longitude != null) {
    return { type: 'Point', coordinates: [overlay.longitude, overlay.latitude] }
  }
  return undefined
}

const HEADER_COLLAPSED_KEY = 'sadar_executive_header_collapsed'

export default function ExecutiveOverview({
  initialOfficialAlertFocus = null,
  onOfficialAlertFocusCleared,
}: {
  initialOfficialAlertFocus?: OverlayFocusRequest | null
  onOfficialAlertFocusCleared: () => void
}) {
  const { session } = useAuth()
  const mapEngine = getOperationalMapEngine()

  const [headerCollapsed, setHeaderCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem(HEADER_COLLAPSED_KEY) === 'true'
    } catch {
      return false
    }
  })

  const toggleHeaderCollapse = useCallback(() => {
    setHeaderCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(HEADER_COLLAPSED_KEY, String(next))
      } catch {
        // localStorage may be unavailable
      }
      return next
    })
  }, [])

  const [events, setEvents] = useState<Event[]>([])
  // Total aktivitas nyata 72 jam (dari meta API) vs feed terkurasi.
  const [eventsWindowTotal, setEventsWindowTotal] = useState<number | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [news, setNews] = useState<NewsItem[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [riskScores, setRiskScores] = useState<RiskScore[]>([])
  const [connectors, setConnectors] = useState<ConnectorHealth[]>([])
  const [mapOverlays, setMapOverlays] = useState<MapOverlay[]>([])
  const bmkg = useBmkgWarnings()
  const reloadBmkg = bmkg.reload
  const [officialAlertFocus, setOfficialAlertFocus] = useState<OverlayFocusRequest | null>(
    initialOfficialAlertFocus,
  )
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [newsLoading, setNewsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [minMagnitude, setMinMagnitude] = useState(0)
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [eventFocusRequest, setEventFocusRequest] = useState<OperationalMapFocusRequest | null>(null)
  const [activePerilFilter, setActivePerilFilter] = useState<PerilFilter>('all')
  const [timelineHoursAgo, setTimelineHoursAgo] = useState(0)
  const [visibleOverlayClasses, setVisibleOverlayClasses] = useState<Set<RiskOverlayClass>>(
    () => new Set(['official', 'static_risk', 'watch_zone']),
  )
  // Layer opsional yang ditambahkan pengguna via legenda peta (S6 shakemap,
  // S7 genangan, P7 pesawat) — melengkapi layer dasar dashboard, bukan
  // menggantikan kontrol kelas overlay.
  const [extraMapLayers, setExtraMapLayers] = useState<PublicOperationalMapLayer[]>([])
  const [monitoringDeskHeight, setMonitoringDeskHeight] = useState<number | null>(null)
  const monitoringDeskRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const [eventsResult, metaData, alertsData, riskScoresData, connectorData, overlayData] = await Promise.all([
        getEventsWithMeta(),
        getMeta(),
        getAlerts().catch(() => ({ data: [], meta: { count: 0, unacknowledged: 0 } })),
        getRiskScores().catch(() => ({ data: [], meta: { count: 0, limit: 0 } })),
        getConnectorHealth().catch(() => []),
        getMapOverlays().catch(() => []),
      ])
      setEvents(eventsResult.data)
      setEventsWindowTotal(eventsResult.meta.window_total ?? null)
      setMeta(metaData)
      setAlerts(alertsData.data)
      setRiskScores(riskScoresData.data)
      setConnectors(connectorData)
      setMapOverlays(overlayData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data.')
    } finally {
      if (mode === 'initial') setLoading(false)
      else setRefreshing(false)
    }
  }, [])

  const loadNews = useCallback(async () => {
    setNewsLoading(true)
    try {
      const data = await getNews()
      setNews(data)
    } catch {
      // News failure is non-blocking — panel shows empty state
    } finally {
      setNewsLoading(false)
    }
  }, [])

  // Harden (critique P2 "Live tanpa liveness"): auto-refresh 60 detik agar
  // badge Live jujur; berhenti saat tab tersembunyi & saat replay timeline.
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null)
  const timelineHoursAgoRef = useRef(timelineHoursAgo)
  timelineHoursAgoRef.current = timelineHoursAgo
  const [nowTick, setNowTick] = useState(() => Date.now())

  const markInitialRefreshed = useCallback(() => setLastRefreshedAt(Date.now()), [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      // Jangan refresh otomatis saat tab tersembunyi (hemat backend) atau
      // saat pengguna sedang replay timeline (mapTime aktif).
      if (document.visibilityState !== 'visible') return
      if (timelineHoursAgoRef.current !== 0) return
      void load('refresh').catch(() => undefined)
      void loadNews().catch(() => undefined)
      void reloadBmkg().catch(() => undefined)
      setLastRefreshedAt(Date.now())
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [load, loadNews, reloadBmkg])

  // Tick 30 detik agar label relatif "X menit lalu" ikut memperbarui.
  useEffect(() => {
    const tick = window.setInterval(() => setNowTick(Date.now()), 30_000)
    return () => window.clearInterval(tick)
  }, [])

  const lastRefreshLabel = useMemo(() => {
    if (lastRefreshedAt == null) return null
    const diffMs = Math.max(0, nowTick - lastRefreshedAt)
    const minutes = Math.floor(diffMs / 60_000)
    if (minutes < 1) return 'baru saja'
    if (minutes === 1) return '1 menit lalu'
    if (minutes < 60) return `${minutes} menit lalu`
    const hours = Math.floor(minutes / 60)
    return hours === 1 ? '1 jam lalu' : `${hours} jam lalu`
  }, [lastRefreshedAt, nowTick])

  // Umumkan perubahan jumlah ke screen reader setelah auto-refresh/manual
  // refresh — "Live" kini terdengar, bukan hanya terlihat.
  const [liveAnnouncement, setLiveAnnouncement] = useState('')
  const prevCountsRef = useRef<{ events: number; news: number } | null>(null)
  useEffect(() => {
    const current = { events: eventsWindowTotal ?? events.length, news: news.length }
    const previous = prevCountsRef.current
    prevCountsRef.current = current
    if (previous == null) return
    if (current.events === previous.events && current.news === previous.news) return
    const parts: string[] = []
    if (current.events !== previous.events) {
      parts.push(`event aktif ${current.events} (sebelumnya ${previous.events})`)
    }
    if (current.news !== previous.news) {
      parts.push(`berita ${current.news} (sebelumnya ${previous.news})`)
    }
    if (parts.length > 0) setLiveAnnouncement(`Data diperbarui: ${parts.join(', ')}.`)
  }, [eventsWindowTotal, events.length, news.length])

  useEffect(() => {
    void load('initial').then(markInitialRefreshed).catch(markInitialRefreshed)
    void loadNews()
  }, [load, loadNews, markInitialRefreshed])

  useEffect(() => {
    if (!initialOfficialAlertFocus) return
    setOfficialAlertFocus(initialOfficialAlertFocus)
    onOfficialAlertFocusCleared()
  }, [
    initialOfficialAlertFocus?.id,
    initialOfficialAlertFocus?.nonce,
    onOfficialAlertFocusCleared,
  ])

  useEffect(() => {
    const monitoringDesk = monitoringDeskRef.current
    if (!monitoringDesk) return

    const updateHeight = () => {
      setMonitoringDeskHeight(Math.ceil(monitoringDesk.getBoundingClientRect().height))
    }
    updateHeight()

    const observer = new ResizeObserver(updateHeight)
    observer.observe(monitoringDesk)
    return () => observer.disconnect()
  }, [])

  const handleRefresh = useCallback(() => {
    void load('refresh')
    void loadNews()
    void reloadBmkg()
    setLastRefreshedAt(Date.now())
  }, [load, loadNews, reloadBmkg])

  const handleEventClick = useCallback((event: Event) => {
    setOfficialAlertFocus(null)
    onOfficialAlertFocusCleared()
    setSelectedEvent(event)
    setEventFocusRequest((current) => ({
      id: sourceQualifiedOperationalMapID(event.source, event.event_id),
      geometry: { type: 'Point', coordinates: [event.longitude, event.latitude] },
      nonce: (current?.nonce ?? 0) + 1,
    }))
  }, [onOfficialAlertFocusCleared])

  const handleClearSelection = useCallback(() => {
    setSelectedEvent(null)
    setEventFocusRequest(null)
  }, [])

  const filteredEvents = useMemo(
    () => events.filter((e) => e.magnitude >= minMagnitude),
    [events, minMagnitude],
  )

  // Export CSV watchlist (seluruh event terfilter, bukan hanya halaman aktif)
  // — RFC 4180: escape kutip & koma, CRLF line ending utk Excel.
  const handleExportWatchlistCsv = useCallback(() => {
    const escapeCsv = (value: string | number | null | undefined): string => {
      const text = value == null ? '' : String(value)
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const header = ['Waktu (WIB)', 'Kejadian', 'Tingkat', 'Magnitudo', 'Sumber', 'Latitude', 'Longitude']
    const rows = filteredEvents.map((event) => [
      formatDateTime(event.event_time),
      event.place,
      severityFor(event.magnitude),
      event.magnitude.toString(),
      event.source,
      event.latitude.toFixed(4),
      event.longitude.toFixed(4),
    ])
    const csv = [header, ...rows]
      .map((row) => row.map(escapeCsv).join(','))
      .join('\r\n')
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `watchlist-sadarbencana-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [filteredEvents])


  // Harden (critique P3): pagination watchlist — 40 baris/halaman, seluruh
  // event kini terjangkau; export CSV utk serah terima analisis.
  const WATCHLIST_PAGE_SIZE = 10
  const [watchlistPage, setWatchlistPage] = useState(0)
  const watchlistPageCount = Math.max(1, Math.ceil(filteredEvents.length / WATCHLIST_PAGE_SIZE))
  const safeWatchlistPage = Math.min(watchlistPage, watchlistPageCount - 1)
  const visibleWatchlistEvents = useMemo(
    () => filteredEvents.slice(safeWatchlistPage * WATCHLIST_PAGE_SIZE, (safeWatchlistPage + 1) * WATCHLIST_PAGE_SIZE),
    [filteredEvents, safeWatchlistPage],
  )
  useEffect(() => { setWatchlistPage(0) }, [minMagnitude])

  // Gempa signifikan GLOBAL: M>=6.0 di luar wilayah Indonesia ( bounding
  // box rough Indonesia ) — event seperti Peru M6.7 nyaris tak tersasar
  // karena peta default Indonesia & tanpa notice. Kritik user: sulit ditemukan.
  const INDONESIA_BBOX = { minLat: -12, maxLat: 8, minLng: 94, maxLng: 142 }
  const significantGlobalEvents = useMemo(() => {
    return events
      .filter((event) => {
        const eventType = event.event_type.toLowerCase()
        const isQuake = eventType.includes('earthquake') || eventType.includes('quake')
        const outsideIndonesia = event.latitude < INDONESIA_BBOX.minLat
          || event.latitude > INDONESIA_BBOX.maxLat
          || event.longitude < INDONESIA_BBOX.minLng
          || event.longitude > INDONESIA_BBOX.maxLng
        return isQuake && event.magnitude >= 6 && outsideIndonesia
      })
      .sort((left, right) => new Date(right.event_time).getTime() - new Date(left.event_time).getTime())
      .slice(0, 3)
  }, [events])

  const handleFocusGlobalEvent = useCallback((event: Event) => {
    setActivePerilFilter('earthquake')
    handleEventClick(event)
  }, [handleEventClick])

  const latestBmkgEarthquake = useMemo(() => {
    return events
      .filter((event) => {
        const eventType = event.event_type.toLowerCase()
        return isProductionBmkgSource(event.source)
          && (eventType.includes('earthquake') || eventType.includes('quake'))
      })
      .sort(
        (left, right) =>
          new Date(right.event_time).getTime() - new Date(left.event_time).getTime(),
      )[0] ?? null
  }, [events])

  const handleFocusLatestEarthquake = useCallback(() => {
    if (!latestBmkgEarthquake) return
    setActivePerilFilter('earthquake')
    handleEventClick(latestBmkgEarthquake)
  }, [handleEventClick, latestBmkgEarthquake])

  const handleFocusOfficialAlert = useCallback((id: string) => {
    setSelectedEvent(null)
    setEventFocusRequest(null)
    setOfficialAlertFocus((current) => nextOverlayFocusRequest(current, id))
  }, [])

  const combinedMapOverlays = useMemo(() => {
    const overlaysById = new Map(mapOverlays.map((overlay) => [overlay.id, overlay]))
    toOfficialAlertOverlays([...bmkg.weatherAlerts, ...bmkg.airQualityAlerts]).forEach((overlay) => {
      overlaysById.set(overlay.id, overlay)
    })
    return Array.from(overlaysById.values())
  }, [bmkg.airQualityAlerts, bmkg.weatherAlerts, mapOverlays])

  const mapTime = useMemo(
    () => timelineHoursAgo === 0 ? null : new Date(Date.now() - timelineHoursAgo * 60 * 60 * 1000).toISOString(),
    [timelineHoursAgo],
  )
  const visibleOperationalLayers = useMemo(() => {
    const layers: PublicOperationalMapLayer[] = []
    if (activePerilFilter !== 'news') layers.push('events')
    if (visibleOverlayClasses.has('official')) layers.push('official-alerts')
    layers.push('air-quality')
    for (const extra of extraMapLayers) {
      if (!layers.includes(extra)) layers.push(extra)
    }
    return layers
  }, [activePerilFilter, visibleOverlayClasses, extraMapLayers])
  const operationalPrivateLayers = useMemo(() => {
    if (!session) return []
    return visibleOverlayClasses.has('watch_zone')
      ? (['watch-zones', 'personal-assets'] as const)
      : (['personal-assets'] as const)
  }, [session, visibleOverlayClasses])
  const operationalLocalOverlay = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = []
    if (visibleOverlayClasses.has('static_risk')) {
      combinedMapOverlays
        .filter((overlay) => overlay.layer_class === 'static_risk')
        .forEach((overlay) => {
          const geometry = overlayGeometry(overlay)
          if (geometry) features.push({ type: 'Feature', id: overlay.id, geometry, properties: { kind: 'static-risk', label: overlay.label } })
        })
    }
    news
      .filter((item) => item.lat != null && item.lon != null)
      // Filter News menampilkan seluruh item berkoordinat (klaster di peta
      // menangani tumpukan koordinat); tampilan lain cukup 20 penanda dekoratif.
      .slice(0, activePerilFilter === 'news' ? news.length : 20)
      .forEach((item) => features.push({
        type: 'Feature', id: `news-${item.id}`, geometry: { type: 'Point', coordinates: [item.lon!, item.lat!] }, properties: { kind: 'news', label: item.title },
      }))
    return { type: 'FeatureCollection', features }
  }, [activePerilFilter, combinedMapOverlays, news, visibleOverlayClasses])
  const operationalFocusRequest = useMemo<OperationalMapFocusRequest | null>(() => {
    if (eventFocusRequest) return eventFocusRequest
    if (!officialAlertFocus) return null
    const alert = [...bmkg.weatherAlerts, ...bmkg.airQualityAlerts].find((item) => item.id === officialAlertFocus.id)
    if (alert) {
      const geometry = alert.area_geojson as GeoJSON.Geometry | null
      return {
        id: sourceQualifiedOperationalMapID(alert.source, alert.source_alert_id),
        geometry: geometry ?? (alert.latitude != null && alert.longitude != null
          ? { type: 'Point', coordinates: [alert.longitude, alert.latitude] }
          : undefined),
        nonce: officialAlertFocus.nonce,
      }
    }
    const overlay = combinedMapOverlays.find((item) => item.id === officialAlertFocus.id)
    return overlay ? { geometry: overlayGeometry(overlay), nonce: officialAlertFocus.nonce } : null
  }, [bmkg.airQualityAlerts, bmkg.weatherAlerts, combinedMapOverlays, eventFocusRequest, officialAlertFocus])

  const toggleOverlayClass = useCallback((layerClass: RiskOverlayClass) => {
    setVisibleOverlayClasses((current) => {
      const next = new Set(current)
      if (next.has(layerClass)) next.delete(layerClass)
      else next.add(layerClass)
      return next
    })
  }, [])

  useEffect(() => {
    if (!officialAlertFocus) return
    const warningStateConfirmed = !loading
      && !bmkg.loading
      && bmkg.status.weather.loaded
      && !bmkg.status.weather.uncertain
      && bmkg.status.air_quality.loaded
      && !bmkg.status.air_quality.uncertain
    if (!warningStateConfirmed) return
    const focusedOverlay = combinedMapOverlays.find(
      (overlay) => overlay.id === officialAlertFocus.id && overlay.layer_class === 'official',
    )
    if (!focusedOverlay || !isOverlayActiveAt(focusedOverlay, bmkg.now)) {
      setOfficialAlertFocus(null)
      onOfficialAlertFocusCleared()
    }
  }, [
    bmkg.airQualityAlerts,
    bmkg.loading,
    bmkg.now,
    bmkg.status.air_quality.loaded,
    bmkg.status.air_quality.uncertain,
    bmkg.status.weather.loaded,
    bmkg.status.weather.uncertain,
    bmkg.weatherAlerts,
    combinedMapOverlays,
    loading,
    onOfficialAlertFocusCleared,
    officialAlertFocus,
  ])

  const unacknowledgedAlerts = useMemo(
    () => alerts.filter((alert) => !alert.acknowledged).length,
    [alerts],
  )

  const connectorSummary = useMemo(() => {
    const ok = connectors.filter((connector) => connector.status === 'ok').length
    const stale = connectors.filter((connector) => connector.status === 'stale').length
    const errorCount = connectors.filter((connector) => connector.status === 'error').length
    return { ok, stale, error: errorCount }
  }, [connectors])

    const intelligenceMoments = useMemo<IntelligenceMoment[]>(() => {
    const eventMoments = events.map((event) => {
      const severity = severityFor(event.magnitude)
      return {
        id: `event-${event.id}`,
        kind: 'event' as const,
        title: `${severity} · M${event.magnitude.toFixed(1)} ${event.place.split(',')[0]}`,
        detail: `${perilLabels[event.event_type] ?? event.event_type} signal from ${event.source.toUpperCase()}`,
        timestamp: event.event_time,
        label: 'CAT Event',
        tone: (severity === 'Critical' ? 'rose' : severity === 'High' ? 'amber' : 'blue') as IntelligenceMoment['tone'],
        url: event.url || undefined,
      }
    })

    const newsMoments = news.map((item) => ({
      id: `news-${item.id}`,
      kind: 'news' as const,
      title: item.title,
      detail: item.summary || `${item.source.toUpperCase()} · ${item.place_name ?? 'Indonesia'}`,
      timestamp: item.published_at,
      label: item.source.toUpperCase(),
      tone: 'emerald' as const,
      url: item.url,
    }))

    const alertMoments = alerts.map((alert) => ({
      id: `alert-${alert.id}`,
      kind: 'alert' as const,
      title: alert.message,
      detail: `${alert.alert_type.replace(/_/g, ' ')} · ${alert.severity}`,
      timestamp: alert.created_at,
      label: 'Alert',
      tone: alert.severity === 'Critical' ? ('rose' as const) : ('amber' as const),
    }))

    return [...eventMoments, ...newsMoments, ...alertMoments]
      .sort((a, b) => new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime())
      .slice(0, 18)
  }, [alerts, events, news])

  const topRiskScore = riskScores[0]
  const kpis = useMemo(() => {
    const maxMagnitude =
      events.length > 0 ? Math.max(...events.map((e) => e.magnitude)).toFixed(1) : '—'
    const topSource = events.length > 0 ? events[0].source.toUpperCase() : '—'
    return [
      {
        label: 'Event Aktif',
        targetId: 'section-watchlist',
        value: eventsWindowTotal != null ? eventsWindowTotal.toString() : events.length.toString(),
        caption: eventsWindowTotal != null
          ? `Kejadian nyata 72 jam terakhir · ${events.length} ditampilkan di peta & watchlist (kurasi per jenis).`
          : 'Kejadian bencana yang saat ini dimuat monitor.',
      },
      {
        label: 'Magnitudo Maks',
        targetId: 'section-watchlist',
        value: maxMagnitude,
        caption: 'Magnitudo terkuat pada himpunan event aktif.',
      },
      {
        label: 'Alert Terbuka',
        targetId: 'section-bmkg-warnings',
        value: unacknowledgedAlerts.toString(),
        caption: 'Alert operasional belum diketahui yang menunggu tinjauan.',
      },
      {
        label: 'Status API',
        value: meta ? 'Terhubung' : 'Offline',
        caption: meta
          ? `${meta.service} · ${meta.environment} · v${meta.version} · ${topSource}`
          : 'Backend tidak terjangkau. Pastikan layanan API berjalan.',
      },
    ]
  }, [events, eventsWindowTotal, meta, unacknowledgedAlerts])

  return (
    <div className="space-y-4 md:space-y-5">
      {/* Pengumuman perubahan jumlah pasca auto-refresh bagi screen reader. */}
      <p className="sr-only" role="status" aria-live="polite">{liveAnnouncement}</p>

      {/* Banner Situational Awareness — Mendukung Mode Ringkas / Tampil */}
      {headerCollapsed ? (
        <section
          id="executive-situational-banner"
          className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800/80 bg-slate-950/70 px-4 py-2 text-xs text-slate-400 shadow-md transition-all duration-200"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-indigo-200">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Live
            </span>
            <span className="font-semibold text-slate-200">Situational Awareness</span>
            {topRiskScore?.place && (
              <span className="hidden text-slate-400 md:inline">
                · Risiko teratas: <strong className="font-medium text-rose-300">{topRiskScore.place} (M{topRiskScore.magnitude ?? '—'})</strong>
              </span>
            )}
            <span className="hidden rounded-full bg-slate-900 px-2 py-0.5 text-[10px] text-slate-400 sm:inline">
              {(eventsWindowTotal ?? events.length)} event 72 jam · {news.length} news · {connectorSummary.ok} OK
            </span>
          </div>
          <button
            type="button"
            onClick={toggleHeaderCollapse}
            aria-expanded="false"
            aria-controls="executive-situational-banner"
            title="Tampilkan ringkasan Situational Awareness lengkap"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-900/90 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:border-indigo-400/50 hover:bg-slate-800 hover:text-indigo-200"
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Tampilkan Ringkasan</span>
            <span className="sm:hidden">Buka</span>
          </button>
        </section>
      ) : (
        <section
          id="executive-situational-banner"
          className="overflow-hidden rounded-2xl border border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(79,70,229,0.25),_transparent_40%),linear-gradient(135deg,_rgba(15,23,42,0.98),_rgba(2,6,23,0.98))] px-4 py-3 shadow-xl shadow-slate-950/40 transition-all duration-200 md:px-5"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-200">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Live
                </span>
                <h1 className="truncate text-lg font-bold tracking-tight text-slate-50 md:text-xl">
                  Situational Awareness Dashboard
                </h1>
                {lastRefreshLabel && (
                  <span
                    className="rounded-full border border-slate-700/80 bg-slate-950/60 px-2 py-0.5 text-[10px] font-medium text-slate-400"
                    title={`Data diperbarui otomatis tiap 60 detik. Terakhir: ${lastRefreshLabel}.`}
                  >
                    diperbarui {lastRefreshLabel}
                  </span>
                )}
              </div>
              <p className="mt-1 truncate text-xs text-slate-400">
                {topRiskScore?.place
                  ? `Top risk: ${topRiskScore.place} · M${topRiskScore.magnitude ?? '—'} · ${topRiskScore.source?.toUpperCase() ?? 'SOURCE'}`
                  : 'Events · RSS · Alerts · Source Health'}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden shrink-0 items-stretch gap-2 sm:flex">
                <div className="rounded-xl border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-center">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Risiko Teratas</p>
                  <p className="text-lg font-bold leading-tight text-rose-300">{topRiskScore?.score ?? '—'}</p>
                </div>
                <div className="rounded-xl border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-center">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">News</p>
                  <p className="text-lg font-bold leading-tight text-emerald-300">{news.length}</p>
                </div>
                <div className="rounded-xl border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-center">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Sumber OK</p>
                  <p className="text-lg font-bold leading-tight text-indigo-300">{connectorSummary.ok}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={toggleHeaderCollapse}
                aria-expanded="true"
                aria-controls="executive-situational-banner"
                title="Sembunyikan ringkasan atas agar peta lebih tinggi"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-950/60 px-2.5 py-1.5 text-xs font-medium text-slate-400 transition hover:border-indigo-400/50 hover:bg-slate-800 hover:text-slate-200"
              >
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
                <span className="hidden md:inline">Ringkas</span>
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-3xl border border-slate-800 bg-slate-900/95 p-3 shadow-2xl shadow-slate-950/50 md:p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 md:mb-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold tracking-tight text-slate-50">Executive Risk Map</h3>
            <span className="rounded-full border border-indigo-400/30 bg-indigo-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-200">
              Interactive command map
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-slate-400">
            {events.length > 0 && eventsWindowTotal != null && (
              <span
                className="rounded-full border border-slate-800 bg-slate-950/80 px-2.5 py-0.5"
                title={`Total kejadian nyata 72 jam terakhir: ${eventsWindowTotal}. Feed peta & watchlist menampilkan ${events.length} event terpilih (kurasi per jenis bencana).`}
              >
                <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" aria-hidden="true" />
                {eventsWindowTotal} event 72 jam · {events.length} di peta
              </span>
            )}
            {events.length > 0 && eventsWindowTotal == null && (
              <span className="rounded-full border border-slate-800 bg-slate-950/80 px-2.5 py-0.5">
                <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" aria-hidden="true" />
                {events.length} events
              </span>
            )}
            <span className="rounded-full border border-slate-800 bg-slate-950/80 px-2.5 py-0.5">
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" aria-hidden="true" />
              {news.length} news
            </span>
          </div>
        </div>

        {loading ? (
          <div
            className="flex items-center justify-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 text-sm text-slate-400"
            style={{ height: 'min(58vh, 680px)' }}
          >
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400" />
            Loading map…
          </div>
        ) : (
          <>
            <ExecutiveMapControls
              events={events}
              news={news}
              activePerilFilter={activePerilFilter}
              onFilterChange={setActivePerilFilter}
              visibleOverlayClasses={visibleOverlayClasses}
              onOverlayClassToggle={toggleOverlayClass}
              timelineHoursAgo={timelineHoursAgo}
              onTimelineChange={setTimelineHoursAgo}
              hideTimeSlider={mapEngine === 'maplibre'}
            />
            {mapEngine === 'maplibre' ? (
              <div className="relative">
                <OperationalMap
                  mode="viewer"
                  initialLayers={['events', 'official-alerts', 'air-quality']}
                  visibleLayers={visibleOperationalLayers}
                  showLegend
                  perils={operationalMapPerils(activePerilFilter)}
                  mapTime={mapTime}
                  authenticated={Boolean(session)}
                  privateOwnerKey={session?.user.id}
                  privateLayers={operationalPrivateLayers}
                  localOverlay={operationalLocalOverlay}
                  focusRequest={operationalFocusRequest}
                  onFeatureSelect={(feature) => {
                    if (feature.properties.layer !== 'events') return
                    const selected = events.find((event) => (
                      sourceQualifiedOperationalMapID(event.source, event.event_id) === feature.id
                    ))
                    if (selected) handleEventClick(selected)
                  }}
                  className="h-[min(58vh,680px)] md:h-[min(75vh,680px)]"
                />
                {/* Replay timeline: menyapu window 72 jam di atas peta. */}
                <MapTimeline
                  hoursAgo={timelineHoursAgo}
                  onChange={setTimelineHoursAgo}
                  className="absolute bottom-3 left-1/2 z-10 w-[min(34rem,calc(100%-1.5rem))] -translate-x-1/2"
                />
              </div>
            ) : (
              <RiskMap
                events={events}
                news={news}
                overlays={combinedMapOverlays}
                activePerilFilter={activePerilFilter}
                onEventClick={handleEventClick}
                selectedEvent={selectedEvent}
                selectedOverlayId={officialAlertFocus?.id}
                overlayFocusNonce={officialAlertFocus?.nonce}
                timelineHoursAgo={timelineHoursAgo}
                visibleOverlayClasses={visibleOverlayClasses}
                height="min(58vh, 680px)"
              />
            )}
          </>
        )}

        {/* Gempa Signifikan Global: M>=6.0 di luar Indonesia — notice proaktif
         * agar event seperti Peru M6.7 tidak tenggelam (kritik user). */}
        {significantGlobalEvents.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-2xl border border-rose-400/25 bg-gradient-to-r from-rose-500/10 via-slate-950/80 to-slate-950/80">
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/30 bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-rose-200">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" aria-hidden="true" />
                  Gempa Signifikan Global
                </span>
                <p className="text-xs text-slate-400">M ≥ 6,0 di luar wilayah Indonesia · 72 jam terakhir · sumber USGS/GDACS</p>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {significantGlobalEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => handleFocusGlobalEvent(event)}
                    aria-label={`Fokuskan gempa ${event.magnitude} ${event.place} di peta`}
                    className="group rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-left transition hover:border-rose-400/50 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`flex h-9 w-12 shrink-0 flex-col items-center justify-center rounded-lg border text-[10px] font-bold leading-none ${
                        event.magnitude >= 7
                          ? 'severity-blink severity-blink--critical border-rose-300/40 bg-rose-500/20 text-rose-100'
                          : 'border-orange-300/30 bg-orange-500/15 text-orange-100'
                      }`}>
                        <span className="text-[8px] font-semibold uppercase tracking-wide opacity-70">Mag</span>
                        <span className="text-sm font-black">{event.magnitude.toFixed(1)}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-100" title={event.place}>{event.place}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {formatRelativeTime(event.event_time)} · {formatDateTime(event.event_time)} WIB · sumber {event.source.toUpperCase()}
                        </p>
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] font-medium text-rose-300/80 opacity-0 transition group-hover:opacity-100">
                      Fokuskan di peta →
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 overflow-hidden rounded-2xl border border-orange-400/20 bg-gradient-to-r from-orange-500/10 via-slate-950/80 to-slate-950/80">
          {loading ? (
            <div className="h-28 animate-pulse bg-slate-800/50" />
          ) : latestBmkgEarthquake ? (
            <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
              <div className="flex items-center gap-3 lg:min-w-[250px]">
                <div
                  className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl border border-orange-300/30 bg-orange-500/15 text-orange-100 ${
                    severityFor(latestBmkgEarthquake.magnitude) === 'Critical' ? 'severity-blink severity-blink--critical' : ''
                  }`}
                >
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange-300">Mag</span>
                  <span className="text-2xl font-black leading-none">{latestBmkgEarthquake.magnitude.toFixed(1)}</span>
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-semibold text-slate-50">Gempa Terbaru BMKG</h4>
                    <span className="rounded-full border border-sky-400/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-200">
                      Sumber resmi
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {formatRelativeTime(latestBmkgEarthquake.event_time)} · {formatDateTime(latestBmkgEarthquake.event_time)} WIB
                  </p>
                </div>
              </div>

              <div className="min-w-0 flex-1 border-slate-800 lg:border-l lg:pl-5">
                <p className="truncate text-sm font-semibold text-slate-100" title={earthquakeLocation(latestBmkgEarthquake.place)}>
                  {earthquakeLocation(latestBmkgEarthquake.place)}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span>
                    {latestBmkgEarthquake.latitude.toFixed(3)}, {latestBmkgEarthquake.longitude.toFixed(3)}
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-1 font-medium ${tsunamiStatus(latestBmkgEarthquake.place).classes}`}
                  >
                    {tsunamiStatus(latestBmkgEarthquake.place).label}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleFocusLatestEarthquake}
                className="shrink-0 rounded-xl border border-indigo-400/30 bg-indigo-500/15 px-4 py-2.5 text-sm font-semibold text-indigo-100 transition hover:border-indigo-300/60 hover:bg-indigo-500/25 focus:outline-none focus:ring-2 focus:ring-indigo-400/60"
              >
                Fokuskan di peta
              </button>
            </div>
          ) : (
            <div className="p-5 text-center">
              <p className="text-sm font-semibold text-slate-300">Belum ada event gempa BMKG pada data aktif.</p>
              <p className="mt-1 text-xs text-slate-500">Ringkasan akan muncul otomatis setelah connector BMKG menerima data terbaru.</p>
            </div>
          )}
        </div>
      </section>

      <div id="section-bmkg-warnings">
        <BmkgWarningsPanel
        weatherAlerts={bmkg.weatherAlerts}
        airQualityAlerts={bmkg.airQualityAlerts}
        observations={bmkg.observations}
        sourceActive={bmkg.sourceActive}
        loading={bmkg.loading}
        errors={bmkg.errors}
        status={bmkg.status}
        now={bmkg.now}
        onFocusAlert={handleFocusOfficialAlert}
        onRetry={reloadBmkg}
        />
      </div>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {kpis.map((item) => {
          const interactive = Boolean(item.targetId)
          return (
            <article
              key={item.label}
              className={`rounded-2xl border border-slate-800 bg-slate-900/85 px-4 py-3 shadow-xl shadow-slate-950/30 ${
                interactive ? 'cursor-pointer transition hover:border-indigo-400/50 hover:bg-slate-800/85' : ''
              }`}
            >
              {interactive ? (
                <button
                  type="button"
                  onClick={() => document.getElementById(item.targetId!)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 rounded-2xl"
                  aria-label={`Lihat detail ${item.label}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{item.label}</p>
                    <p className="text-2xl font-bold leading-none text-slate-50">{item.value}</p>
                  </div>
                  <p className="mt-2 line-clamp-1 text-xs text-slate-400">{item.caption}</p>
                </button>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{item.label}</p>
                    <p className="text-2xl font-bold leading-none text-slate-50">{item.value}</p>
                  </div>
                  <p className="mt-2 line-clamp-1 text-xs text-slate-400">{item.caption}</p>
                </>
              )}
            </article>
          )
        })}
      </section>

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <article
          className="flex max-h-[720px] min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-slate-950/40 xl:h-[var(--monitoring-desk-height)] xl:max-h-none"
          style={
            monitoringDeskHeight
              ? ({ '--monitoring-desk-height': `${monitoringDeskHeight}px` } as CSSProperties)
              : undefined
          }
        >
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-50">Live Intelligence Moments</h3>
              <p className="text-xs text-slate-500">Timeline gabungan event, RSS/news signal, dan alert.</p>
            </div>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
              {intelligenceMoments.length} moments
            </span>
          </div>
          <div className="risk-news-ticker border-b border-slate-800 bg-slate-950/70 px-4 py-2 text-xs text-slate-300">
            {/* Track marquee digandakan utk animasi tak berputar; salinan ke-2
             *  disembunyikan dari screen reader agar berita tidak dibaca 2x. */}
            <div className="risk-news-ticker__track" aria-hidden={news.length > 0}>
              {[...news.slice(0, 6), ...news.slice(0, 6)].map((item, index) => (
                <span key={`${item.id}-${index}`} className="mr-8 inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                  {item.source.toUpperCase()}: {item.title}
                </span>
              ))}
              {news.length === 0 && <span>Menunggu RSS/news feed dari backend…</span>}
            </div>
            {/* Versi statis utk screen reader & reduced-motion: daftar rapi tanpa duplikasi. */}
            <ul className="sr-only">
              {news.slice(0, 6).map((item) => (
                <li key={item.id}>{item.source.toUpperCase()}: {item.title}</li>
              ))}
            </ul>
          </div>
          <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-4 md:grid-cols-2 xl:grid-cols-3">
            {loading || newsLoading ? (
              Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-32 animate-pulse rounded-xl bg-slate-800/70" />
              ))
            ) : intelligenceMoments.length === 0 ? (
              <div className="col-span-full rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
                Belum ada moment yang dapat ditampilkan.
              </div>
            ) : (
              intelligenceMoments.map((moment) => (
                <article
                  key={moment.id}
                  className={`rounded-xl border p-4 transition hover:-translate-y-0.5 hover:border-indigo-400/40 ${toneClasses(moment.tone)}`}
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-wide">{moment.label}</span>
                    <span className="text-[10px] opacity-70">{formatRelativeTime(moment.timestamp)}</span>
                  </div>
                  <p className="line-clamp-2 text-sm font-semibold text-slate-50">{moment.title}</p>
                  <p className="mt-2 line-clamp-2 text-xs text-slate-300/80">{moment.detail}</p>
                  <div className="mt-4 flex items-center justify-between text-[10px] text-slate-400">
                    <span>{formatDateTime(moment.timestamp)}</span>
                    {moment.url && (
                      <a
                        href={moment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-indigo-300 hover:text-indigo-200"
                      >
                        Open ↗
                      </a>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </article>

        <div ref={monitoringDeskRef} className="self-start">
          <LiveVideoDesk />
        </div>
      </section>


      <section className="grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-6">
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <h3 id="section-watchlist" className="text-xl font-semibold text-slate-50">Priority Event Watchlist</h3>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {filteredEvents.length > WATCHLIST_PAGE_SIZE && (
                <div className="flex items-center gap-1.5 text-xs text-slate-400" role="group" aria-label="Navigasi halaman watchlist">
                  <button
                    type="button"
                    onClick={() => setWatchlistPage((p) => Math.max(0, p - 1))}
                    disabled={safeWatchlistPage === 0}
                    aria-label="Halaman sebelumnya"
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 font-medium transition hover:border-indigo-400 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
                  >
                    ‹
                  </button>
                  <span className="px-1 tabular-nums">
                    {safeWatchlistPage + 1}/{watchlistPageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setWatchlistPage((p) => Math.min(watchlistPageCount - 1, p + 1))}
                    disabled={safeWatchlistPage >= watchlistPageCount - 1}
                    aria-label="Halaman berikutnya"
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 font-medium transition hover:border-indigo-400 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
                  >
                    ›
                  </button>
                  <span className="ml-1 hidden text-slate-500 sm:inline">{filteredEvents.length} event</span>
                </div>
              )}
              <button
                type="button"
                onClick={handleExportWatchlistCsv}
                disabled={filteredEvents.length === 0}
                aria-label="Ekspor watchlist sebagai CSV"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-indigo-400 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
              >
                CSV ⭳
              </button>
              <MagnitudeFilter value={minMagnitude} onChange={setMinMagnitude} />
              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading || refreshing}
                className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-indigo-400 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {refreshing ? 'Menyegarkan…' : 'Segarkan'}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-400">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400" />
              Loading events...
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-6 text-sm text-rose-200">
              <p className="font-semibold text-rose-100">Failed to load events</p>
              <p className="mt-2 break-words text-rose-300/80">{error}</p>
              <p className="mt-3 text-rose-300/60">
                Verify the API is running and reachable via the Vite proxy.
              </p>
            </div>
          ) : events.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-800/50 p-8 text-center">
              <p className="text-sm font-medium text-slate-200">No events ingested yet</p>
              <p className="mt-2 text-sm text-slate-400">
                Trigger an ingest run via{' '}
                <code className="rounded bg-slate-900 px-1.5 py-0.5 text-xs text-indigo-300">
                  POST /api/v1/worker/ingest
                </code>{' '}
                to populate the watchlist.
              </p>
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-800/50 p-8 text-center">
              <p className="text-sm font-medium text-slate-200">No events match this magnitude filter</p>
              <p className="mt-2 text-sm text-slate-400">
                Lower the minimum magnitude to show more watchlist events.
              </p>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="pb-3 pr-6 font-medium">Kejadian</th>
                      <th className="pb-3 pr-6 font-medium">Tingkat</th>
                      <th className="pb-3 pr-6 font-medium">Sumber</th>
                      <th className="pb-3 font-medium">Waktu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {visibleWatchlistEvents.map((row) => {
                      const severity = severityFor(row.magnitude)
                      const isSelected = selectedEvent?.id === row.id
                      return (
                        <tr
                          key={row.id}
                          tabIndex={0}
                          role="button"
                          aria-pressed={isSelected}
                          aria-label={`${row.place}, tingkat ${severity}, sumber ${row.source}`}
                          className={`cursor-pointer text-slate-200 transition hover:bg-slate-800/50 focus-visible:bg-slate-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 ${
                            isSelected ? 'bg-indigo-500/10 ring-1 ring-inset ring-indigo-400/20' : ''
                          }`}
                          onClick={() => handleEventClick(row)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              handleEventClick(row)
                            }
                          }}
                        >
                          <td className="py-4 pr-6">{row.place}</td>
                          <td className="py-4 pr-6">
                            <span
                              className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${severityClasses[severity]}`}
                            >
                              {severity}
                            </span>
                          </td>
                          <td className="py-4 pr-6 align-top">
                            <SourceBadge source={row.source} timestamp={row.created_at} />
                          </td>
                          <td className="py-4 pr-6 text-slate-400">
                            {formatDateTime(row.event_time)} WIB
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 md:hidden">
                {visibleWatchlistEvents.map((row) => {
                  const severity = severityFor(row.magnitude)
                  const isSelected = selectedEvent?.id === row.id
                  return (
                    <article
                      key={row.id}
                      tabIndex={0}
                      role="button"
                      aria-pressed={isSelected}
                      aria-label={`${row.place}, tingkat ${severity}, sumber ${row.source}`}
                      className={`cursor-pointer rounded-xl border border-slate-800 bg-slate-800/50 p-4 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 ${
                        isSelected ? 'ring-1 ring-indigo-400/40' : ''
                      }`}
                      onClick={() => handleEventClick(row)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          handleEventClick(row)
                        }
                      }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${severityClasses[severity]}`}
                        >
                          {severity}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-medium text-slate-100">{row.place}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-700 pt-3">
                        <SourceBadge source={row.source} timestamp={row.created_at} />
                        <span className="text-xs text-slate-400">
                          {formatDateTime(row.event_time)} WIB
                        </span>
                      </div>
                    </article>
                  )
                })}
              </div>
            </>
          )}
        </div>

        <NewsPanel
          news={news}
          loading={newsLoading}
          selectedEvent={selectedEvent}
          onClearSelection={handleClearSelection}
        />
      </section>

      {/* Footnote: atribusi sumber, disclaimer, dan tautan — penutup yang
       * jujur sesuai rekomendasi critique (peak-end: halaman tak berakhir
       * pada tabel mentah tanpa konteks). */}
      <footer className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-4 text-[11px] leading-relaxed text-slate-400 md:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 max-w-2xl space-y-1.5">
            <p>
              <span className="font-semibold text-slate-300">Sumber data resmi:</span>{' '}
              <a href="https://www.bmkg.go.id/" target="_blank" rel="noopener noreferrer" className="text-indigo-300 underline-offset-2 hover:text-indigo-200 hover:underline">BMKG</a>
              {' · '}
              <a href="https://www.bnpb.go.id/" target="_blank" rel="noopener noreferrer" className="text-indigo-300 underline-offset-2 hover:text-indigo-200 hover:underline">BNPB</a>
              {' · '}
              <a href="https://magma.esdm.go.id/" target="_blank" rel="noopener noreferrer" className="text-indigo-300 underline-offset-2 hover:text-indigo-200 hover:underline">PVMBG / Badan Geologi</a>
              {' · '}
              <a href="https://petabencana.id/" target="_blank" rel="noopener noreferrer" className="text-indigo-300 underline-offset-2 hover:text-indigo-200 hover:underline">PetaBencana.id</a>
              {' · '}
              <a href="https://earthquake.usgs.gov/" target="_blank" rel="noopener noreferrer" className="text-indigo-300 underline-offset-2 hover:text-indigo-200 hover:underline">USGS</a>
              {' · '}
              <a href="https://globalvolcanism.org/" target="_blank" rel="noopener noreferrer" className="text-indigo-300 underline-offset-2 hover:text-indigo-200 hover:underline">Smithsonian GVP</a>
              {' · '}
              <a href="https://www.gdacs.org/" target="_blank" rel="noopener noreferrer" className="text-indigo-300 underline-offset-2 hover:text-indigo-200 hover:underline">GDACS</a>
              .
            </p>
            <p className="text-slate-500">
              Jendela data 72 jam (vulkanik 90 hari, banjir 365 hari) · feed peta terkurasi per jenis bencana ·
              pembaruan otomatis tiap 60 detik. Windy merupakan visualisasi prakiraan pihak ketiga, bukan peringatan resmi.
            </p>
            <p className="text-slate-500">
              Keputusan keselamatan harus mengacu pada BMKG, BNPB, PVMBG/Badan Geologi, dan pemerintah daerah.
              SadarBencana adalah alat pemantauan, bukan lembaga peringatan dini.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-1.5 lg:items-end">
            <a
              href={GITHUB_REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 underline-offset-2 transition hover:text-slate-200 hover:underline"
            >
              Kode sumber terbuka (GitHub) ↗
            </a>
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="rounded-lg border border-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-400 transition hover:border-indigo-400/50 hover:text-indigo-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
            >
              ↑ Kembali ke atas
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
