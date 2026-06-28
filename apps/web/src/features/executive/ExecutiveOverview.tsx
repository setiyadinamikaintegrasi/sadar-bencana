// apps/web/src/features/executive/ExecutiveOverview.tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import SourceBadge from '../../components/SourceBadge'
import MagnitudeFilter from '../../components/MagnitudeFilter'
import RiskMap from '../../components/RiskMap'
import NewsPanel from '../../components/NewsPanel'
import {
  getAlerts,
  getConnectorHealth,
  getEvents,
  getMeta,
  getNews,
  getRiskScores,
  type Alert,
  type ConnectorHealth,
  type Event,
  type Meta,
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
  High: 'bg-orange-500/15 text-orange-300 ring-1 ring-inset ring-orange-400/30',
  Critical: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-400/30',
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

const liveVideoSources = [
  {
    name: 'KOMPAS TV Live',
    description: 'Breaking news Indonesia dan update nasional 24 jam.',
    href: 'https://www.youtube.com/@kompastvnews/streams',
    badge: 'YouTube',
  },
  {
    name: 'Metro TV Live',
    description: 'Siaran berita nasional dan breaking news.',
    href: 'https://www.youtube.com/@METROTV/streams',
    badge: 'YouTube',
  },
  {
    name: 'CNBC Indonesia',
    description: 'Market, ekonomi, dan sentimen industri real-time.',
    href: 'https://www.youtube.com/@cnbcindonesia/streams',
    badge: 'Markets',
  },
]

function severityFor(magnitude: number): Severity {
  if (magnitude >= 6) return 'Critical'
  if (magnitude >= 5) return 'High'
  if (magnitude >= 4) return 'Medium'
  return 'Low'
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
  })
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

function connectorStatusClass(status: ConnectorHealth['status']): string {
  if (status === 'ok') return 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30'
  if (status === 'stale') return 'bg-amber-500/15 text-amber-300 ring-amber-400/30'
  return 'bg-rose-500/15 text-rose-300 ring-rose-400/30'
}

export default function ExecutiveOverview() {
  const [events, setEvents] = useState<Event[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [news, setNews] = useState<NewsItem[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [riskScores, setRiskScores] = useState<RiskScore[]>([])
  const [connectors, setConnectors] = useState<ConnectorHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [newsLoading, setNewsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [minMagnitude, setMinMagnitude] = useState(0)
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [activePerilFilter, setActivePerilFilter] = useState('all')

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const [eventsData, metaData, alertsData, riskScoresData, connectorData] = await Promise.all([
        getEvents(),
        getMeta(),
        getAlerts().catch(() => ({ data: [], meta: { count: 0, unacknowledged: 0 } })),
        getRiskScores().catch(() => ({ data: [], meta: { count: 0, limit: 0 } })),
        getConnectorHealth().catch(() => []),
      ])
      setEvents(eventsData)
      setMeta(metaData)
      setAlerts(alertsData.data)
      setRiskScores(riskScoresData.data)
      setConnectors(connectorData)
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

  useEffect(() => {
    void load('initial')
    void loadNews()
  }, [load, loadNews])

  const handleRefresh = useCallback(() => {
    void load('refresh')
    void loadNews()
  }, [load, loadNews])

  const handleEventClick = useCallback((event: Event) => {
    setSelectedEvent(event)
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelectedEvent(null)
  }, [])

  const filteredEvents = useMemo(
    () => events.filter((e) => e.magnitude >= minMagnitude),
    [events, minMagnitude],
  )

  const visibleWatchlistEvents = useMemo(
    () => filteredEvents.slice(0, 40),
    [filteredEvents],
  )

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

  const perilDistribution = useMemo(() => {
    const counts = new Map<string, number>()
    events.forEach((event) => {
      const key = (event.event_type || 'unknown').toLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
  }, [events])

  const intelligenceMoments = useMemo<IntelligenceMoment[]>(() => {
    const eventMoments = events.slice(0, 5).map((event) => {
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

    const newsMoments = news.slice(0, 5).map((item) => ({
      id: `news-${item.id}`,
      kind: 'news' as const,
      title: item.title,
      detail: item.summary || `${item.source.toUpperCase()} · ${item.place_name ?? 'Indonesia'}`,
      timestamp: item.published_at,
      label: item.source.toUpperCase(),
      tone: 'emerald' as const,
      url: item.url,
    }))

    const alertMoments = alerts.slice(0, 4).map((alert) => ({
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
      .slice(0, 9)
  }, [alerts, events, news])

  const topRiskScore = riskScores[0]
  const kpis = useMemo(() => {
    const maxMagnitude =
      events.length > 0 ? Math.max(...events.map((e) => e.magnitude)).toFixed(1) : '—'
    const topSource = events.length > 0 ? events[0].source.toUpperCase() : '—'
    return [
      {
        label: 'Active Events',
        value: events.length.toString(),
        caption: 'Catastrophe events currently ingested into the monitor.',
      },
      {
        label: 'Max Magnitude',
        value: maxMagnitude,
        caption: 'Strongest event magnitude across the active set.',
      },
      {
        label: 'Open Alerts',
        value: unacknowledgedAlerts.toString(),
        caption: 'Unacknowledged operational alerts needing review.',
      },
      {
        label: 'API Status',
        value: meta ? 'Connected' : 'Offline',
        caption: meta
          ? `${meta.service} · ${meta.environment} · v${meta.version} · ${topSource}`
          : 'Backend unreachable. Check that the API service is running.',
      },
    ]
  }, [events, meta, unacknowledgedAlerts])

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(79,70,229,0.25),_transparent_40%),linear-gradient(135deg,_rgba(15,23,42,0.98),_rgba(2,6,23,0.98))] px-4 py-3 shadow-xl shadow-slate-950/40 md:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-200">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Live Risk Intelligence
              </span>
              <h1 className="truncate text-lg font-bold tracking-tight text-slate-50 md:text-xl">
                Situational Awareness Dashboard
              </h1>
            </div>
            <p className="mt-1 truncate text-xs text-slate-400">
              {topRiskScore?.place
                ? `Top risk: ${topRiskScore.place} · M${topRiskScore.magnitude ?? '—'} · ${topRiskScore.source?.toUpperCase() ?? 'SOURCE'}`
                : 'Events · RSS · Alerts · Source Health'}
            </p>
          </div>

          <div className="hidden shrink-0 items-stretch gap-2 sm:flex">
            <div className="rounded-xl border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-center">
              <p className="text-[9px] uppercase tracking-wide text-slate-500">Top Risk</p>
              <p className="text-lg font-bold leading-tight text-rose-300">{topRiskScore?.score ?? '—'}</p>
            </div>
            <div className="rounded-xl border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-center">
              <p className="text-[9px] uppercase tracking-wide text-slate-500">News</p>
              <p className="text-lg font-bold leading-tight text-emerald-300">{news.length}</p>
            </div>
            <div className="rounded-xl border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-center">
              <p className="text-[9px] uppercase tracking-wide text-slate-500">Sources OK</p>
              <p className="text-lg font-bold leading-tight text-indigo-300">{connectorSummary.ok}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900/95 p-4 shadow-2xl shadow-slate-950/50 md:p-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-semibold text-slate-50">Executive Risk Map</h3>
              <span className="rounded-full border border-indigo-400/30 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-semibold text-indigo-200">
                Interactive command map
              </span>
            </div>
            <p className="mt-1 hidden text-xs leading-5 text-slate-500 lg:block">
              Peta interaktif real-time: sebaran event bencana & titik berita geolocated, dengan filter layer per kategori dan zoom/pan.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            {events.length > 0 && (
              <span className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1">{events.length} events</span>
            )}
            <span className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1">{news.length} news</span>
          </div>
        </div>

        {loading ? (
          <div
            className="flex items-center justify-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 text-sm text-slate-400"
            style={{ height: 'min(62vh, 560px)' }}
          >
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400" />
            Loading map…
          </div>
        ) : (
          <RiskMap
            events={events}
            news={news}
            activePerilFilter={activePerilFilter}
            onFilterChange={setActivePerilFilter}
            onEventClick={handleEventClick}
            selectedEvent={selectedEvent}
            height="min(62vh, 560px)"
          />
        )}
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {kpis.map((item) => (
          <article
            key={item.label}
            className="rounded-2xl border border-slate-800 bg-slate-900/85 px-4 py-3 shadow-xl shadow-slate-950/30"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
              <p className="text-2xl font-bold leading-none text-slate-50">{item.value}</p>
            </div>
            <p className="mt-2 line-clamp-1 text-xs text-slate-400">{item.caption}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <article className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-slate-950/40">
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
            <div className="risk-news-ticker__track">
              {[...news.slice(0, 6), ...news.slice(0, 6)].map((item, index) => (
                <span key={`${item.id}-${index}`} className="mr-8 inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                  {item.source.toUpperCase()}: {item.title}
                </span>
              ))}
              {news.length === 0 && <span>Menunggu RSS/news feed dari backend…</span>}
            </div>
          </div>
          <div className="grid max-h-[420px] gap-3 overflow-y-auto p-4 md:grid-cols-2 xl:grid-cols-3">
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

        <article className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-slate-950/40">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-50">Live Video Desk</h3>
              <p className="text-xs text-slate-500">Kanal resmi/free untuk monitoring manual cepat.</p>
            </div>
            <span className="rounded-full bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-300">
              LIVE
            </span>
          </div>
          <div className="space-y-3">
            {liveVideoSources.map((source) => (
              <a
                key={source.name}
                href={source.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group block rounded-xl border border-slate-800 bg-slate-950/60 p-4 transition hover:border-indigo-400/50 hover:bg-slate-800/80"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-100 group-hover:text-indigo-200">▶ {source.name}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{source.description}</p>
                  </div>
                  <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400">
                    {source.badge}
                  </span>
                </div>
              </a>
            ))}
          </div>
          <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100/80">
            Catatan: stream dibuka di tab baru agar tidak terganggu kebijakan iframe, copyright, atau perubahan URL live.
          </p>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <article className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-slate-950/40">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-50">Source Health Matrix</h3>
            <span className="text-xs text-slate-500">
              OK {connectorSummary.ok} · Stale {connectorSummary.stale} · Error {connectorSummary.error}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {connectors.slice(0, 8).map((connector) => (
              <div key={connector.name} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-200">{connector.name}</p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${connectorStatusClass(connector.status)}`}
                  >
                    {connector.status.toUpperCase()}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {connector.items_fetched} items · {formatRelativeTime(connector.last_polled_at)}
                </p>
              </div>
            ))}
            {connectors.length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">
                Health connector belum tersedia.
              </div>
            )}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-slate-950/40">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-50">Peril & Transmission Snapshot</h3>
            <span className="text-xs text-slate-500">event distribution</span>
          </div>
          <div className="space-y-3">
            {perilDistribution.map(([peril, count]) => {
              const percent = events.length > 0 ? Math.round((count / events.length) * 100) : 0
              return (
                <div key={peril}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-300">{perilLabels[peril] ?? peril}</span>
                    <span className="text-slate-500">{count} events · {percent}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-emerald-400" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              )
            })}
            {perilDistribution.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">
                Belum ada distribusi peril.
              </div>
            )}
          </div>
        </article>
      </section>

      <section className="grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-6">
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <h3 className="text-xl font-semibold text-slate-50">Priority Event Watchlist</h3>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {filteredEvents.length > visibleWatchlistEvents.length && (
                <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-400">
                  Showing top {visibleWatchlistEvents.length} of {filteredEvents.length}
                </span>
              )}
              <MagnitudeFilter value={minMagnitude} onChange={setMinMagnitude} />
              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading || refreshing}
                className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-indigo-400 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {refreshing ? 'Refreshing…' : 'Refresh'}
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
                      <th className="pb-3 pr-6 font-medium">Event</th>
                      <th className="pb-3 pr-6 font-medium">Severity</th>
                      <th className="pb-3 pr-6 font-medium">Source</th>
                      <th className="pb-3 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {visibleWatchlistEvents.map((row) => {
                      const severity = severityFor(row.magnitude)
                      const isSelected = selectedEvent?.id === row.id
                      return (
                        <tr
                          key={row.id}
                          className={`cursor-pointer text-slate-200 transition hover:bg-slate-800/50 ${
                            isSelected ? 'bg-indigo-500/10 ring-1 ring-inset ring-indigo-400/20' : ''
                          }`}
                          onClick={() => handleEventClick(row)}
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
                            {new Date(row.event_time).toLocaleString()}
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
                      className={`cursor-pointer rounded-xl border border-slate-800 bg-slate-800/50 p-4 transition ${
                        isSelected ? 'ring-1 ring-indigo-400/40' : ''
                      }`}
                      onClick={() => handleEventClick(row)}
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
                          {new Date(row.event_time).toLocaleString()}
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
    </div>
  )
}
