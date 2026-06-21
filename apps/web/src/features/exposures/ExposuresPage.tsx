import { useCallback, useEffect, useState } from 'react'
import {
  getExposures,
  matchExposure,
  type ExposureRule,
} from '../../lib/api/client'

const REFRESH_INTERVAL_MS = 60_000

// Reasonable currency formatter. The API exposes a currency code per rule.
function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${currency} ${value.toLocaleString()}`
  }
}

function multiplierClasses(multiplier: number): string {
  if (multiplier >= 2) return 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-400/30'
  if (multiplier >= 1.25)
    return 'bg-orange-500/15 text-orange-300 ring-1 ring-inset ring-orange-400/30'
  if (multiplier > 1) return 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/30'
  return 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30'
}

export default function ExposuresPage() {
  const [rules, setRules] = useState<ExposureRule[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Match demo state
  const [matchInput, setMatchInput] = useState('')
  const [matching, setMatching] = useState(false)
  const [matchError, setMatchError] = useState<string | null>(null)
  const [matchResult, setMatchResult] = useState<{
    matched_rule: ExposureRule | null
    estimated_impact: number | null
  } | null>(null)

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    setError(null)
    try {
      const res = await getExposures()
      setRules(res.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load exposure rules.')
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

  const handleMatch = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      const place = matchInput.trim()
      if (place.length === 0) return

      setMatching(true)
      setMatchError(null)
      setMatchResult(null)
      try {
        const res = await matchExposure(place)
        setMatchResult(res.data)
      } catch (err) {
        setMatchError(err instanceof Error ? err.message : 'Failed to match exposure.')
      } finally {
        setMatching(false)
      }
    },
    [matchInput],
  )

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-indigo-400">
              Exposure Rules
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-50">Regional Exposure Rules</h3>
            <p className="mt-2 text-sm text-slate-400">
              Mapping of geographic regions to portfolio exposure and impact multipliers. Auto-refreshes every 60s.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300 ring-1 ring-inset ring-slate-700">
              {rules.length} rules
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
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
          <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-400">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400" />
            Loading exposure rules...
          </div>
        </section>
      ) : error ? (
        <section className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 shadow-2xl shadow-slate-950/40">
          <p className="text-sm font-semibold text-rose-100">Failed to load exposure rules</p>
          <p className="mt-2 break-words text-sm text-rose-300/80">{error}</p>
          <p className="mt-3 text-sm text-rose-300/60">
            Verify the API is running and reachable via the Vite proxy.
          </p>
        </section>
      ) : rules.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-900 p-8 text-center shadow-2xl shadow-slate-950/40">
          <p className="text-sm font-medium text-slate-200">No exposure rules configured</p>
          <p className="mt-2 text-sm text-slate-400">
            Seed exposure rules into the database to populate this table.
          </p>
        </section>
      ) : (
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
              <thead>
                <tr className="text-slate-400">
                  <th className="pb-3 pr-6 font-medium">Region</th>
                  <th className="pb-3 pr-6 font-medium">Portfolio</th>
                  <th className="pb-3 pr-6 font-medium">Total Exposure</th>
                  <th className="pb-3 pr-6 font-medium">Multiplier</th>
                  <th className="pb-3 font-medium">Estimated Impact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rules.map((rule) => (
                  <tr key={rule.id} className="text-slate-200">
                    <td className="py-4 pr-6">
                      <p className="font-medium text-slate-100">{rule.region_name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {rule.region_keywords.join(', ')}
                      </p>
                    </td>
                    <td className="py-4 pr-6 text-slate-300">{rule.portfolio_name}</td>
                    <td className="py-4 pr-6 text-slate-300">
                      {formatCurrency(rule.total_exposure, rule.currency)}
                    </td>
                    <td className="py-4 pr-6">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${multiplierClasses(
                          rule.risk_multiplier,
                        )}`}
                      >
                        × {rule.risk_multiplier.toFixed(2)}
                      </span>
                    </td>
                    <td className="py-4 pr-6 font-semibold text-slate-100">
                      {formatCurrency(rule.estimated_impact, rule.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Match demo */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-indigo-400">
            Exposure Match
          </p>
          <h3 className="mt-2 text-xl font-semibold text-slate-50">Match a location to a rule</h3>
          <p className="mt-2 text-sm text-slate-400">
            Enter an event place string to simulate how the exposure engine maps it to a regional rule and estimates impact.
          </p>
        </div>

        <form onSubmit={handleMatch} className="mt-5 flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={matchInput}
            onChange={(e) => setMatchInput(e.target.value)}
            placeholder="e.g. 52 km SSE of Sinabang, Indonesia"
            className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 shadow-inner shadow-slate-950/40 outline-none transition placeholder:text-slate-500 focus:border-indigo-400 focus:ring-1 focus:ring-inset focus:ring-indigo-400"
          />
          <button
            type="submit"
            disabled={matching || matchInput.trim().length === 0}
            className="inline-flex items-center justify-center rounded-xl border border-indigo-400 bg-indigo-500/20 px-5 py-2 text-sm font-semibold text-indigo-200 transition hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {matching ? 'Matching…' : 'Match'}
          </button>
        </form>

        {matchError ? (
          <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
            <p className="font-semibold text-rose-100">Match failed</p>
            <p className="mt-1 break-words text-rose-300/80">{matchError}</p>
          </div>
        ) : matchResult ? (
          matchResult.matched_rule && matchResult.estimated_impact != null ? (
            <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
                  Matched
                </span>
                <p className="text-sm font-semibold text-slate-100">
                  {matchResult.matched_rule.region_name}
                </p>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                    Portfolio
                  </p>
                  <p className="mt-1 text-sm text-slate-200">
                    {matchResult.matched_rule.portfolio_name}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                    Multiplier
                  </p>
                  <p className="mt-1 text-sm text-slate-200">
                    × {matchResult.matched_rule.risk_multiplier.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                    Estimated Impact
                  </p>
                  <p className="mt-1 text-sm font-semibold text-emerald-300">
                    {formatCurrency(
                      matchResult.estimated_impact,
                      matchResult.matched_rule.currency,
                    )}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-slate-700 bg-slate-800/50 p-5 text-center">
              <p className="text-sm font-medium text-slate-200">No matching region rule</p>
              <p className="mt-2 text-sm text-slate-400">
                The exposure engine could not map this location to a configured region. Try a place
                string containing a known region keyword.
              </p>
            </div>
          )
        ) : null}
      </section>
    </div>
  )
}
