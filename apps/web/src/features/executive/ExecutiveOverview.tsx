import { useEffect, useMemo, useState } from 'react'
import { getEvents, getMeta, type Event, type Meta } from '../../lib/api/client'

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

const sourceBadgeClasses =
  'inline-flex rounded-full bg-slate-700/60 px-3 py-1 text-xs font-semibold text-slate-200 ring-1 ring-inset ring-slate-500/40'

export default function ExecutiveOverview() {
  const [events, setEvents] = useState<Event[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [eventsData, metaData] = await Promise.all([getEvents(), getMeta()])
        if (cancelled) return
        setEvents(eventsData)
        setMeta(metaData)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load dashboard data.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

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
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
              {item.label}
            </p>
            <p className="mt-4 text-4xl font-bold text-slate-50">{item.value}</p>
            <p className="mt-3 text-sm text-slate-400">{item.caption}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-indigo-400">
                Watchlist
              </p>
              <h3 className="mt-2 text-xl font-semibold text-slate-50">Priority Event Watchlist</h3>
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
          ) : (
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
                  {events.map((row) => {
                    const severity = severityFor(row.magnitude)
                    return (
                      <tr key={row.id} className="text-slate-200">
                        <td className="py-4 pr-6">{row.place}</td>
                        <td className="py-4 pr-6">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${severityClasses[severity]}`}
                          >
                            {severity}
                          </span>
                        </td>
                        <td className="py-4 pr-6">
                          <span className={sourceBadgeClasses}>{row.source}</span>
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
          )}
        </div>

        <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-indigo-400">
            Event Map
          </p>
          <div className="mt-4 flex h-80 items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-800 text-center text-sm text-slate-400">
            Event Map — geo layers coming soon
          </div>
        </div>
      </section>
    </div>
  )
}
