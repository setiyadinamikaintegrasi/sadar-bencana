import { useCallback, useEffect, useMemo, useState } from 'react'
import SourceBadge from '../../components/SourceBadge'
import { getBriefing, type Briefing } from '../../lib/api/client'

const REFRESH_INTERVAL_MS = 60_000

const magnitudeBadgeClasses = {
  high: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-400/30',
  medium: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/30',
  low: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30',
}

function formatBriefingDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function magnitudeClasses(magnitude: number): string {
  if (magnitude >= 6) return magnitudeBadgeClasses.high
  if (magnitude >= 5) return magnitudeBadgeClasses.medium
  return magnitudeBadgeClasses.low
}

export default function BriefingPage() {
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadBriefing = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') {
      setLoading(true)
    } else {
      setRefreshing(true)
    }

    setError(null)

    try {
      const response = await getBriefing()
      setBriefing(response.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load daily briefing.')
    } finally {
      if (mode === 'initial') {
        setLoading(false)
      } else {
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    void loadBriefing('initial')
  }, [loadBriefing])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void loadBriefing('refresh')
    }, REFRESH_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [loadBriefing])

  const formattedDate = useMemo(
    () => (briefing ? formatBriefingDate(briefing.date) : '—'),
    [briefing],
  )

  const handleRefresh = useCallback(() => {
    void loadBriefing('refresh')
  }, [loadBriefing])

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-indigo-400">
              Daily Briefing
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-50">Operational Risk Briefing</h3>
            <p className="mt-2 text-sm text-slate-400">
              Ringkasan briefing harian untuk pemantauan risiko reasuransi PT Tugure.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300 ring-1 ring-inset ring-slate-700">
              {briefing ? `${briefing.event_count} events` : 'Awaiting data'}
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
      </section>

      {loading ? (
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
            <div className="h-4 w-32 animate-pulse rounded bg-slate-800" />
            <div className="mt-4 h-8 w-72 animate-pulse rounded bg-slate-800" />
            <div className="mt-6 space-y-3">
              <div className="h-4 animate-pulse rounded bg-slate-800" />
              <div className="h-4 animate-pulse rounded bg-slate-800" />
              <div className="h-4 w-5/6 animate-pulse rounded bg-slate-800" />
            </div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
            <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-400">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400" />
              Loading briefing...
            </div>
          </div>
        </section>
      ) : error ? (
        <section className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 shadow-2xl shadow-slate-950/40">
          <p className="text-sm font-semibold text-rose-100">Failed to load briefing</p>
          <p className="mt-2 break-words text-sm text-rose-300/80">{error}</p>
          <p className="mt-3 text-sm text-rose-300/60">
            Verify the API is running and reachable at the configured Vite proxy.
          </p>
        </section>
      ) : briefing ? (
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <article className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-indigo-400">
                Briefing Date
              </p>
              <span className="inline-flex rounded-full bg-indigo-500/15 px-3 py-1 text-xs font-semibold text-indigo-300 ring-1 ring-inset ring-indigo-400/30">
                {briefing.event_count} monitored events
              </span>
            </div>
            <h4 className="mt-3 text-2xl font-semibold text-slate-50">{formattedDate}</h4>
            <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/70 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Summary</p>
              <p className="mt-3 whitespace-pre-line text-sm leading-7 text-slate-300">
                {briefing.summary}
              </p>
            </div>
          </article>

          <article className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-indigo-400">
                  Top Events
                </p>
                <h4 className="mt-2 text-xl font-semibold text-slate-50">
                  Priority catastrophe watchlist
                </h4>
              </div>
            </div>

            {briefing.event_count === 0 || briefing.top_events.length === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-slate-700 bg-slate-800/50 p-8 text-center">
                <p className="text-sm font-medium text-slate-200">No events in today&apos;s briefing</p>
                <p className="mt-2 text-sm text-slate-400">
                  The API returned an empty daily briefing. Refresh again after the next ingest cycle.
                </p>
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                {briefing.top_events.map((event) => (
                  <div
                    key={event.event_id}
                    className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-3">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${magnitudeClasses(event.magnitude)}`}
                          >
                            M {event.magnitude.toFixed(1)}
                          </span>
                          <p className="text-sm font-semibold text-slate-100">
                            {event.place ?? 'Unknown location'}
                          </p>
                        </div>
                        <p className="mt-3 text-xs text-slate-500">Event ID: {event.event_id}</p>
                      </div>

                      {event.source ? <SourceBadge source={event.source} /> : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-900 p-8 text-center shadow-2xl shadow-slate-950/40">
          <p className="text-sm font-medium text-slate-200">No briefing data available</p>
          <p className="mt-2 text-sm text-slate-400">
            The briefing endpoint returned no payload. Try refreshing the page.
          </p>
        </section>
      )}
    </div>
  )
}
