import { useCallback, useEffect, useState } from 'react'
import { getConnectorHealth, type ConnectorHealth } from '../../lib/api/client'

const REFRESH_INTERVAL_MS = 30_000

const CATEGORIES = [
  {
    label: 'Hazard',
    names: ['bmkg', 'usgs', 'gdacs_fl', 'gdacs_vo', 'nasa_firms'],
  },
  {
    label: 'News',
    names: ['antara', 'detik', 'cnn', 'tempo', 'republika', 'sindo', 'okezone'],
  },
  {
    label: 'Vessel & Aircraft',
    names: ['aisstream', 'vesselfinder', 'opensky'],
  },
] as const

const statusConfig = {
  ok: { dot: '●', label: 'OK', dotClass: 'text-emerald-400', textClass: 'text-emerald-300' },
  stale: { dot: '◐', label: 'STALE', dotClass: 'text-amber-400', textClass: 'text-amber-300' },
  error: { dot: '✕', label: 'ERROR', dotClass: 'text-rose-400', textClass: 'text-rose-300' },
} as const

function relativeTime(isoStr: string | null): string {
  if (!isoStr) return '—'
  const diffMs = Date.now() - new Date(isoStr).getTime()
  const secs = Math.floor(diffMs / 1000)
  if (secs < 60) return 'baru saja'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} mnt lalu`
  const hours = Math.floor(mins / 60)
  return `${hours} jam lalu`
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text
}

function ConnectorRow({ connector }: { connector: ConnectorHealth }) {
  const cfg = statusConfig[connector.status]
  return (
    <tr className="border-t border-slate-800">
      <td className="py-3 pr-4 font-mono text-sm text-slate-200">{connector.name}</td>
      <td className="py-3 pr-4">
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${cfg.textClass}`}>
          <span className={cfg.dotClass}>{cfg.dot}</span>
          {cfg.label}
        </span>
      </td>
      <td className="py-3 pr-4 text-xs text-slate-400">{relativeTime(connector.last_polled_at)}</td>
      <td className="py-3 pr-4 text-xs text-slate-400">{connector.items_fetched} item</td>
      <td className="py-3 text-xs text-slate-500">
        {connector.error_message ? (
          <span title={connector.error_message} className="cursor-help text-rose-400">
            {truncate(connector.error_message, 80)}
          </span>
        ) : (
          <span className="text-slate-700">—</span>
        )}
      </td>
    </tr>
  )
}

function CategoryCard({
  label,
  names,
  byName,
}: {
  label: string
  names: readonly string[]
  byName: Map<string, ConnectorHealth>
}) {
  const connectors = names.map((n) => byName.get(n)).filter(Boolean) as ConnectorHealth[]
  const errorCount = connectors.filter((c) => c.status === 'error').length
  const staleCount = connectors.filter((c) => c.status === 'stale').length

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-50">{label}</h3>
        </div>
        <div className="flex gap-2">
          {errorCount > 0 && (
            <span className="inline-flex rounded-full bg-rose-500/15 px-3 py-1 text-xs font-semibold text-rose-300 ring-1 ring-inset ring-rose-400/30">
              {errorCount} error
            </span>
          )}
          {staleCount > 0 && (
            <span className="inline-flex rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300 ring-1 ring-inset ring-amber-400/30">
              {staleCount} stale
            </span>
          )}
          {errorCount === 0 && staleCount === 0 && (
            <span className="inline-flex rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
              all ok
            </span>
          )}
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left">
          <thead>
            <tr>
              <th className="pb-3 pr-4 text-[11px] font-medium text-slate-500">
                Connector
              </th>
              <th className="pb-3 pr-4 text-[11px] font-medium text-slate-500">
                Status
              </th>
              <th className="pb-3 pr-4 text-[11px] font-medium text-slate-500">
                Last Poll
              </th>
              <th className="pb-3 pr-4 text-[11px] font-medium text-slate-500">
                Items
              </th>
              <th className="pb-3 text-[11px] font-medium text-slate-500">
                Error
              </th>
            </tr>
          </thead>
          <tbody>
            {connectors.map((c) => (
              <ConnectorRow key={c.name} connector={c} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="space-y-3 md:hidden">
        {connectors.map((c) => {
          const cfg = statusConfig[c.status]
          return (
            <div
              key={c.name}
              className="rounded-xl border border-slate-800 bg-slate-950/40 p-4"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-medium text-slate-200">{c.name}</span>
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${cfg.textClass}`}>
                  <span className={cfg.dotClass}>{cfg.dot}</span>
                  {cfg.label}
                </span>
              </div>
              <div className="mt-2 flex gap-4 text-xs text-slate-400">
                <span>{relativeTime(c.last_polled_at)}</span>
                <span>{c.items_fetched} item</span>
              </div>
              {c.error_message && (
                <p className="mt-2 break-words text-xs text-rose-400">
                  {truncate(c.error_message, 80)}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default function SourceHealthPage() {
  const [connectors, setConnectors] = useState<ConnectorHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const data = await getConnectorHealth()
      setConnectors(data)
      setLastUpdated(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load connector health.')
    } finally {
      if (mode === 'initial') setLoading(false)
      else setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load('initial')
  }, [load])

  useEffect(() => {
    const id = window.setInterval(() => void load('refresh'), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [load])

  const byName = new Map(connectors.map((c) => [c.name, c]))

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-2xl font-semibold text-slate-50">Connector Status</h3>
            <p className="mt-2 text-sm text-slate-400">
              Status setiap data connector. Auto-refresh setiap 30 detik.
              {lastUpdated && (
                <span className="ml-2 text-slate-500">
                  Terakhir diperbarui: {lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load('refresh')}
            disabled={loading || refreshing}
            className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-indigo-400 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </section>

      {error ? (
        <section className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 shadow-2xl shadow-slate-950/40">
          <p className="text-sm font-semibold text-rose-100">Failed to load connector health</p>
          <p className="mt-2 break-words text-sm text-rose-300/80">{error}</p>
        </section>
      ) : null}

      {loading ? (
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
          <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-400">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400" />
            Loading connector health…
          </div>
        </section>
      ) : (
        CATEGORIES.map((cat) => (
          <CategoryCard key={cat.label} label={cat.label} names={cat.names} byName={byName} />
        ))
      )}
    </div>
  )
}
