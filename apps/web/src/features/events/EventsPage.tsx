import { useCallback, useEffect, useMemo, useState } from 'react'
import SourceBadge from '../../components/SourceBadge'
import MagnitudeFilter from '../../components/MagnitudeFilter'
import { getEvents, getExposures, type Event, type ExposureRule } from '../../lib/api/client'

const REFRESH_INTERVAL_MS = 60_000

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

const ALL_SOURCES = '__all__'
const ALL_REGIONS = '__all__'

export default function EventsPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [regions, setRegions] = useState<ExposureRule[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [minMagnitude, setMinMagnitude] = useState(0)
  const [sourceFilter, setSourceFilter] = useState<string>(ALL_SOURCES)
  const [regionFilter, setRegionFilter] = useState<string>(ALL_REGIONS)
  const [placeQuery, setPlaceQuery] = useState('')

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    setError(null)
    try {
      const [eventData, exposureData] = await Promise.all([
        getEvents(),
        // Regions rarely change — still refetch on refresh to stay in sync.
        regions.length === 0 ? getExposures().catch(() => null) : Promise.resolve(null),
      ])
      setEvents(eventData)
      if (exposureData) {
        setRegions(exposureData.data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events.')
    } finally {
      if (mode === 'initial') setLoading(false)
      else setRefreshing(false)
    }
  }, [regions.length])

  useEffect(() => {
    void load('initial')
  }, [load])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void load('refresh')
    }, REFRESH_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [load])

  const handleRefresh = useCallback(() => {
    void load('refresh')
  }, [load])

  // Distinct list of sources for the source filter dropdown.
  const sourceOptions = useMemo(() => {
    const seen = new Set<string>()
    events.forEach((event) => seen.add(event.source))
    return Array.from(seen).sort((a, b) => a.localeCompare(b))
  }, [events])

  // Build a lookup: region_name → lowercase keywords for O(1) matching.
  const regionKeywordsMap = useMemo(() => {
    const m = new Map<string, string[]>()
    regions.forEach((r) => {
      m.set(r.region_name, (r.region_keywords ?? []).map((k) => k.toLowerCase()))
    })
    return m
  }, [regions])

  const filteredEvents = useMemo(() => {
    const query = placeQuery.trim().toLowerCase()
    const selectedKeywords =
      regionFilter !== ALL_REGIONS ? regionKeywordsMap.get(regionFilter) ?? [] : []
    return events.filter((event) => {
      if (event.magnitude < minMagnitude) return false
      if (sourceFilter !== ALL_SOURCES && event.source !== sourceFilter) return false
      if (query.length > 0 && !event.place.toLowerCase().includes(query)) return false
      // Region filter: event.place must contain at least one keyword from the
      // selected region's keyword list (case-insensitive substring match).
      if (selectedKeywords.length > 0) {
        const placeLower = event.place.toLowerCase()
        if (!selectedKeywords.some((kw) => placeLower.includes(kw))) return false
      }
      return true
    })
  }, [events, minMagnitude, sourceFilter, placeQuery, regionFilter, regionKeywordsMap])

  const activeFilterCount =
    (minMagnitude > 0 ? 1 : 0) +
    (sourceFilter !== ALL_SOURCES ? 1 : 0) +
    (regionFilter !== ALL_REGIONS ? 1 : 0) +
    (placeQuery.trim().length > 0 ? 1 : 0)

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-2xl font-semibold text-slate-50">Catastrophe Events</h3>
            <p className="mt-2 text-sm text-slate-400">
              Ingested catastrophe events with magnitude, source, and location filters. Auto-refreshes every 60s.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300 ring-1 ring-inset ring-slate-700">
              {events.length} total
            </span>
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

        <div className="mt-6 flex flex-col gap-3 border-t border-slate-800 pt-6 md:flex-row md:items-center md:justify-between">
          <MagnitudeFilter value={minMagnitude} onChange={setMinMagnitude} />

          <label className="inline-flex items-center gap-3 text-sm text-slate-300">
            <span className="text-xs font-medium text-slate-400">
              Region
            </span>
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 shadow-inner shadow-slate-950/40 outline-none transition focus:border-indigo-400 focus:ring-1 focus:ring-inset focus:ring-indigo-400 md:w-auto"
            >
              <option value={ALL_REGIONS} className="bg-slate-800 text-slate-100">
                All regions
              </option>
              {regions.map((r) => (
                <option key={r.id} value={r.region_name} className="bg-slate-800 text-slate-100">
                  {r.region_name}
                </option>
              ))}
            </select>
          </label>

          <label className="inline-flex items-center gap-3 text-sm text-slate-300">
            <span className="text-xs font-medium text-slate-400">
              Source
            </span>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 shadow-inner shadow-slate-950/40 outline-none transition focus:border-indigo-400 focus:ring-1 focus:ring-inset focus:ring-indigo-400 md:w-auto"
            >
              <option value={ALL_SOURCES} className="bg-slate-800 text-slate-100">
                All sources
              </option>
              {sourceOptions.map((src) => (
                <option key={src} value={src} className="bg-slate-800 text-slate-100">
                  {src.toUpperCase()}
                </option>
              ))}
            </select>
          </label>

          <label className="inline-flex items-center gap-3 text-sm text-slate-300">
            <span className="text-xs font-medium text-slate-400">
              Location
            </span>
            <input
              type="search"
              value={placeQuery}
              onChange={(e) => setPlaceQuery(e.target.value)}
              placeholder="Search place..."
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 shadow-inner shadow-slate-950/40 outline-none transition placeholder:text-slate-500 focus:border-indigo-400 focus:ring-1 focus:ring-inset focus:ring-indigo-400 md:w-48"
            />
          </label>
        </div>

        {activeFilterCount > 0 ? (
          <p className="mt-3 text-xs text-slate-500">
            Showing {filteredEvents.length} of {events.length} events · {activeFilterCount} filter
            {activeFilterCount === 1 ? '' : 's'} active
          </p>
        ) : null}
      </section>

      {loading ? (
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
          <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-400">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400" />
            Loading events...
          </div>
        </section>
      ) : error ? (
        <section className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 shadow-2xl shadow-slate-950/40">
          <p className="text-sm font-semibold text-rose-100">Failed to load events</p>
          <p className="mt-2 break-words text-sm text-rose-300/80">{error}</p>
          <p className="mt-3 text-sm text-rose-300/60">
            Verify the API is running and reachable via the Vite proxy.
          </p>
        </section>
      ) : events.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-900 p-8 text-center shadow-2xl shadow-slate-950/40">
          <p className="text-sm font-medium text-slate-200">No events ingested yet</p>
          <p className="mt-2 text-sm text-slate-400">
            Trigger an ingest run to populate the event feed.
          </p>
        </section>
      ) : filteredEvents.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-900 p-8 text-center shadow-2xl shadow-slate-950/40">
          <p className="text-sm font-medium text-slate-200">No events match the current filters</p>
          <p className="mt-2 text-sm text-slate-400">
            Adjust the magnitude, source, or location filter to see more events.
          </p>
        </section>
      ) : (
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-6">
          {/* Desktop table */}
          <div className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
                <thead>
                  <tr className="text-slate-400">
                    <th className="pb-3 pr-6 font-medium">Event</th>
                    <th className="pb-3 pr-6 font-medium">Magnitude</th>
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
                        <td className="py-4 pr-6">
                          <p className="font-medium text-slate-100">{row.place}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {row.event_type} · {row.latitude.toFixed(2)}, {row.longitude.toFixed(2)}
                          </p>
                        </td>
                        <td className="py-4 pr-6">
                          <span className="font-semibold text-slate-100">
                            M {row.magnitude.toFixed(1)}
                          </span>
                        </td>
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
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${severityClasses[severity]}`}>
                          {severity}
                        </span>
                        <span className="text-xs font-semibold text-slate-300">
                          M {row.magnitude.toFixed(1)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-medium text-slate-100">{row.place}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {row.event_type} · {row.latitude.toFixed(2)}, {row.longitude.toFixed(2)}
                      </p>
                    </div>
                  </div>
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
        </section>
      )}
    </div>
  )
}
