import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import SourceBadge from '../../components/SourceBadge'
import MagnitudeFilter from '../../components/MagnitudeFilter'
import { getEvents, getMeta, type Event, type Meta } from '../../lib/api/client'

const INDONESIA_CENTER: [number, number] = [-2.5, 118]

function magnitudeColor(mag: number): string {
  if (mag >= 7) return '#dc2626'
  if (mag >= 6) return '#f97316'
  if (mag >= 5) return '#eab308'
  return '#22c55e'
}

type Severity = 'Critical' | 'High' | 'Medium' | 'Low'

const severityClasses: Record<Severity, string> = {
  Low: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30',
  Medium: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/30',
  High: 'bg-orange-500/15 text-orange-300 ring-1 ring-inset ring-orange-400/30',
  Critical: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-400/30',
}

function severityFor(magnitude: number): Severity {
  if (magnitude >= 6) return 'Critical'
  if (magnitude >= 5) return 'High'
  if (magnitude >= 4) return 'Medium'
  return 'Low'
}



export default function ExecutiveOverview() {
  const [events, setEvents] = useState<Event[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [minMagnitude, setMinMagnitude] = useState(0)

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    setError(null)
    try {
      const [eventsData, metaData] = await Promise.all([getEvents(), getMeta()])
      setEvents(eventsData)
      setMeta(metaData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data.')
    } finally {
      if (mode === 'initial') setLoading(false)
      else setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load('initial')
  }, [load])

  const handleRefresh = useCallback(() => {
    void load('refresh')
  }, [load])

  const filteredEvents = useMemo(
    () => events.filter((e) => e.magnitude >= minMagnitude),
    [events, minMagnitude],
  )

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
        label: 'Top Source',
        value: topSource,
        caption: 'Primary ingest source feeding the current watchlist.',
      },
      {
        label: 'API Status',
        value: meta ? 'Connected' : 'Offline',
        caption: meta
          ? `${meta.service} · ${meta.environment} · v${meta.version}`
          : 'Backend unreachable. Check that the API service is running.',
      },
    ]
  }, [events, meta])

  return (
    <div className="space-y-8">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {kpis.map((item) => (
          <article
            key={item.label}
            className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40"
          >
            <p className="text-[11px] font-medium text-slate-500 leading-none">
              {item.label}
            </p>
            <p className="mt-4 text-4xl font-bold text-slate-50">{item.value}</p>
            <p className="mt-3 text-sm text-slate-400">{item.caption}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-6">
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-xl font-semibold text-slate-50">Priority Event Watchlist</h3>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
              {/* Desktop table */}
              <div className="hidden md:block">
                <div className="overflow-x-auto">
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
                      {filteredEvents.map((row) => {
                        const severity = severityFor(row.magnitude)
                        return (
                          <tr key={row.id} className="text-slate-200">
                            <td className="py-4 pr-6">{row.place}</td>
                            <td className="py-4 pr-6">
                              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${severityClasses[severity]}`}>
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
              </div>

              {/* Mobile card list */}
              <div className="space-y-3 md:hidden">
                {filteredEvents.map((row) => {
                  const severity = severityFor(row.magnitude)
                  return (
                    <article key={row.id} className="rounded-xl border border-slate-800 bg-slate-800/50 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${severityClasses[severity]}`}>
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

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-6">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-300">Event Map</p>
            {events.length > 0 && (
              <span className="text-xs text-slate-500">{events.length} events</span>
            )}
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-800" style={{ height: '320px' }}>
            {loading ? (
              <div className="flex h-full items-center justify-center gap-3 text-sm text-slate-400">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400" />
                Loading map…
              </div>
            ) : (
              <MapContainer
                center={INDONESIA_CENTER}
                zoom={4}
                scrollWheelZoom={false}
                zoomControl={false}
                attributionControl={false}
                style={{ height: '100%', width: '100%', background: '#0f172a' }}
              >
                <TileLayer url='https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' />
                {events.map((ev) => (
                  <CircleMarker
                    key={ev.event_id}
                    center={[ev.latitude, ev.longitude]}
                    radius={3 + ev.magnitude * 1.2}
                    pathOptions={{
                      color: magnitudeColor(ev.magnitude),
                      fillColor: magnitudeColor(ev.magnitude),
                      fillOpacity: 0.65,
                      weight: 1,
                    }}
                  >
                    <Popup>
                      <div style={{ minWidth: '160px' }}>
                        <strong>M{ev.magnitude.toFixed(1)} — {ev.place}</strong>
                        <br />
                        <span>{new Date(ev.event_time).toLocaleString('id-ID')}</span>
                      </div>
                    </Popup>
                  </CircleMarker>
                ))}
              </MapContainer>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
