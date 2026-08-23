// apps/web/src/features/executive/AseanAirQualityPanel.tsx
import { useCallback, useEffect, useState } from 'react'
import {
  aqiTone,
  COUNTRY_FLAGS,
  fetchAseanAirQuality,
  pm25BarWidth,
  type AseanAirQualityEntry,
} from '../../lib/api/aseanAirQuality'

export default function AseanAirQualityPanel() {
  const [entries, setEntries] = useState<AseanAirQualityEntry[]>([])
  const [unhealthyCount, setUnhealthyCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetchAseanAirQuality()
      setEntries(response.data)
      setUnhealthyCount(response.unhealthy_count)
    } catch {
      // Panel disembunyikan bila API belum tersedia
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 300_000)
    return () => window.clearInterval(timer)
  }, [load])

  if (loading || entries.length === 0) return null

  // Tampilkan maksimal 5 teratas (PM2.5 tertinggi) bila collapse
  const visible = expanded ? entries : entries.slice(0, 5)

  return (
    <section aria-label="Dampak asap lintas batas" className="rounded-2xl border border-slate-800 bg-slate-900 p-4 md:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-slate-50">🌫 Dampak Asap Lintas Batas</h3>
          <span className="text-[11px] text-slate-400">stasiun ASEAN · OpenAQ</span>
        </div>
        {unhealthyCount > 0 ? (
          <span className="rounded-full border border-rose-400/30 bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-rose-200">
            ⚠ {unhealthyCount} stasiun Tidak Sehat — asap menyeberang
          </span>
        ) : (
          <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-200">
            Semua stasiun dalam batas aman
          </span>
        )}
      </div>

      <div className="space-y-2">
        {visible.map((entry) => (
          <div
            key={entry.hub_code}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2"
          >
            <span className="shrink-0 text-base" aria-hidden="true">
              {COUNTRY_FLAGS[entry.country] ?? '🏳'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-100">{entry.hub_name}</p>
              <p className="text-[10px] text-slate-400">
                {entry.station_name || entry.hub_code}
                {entry.measured_at ? ` · ${new Date(entry.measured_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })} WIB` : ''}
                {entry.is_stale && (
                  <span className="ml-1 rounded bg-slate-700 px-1 py-0.5 font-semibold text-slate-300" title={`Pengukuran ${entry.age_hours >= 720 ? Math.round(entry.age_hours / 720) + ' bulan' : Math.round(entry.age_hours / 24) + ' hari'} lalu — stasiun ground sering tertunda; model satelit di panel Situasi Wilayah tetap real-time`}>
                    data lama
                  </span>
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-slate-800 sm:block" aria-hidden="true">
                <div
                  className={`h-full rounded-full ${
                    entry.pm25 > 55.4 ? 'bg-rose-400' : entry.pm25 > 35.4 ? 'bg-orange-400' : entry.pm25 > 12 ? 'bg-amber-400' : 'bg-emerald-400'
                  }`}
                  style={{ width: `${pm25BarWidth(entry.pm25)}%` }}
                />
              </div>
              <span className="w-16 text-right text-sm font-bold tabular-nums text-slate-100">
                {entry.pm25.toFixed(1)}
              </span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${aqiTone(entry.aqi_category)}`}>
                {entry.aqi_category}
              </span>
              {typeof entry.model_pm25 === 'number' && (
                <span
                  className="hidden rounded-full border border-sky-400/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-300 md:inline"
                  title={`Perbandingan: stasiun ground ${entry.pm25.toFixed(1)} vs model satelit CAMS ${entry.model_pm25.toFixed(1)} µg/m³`}
                >
                  model {entry.model_pm25.toFixed(0)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {entries.length > 5 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-2 w-full text-center text-xs font-medium text-slate-400 transition hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
          aria-expanded={expanded}
        >
          {expanded ? '▲ Sembunyikan' : `▼ Lihat semua ${entries.length} stasiun`}
        </button>
      )}
    </section>
  )
}
