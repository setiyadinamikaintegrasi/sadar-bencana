import { useCallback, useEffect, useMemo, useState } from 'react'
import SourceBadge from '../../components/SourceBadge'
import {
  acknowledgeAlert,
  getAlertActionCard,
  getAlerts,
  type Alert,
  type AlertActionCard,
  type AlertSeverity,
  type AlertVerification,
} from '../../lib/api/client'

const REFRESH_INTERVAL_MS = 60_000

const ALL_SOURCES = '__all__'

const severityClasses: Record<AlertSeverity, string> = {
  Moderate: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/30',
  High: 'bg-orange-500/15 text-orange-300 ring-1 ring-inset ring-orange-400/30',
  Critical: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-400/30',
}

const verificationClasses: Record<AlertVerification, string> = {
  unverified: 'bg-slate-500/15 text-slate-300 ring-1 ring-inset ring-slate-400/30',
  corroborated: 'bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-400/30',
  official: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30',
}

type StatusFilter = 'all' | 'unacknowledged' | 'acknowledged'

const statusOptions: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Unacknowledged', value: 'unacknowledged' },
  { label: 'Acknowledged', value: 'acknowledged' },
]

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [unacknowledged, setUnacknowledged] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sourceFilter, setSourceFilter] = useState<string>(ALL_SOURCES)
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null)
  const [actionCards, setActionCards] = useState<Record<string, AlertActionCard>>({})
  const [loadingCardId, setLoadingCardId] = useState<string | null>(null)

  const toggleActionCard = useCallback(async (alertId: string) => {
    if (actionCards[alertId]) {
      setActionCards((current) => {
        const next = { ...current }
        delete next[alertId]
        return next
      })
      return
    }
    setLoadingCardId(alertId)
    try {
      const card = await getAlertActionCard(alertId)
      setActionCards((current) => ({ ...current, [alertId]: card }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load action card.')
    } finally {
      setLoadingCardId(null)
    }
  }, [actionCards])

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    setError(null)
    try {
      const res = await getAlerts()
      setAlerts(res.data)
      setUnacknowledged(res.meta.unacknowledged)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load alerts.')
    } finally {
      if (mode === 'initial') setLoading(false)
      else setRefreshing(false)
    }
  }, [])

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

  // Acknowledge a single alert. Updates local state optimistically and reconciles
  // the unacknowledged counter; falls back to a full refresh on error.
  const handleAcknowledge = useCallback(
    async (id: string) => {
      setAcknowledgingId(id)
      const previous = alerts
      // Optimistic update
      setAlerts((current) =>
        current.map((alert) =>
          alert.id === id ? { ...alert, acknowledged: true } : alert,
        ),
      )
      setUnacknowledged((count) => Math.max(0, count - 1))
      try {
        await acknowledgeAlert(id)
      } catch (err) {
        // Roll back optimistic update on failure.
        setAlerts(previous)
        const res = await getAlerts().catch(() => null)
        if (res) {
          setAlerts(res.data)
          setUnacknowledged(res.meta.unacknowledged)
        }
        setError(
          err instanceof Error ? err.message : 'Failed to acknowledge alert. Reverted.',
        )
      } finally {
        setAcknowledgingId(null)
      }
    },
    [alerts],
  )

  const handleAcknowledgeAll = useCallback(async () => {
    const pending = alerts.filter((alert) => !alert.acknowledged)
    if (pending.length === 0) return

    const previous = alerts
    // Optimistically mark all visible pending alerts as acknowledged.
    setAlerts((current) => current.map((alert) => ({ ...alert, acknowledged: true })))
    setUnacknowledged(0)

    try {
      await Promise.all(pending.map((alert) => acknowledgeAlert(alert.id)))
    } catch (err) {
      // Reconcile with the server on partial/total failure.
      setAlerts(previous)
      const res = await getAlerts().catch(() => null)
      if (res) {
        setAlerts(res.data)
        setUnacknowledged(res.meta.unacknowledged)
      }
      setError(
        err instanceof Error ? err.message : 'Failed to acknowledge some alerts. Reverted.',
      )
    }
  }, [alerts])

  const filteredAlerts = useMemo(() => {
    return alerts.filter((alert) => {
      if (statusFilter !== 'all') {
        const wantAcked = statusFilter === 'acknowledged'
        if (alert.acknowledged !== wantAcked) return false
      }
      if (sourceFilter !== ALL_SOURCES && alert.source !== sourceFilter) return false
      return true
    })
  }, [alerts, statusFilter, sourceFilter])

  const sourceOptions = useMemo(() => {
    const seen = new Set<string>()
    filteredAlerts.forEach((a) => {
      if (a.source) seen.add(a.source)
    })
    return Array.from(seen).sort()
  }, [filteredAlerts])

  const hasUnacknowledged = unacknowledged > 0

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-2xl font-semibold text-slate-50">Risk Alerts</h3>
            <p className="mt-2 text-sm text-slate-400">
              Generated alerts from event-to-portfolio matching. Acknowledge alerts to track triage.
              Auto-refreshes every 60s.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${
                hasUnacknowledged
                  ? 'bg-rose-500/15 text-rose-300 ring-rose-400/30'
                  : 'bg-slate-800 text-slate-300 ring-slate-700'
              }`}
            >
              {unacknowledged} unacknowledged
            </span>
            <span className="inline-flex rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300 ring-1 ring-inset ring-slate-700">
              {alerts.length} total
            </span>
            <button
              type="button"
              onClick={handleAcknowledgeAll}
              disabled={!hasUnacknowledged}
              className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-indigo-400 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Acknowledge all
            </button>
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

        <div className="mt-6 flex flex-col gap-3 border-t border-slate-800 pt-6 md:flex-row md:items-center">
          <span className="text-xs font-medium text-slate-400">
            Status
          </span>
          <div className="inline-flex rounded-xl border border-slate-700 bg-slate-800 p-1">
            {statusOptions.map((opt) => {
              const isActive = opt.value === statusFilter
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStatusFilter(opt.value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    isActive
                      ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-inset ring-indigo-400/40'
                      : 'text-slate-300 hover:text-slate-100'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>

          <label className="inline-flex items-center gap-3 text-sm text-slate-300 md:ml-auto">
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
        </div>
      </section>

      {error ? (
        <section className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 shadow-2xl shadow-slate-950/40">
          <p className="text-sm font-semibold text-rose-100">Alert operation failed</p>
          <p className="mt-2 break-words text-sm text-rose-300/80">{error}</p>
        </section>
      ) : null}

      {loading ? (
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
          <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-400">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400" />
            Loading alerts...
          </div>
        </section>
      ) : alerts.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-900 p-8 text-center shadow-2xl shadow-slate-950/40">
          <p className="text-sm font-medium text-slate-200">No alerts generated</p>
          <p className="mt-2 text-sm text-slate-400">
            Alerts appear when ingested events match configured exposure rules.
          </p>
        </section>
      ) : filteredAlerts.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-900 p-8 text-center shadow-2xl shadow-slate-950/40">
          <p className="text-sm font-medium text-slate-200">No alerts match this status filter</p>
          <p className="mt-2 text-sm text-slate-400">
            Switch the status filter to see acknowledged or all alerts.
          </p>
        </section>
      ) : (
        <section className="space-y-4">
          {filteredAlerts.map((alert) => (
            <article
              key={alert.id}
              className={`rounded-2xl border bg-slate-900 p-6 shadow-2xl shadow-slate-950/40 transition ${
                alert.acknowledged
                  ? 'border-slate-800 opacity-80'
                  : 'border-slate-700 ring-1 ring-inset ring-slate-700/60'
              }`}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${severityClasses[alert.severity]}`}
                    >
                      {alert.severity}
                    </span>
                    <span className="inline-flex rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300 ring-1 ring-inset ring-slate-700">
                      {alert.alert_type}
                    </span>
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${verificationClasses[alert.verification_status]}`}
                    >
                      {alert.verification_status}
                      {alert.source_count > 1 ? ` · ${alert.source_count} sources` : ''}
                    </span>
                    <SourceBadge source={alert.source ?? alert.alert_type} timestamp={alert.created_at} />
                    {alert.acknowledged ? (
                      <span className="inline-flex rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
                        Acknowledged
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-rose-500/15 px-3 py-1 text-xs font-semibold text-rose-300 ring-1 ring-inset ring-rose-400/30">
                        Pending
                      </span>
                    )}
                  </div>

                  <p className="mt-3 break-words text-sm text-slate-200">{alert.message}</p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    {alert.magnitude != null ? <span>M {alert.magnitude.toFixed(1)}</span> : null}
                    {alert.place ? <span>{alert.place}</span> : null}
                    {alert.event_time ? <span>{new Date(alert.event_time).toLocaleString()}</span> : null}
                    {alert.event_id ? <span>ID {alert.event_id}</span> : null}
                  </div>
                </div>

                <div className="shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleActionCard(alert.id)}
                    className="mb-2 block rounded-xl border border-sky-500/40 px-4 py-2 text-sm font-semibold text-sky-200 hover:bg-sky-500/10"
                  >
                    {loadingCardId === alert.id
                      ? 'Memuat…'
                      : actionCards[alert.id]
                        ? 'Tutup panduan'
                        : 'Lihat tindakan'}
                  </button>
                  {alert.acknowledged ? (
                    <span className="inline-flex items-center text-xs font-medium text-emerald-400">
                      ✓ Acknowledged
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAcknowledge(alert.id)}
                      disabled={acknowledgingId === alert.id}
                      className="inline-flex items-center justify-center rounded-xl border border-indigo-400 bg-indigo-500/20 px-4 py-2 text-sm font-semibold text-indigo-200 transition hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {acknowledgingId === alert.id ? 'Acknowledging…' : 'Acknowledge'}
                    </button>
                  )}
                </div>
              </div>
              {actionCards[alert.id] ? (
                <div className="mt-5 rounded-xl border border-sky-500/25 bg-sky-950/20 p-5 text-sm text-slate-200">
                  <p className="font-semibold text-white">Apa yang terjadi</p>
                  <p className="mt-1">{actionCards[alert.id].what_happened}</p>
                  <p className="mt-4 font-semibold text-white">Mengapa saya menerima ini</p>
                  <p className="mt-1">{actionCards[alert.id].why_received}</p>
                  {(['before', 'during', 'after'] as const).map((stage) => (
                    <div key={stage} className="mt-4">
                      <p className="font-semibold capitalize text-white">{stage}</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {actionCards[alert.id].guidance[stage].map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <p className="mt-4 text-xs text-slate-400">
                    Panduan {actionCards[alert.id].guidance_version} · Confidence{' '}
                    {actionCards[alert.id].confidence_class}
                  </p>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
