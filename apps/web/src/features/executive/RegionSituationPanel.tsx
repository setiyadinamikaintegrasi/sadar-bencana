// apps/web/src/features/executive/RegionSituationPanel.tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchRegionSituation, perilGlyph, type RegionSituation } from '../../lib/api/regions'

const SEVERITY_TONE = (index: number): { bar: string; text: string; label: string } => {
  if (index >= 50) return { bar: 'bg-rose-500', text: 'text-rose-300', label: 'Kritis' }
  if (index >= 25) return { bar: 'bg-orange-400', text: 'text-orange-300', label: 'Tinggi' }
  if (index >= 10) return { bar: 'bg-amber-400', text: 'text-amber-300', label: 'Waspada' }
  return { bar: 'bg-emerald-400', text: 'text-emerald-300', label: 'Tenang' }
}

interface RegionSituationPanelProps {
  onRegionFocus?: (center: [number, number], perilType?: string) => void
}

export default function RegionSituationPanel({ onRegionFocus }: RegionSituationPanelProps) {
  const [regions, setRegions] = useState<RegionSituation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetchRegionSituation()
      setRegions(response.regions)
      setError(null)
    } catch {
      setError('Situasi wilayah belum tersedia.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 60_000)
    return () => window.clearInterval(timer)
  }, [load])

  // Urutkan: severity desc; auto-select wilayah teratas bila belum dipilih
  const sorted = useMemo(() => [...regions].sort((a, b) => b.severity_index - a.severity_index), [regions])
  const active = useMemo(
    () => sorted.find((r) => r.code === selected) ?? sorted[0] ?? null,
    [sorted, selected],
  )

  if (loading) {
    return (
      <section aria-label="Situasi wilayah">
        <div className="h-28 animate-pulse rounded-2xl bg-slate-800/50" />
      </section>
    )
  }

  if (error || !active) {
    return error ? (
      <section aria-label="Situasi wilayah">
        <p className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-xs text-slate-400">{error}</p>
      </section>
    ) : null
  }

  const tone = SEVERITY_TONE(active.severity_index)
  const dominantPeril = active.perils[0]
  const hasMagnitudes = dominantPeril != null && dominantPeril.max_magnitude > 0

  return (
    <section aria-label="Situasi wilayah" className="rounded-2xl border border-slate-800 bg-slate-900 p-4 md:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-slate-50">Situasi Wilayah</h3>
          <span className="text-[11px] text-slate-400">72 jam terakhir · update otomatis 60 detik</span>
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Pilih wilayah">
          {sorted.map((region) => {
            const isActive = region.code === active.code
            const regionTone = SEVERITY_TONE(region.severity_index)
            return (
              <button
                key={region.code}
                type="button"
                onClick={() => setSelected(region.code)}
                aria-pressed={isActive}
                className={`inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 ${
                  isActive
                    ? 'bg-indigo-500/20 text-indigo-100 ring-1 ring-inset ring-indigo-400/40'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${regionTone.bar}`} aria-hidden="true" />
                {region.name.replace(' & Nusa Tenggara Barat', '-NTB').replace('Nusa Tenggara Timur', 'NTT')}
                <span className="rounded-md bg-slate-900/80 px-1 py-0.5 text-[10px] tabular-nums text-slate-400">
                  {region.total_events}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Kartu wilayah aktif */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-base font-bold text-slate-50">{active.name}</h4>
              <span className={`rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-bold ${tone.text}`}>
                {tone.label} · {active.severity_index}/100
              </span>
            </div>
            {/* Bar severity */}
            <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full rounded-full transition-all ${tone.bar}`}
                style={{ width: `${Math.max(active.severity_index, 2)}%` }}
                role="meter"
                aria-valuenow={active.severity_index}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Indeks keparahan ${active.name}`}
              />
            </div>
          </div>
          {onRegionFocus && (
            <button
              type="button"
              onClick={() => onRegionFocus(active.center, dominantPeril?.peril_type)}
              className="shrink-0 rounded-xl border border-indigo-400/30 bg-indigo-500/15 px-3 py-2 text-xs font-semibold text-indigo-100 transition hover:bg-indigo-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
            >
              Lihat di peta →
            </button>
          )}
        </div>

        {/* Daylight: sisa jam siang */}
        {active.daylight && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
              active.daylight.is_night
                ? 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200'
                : active.daylight.daylight_remaining_hours <= 2
                  ? 'border-orange-400/30 bg-orange-500/10 text-orange-200'
                  : 'border-amber-400/30 bg-amber-500/10 text-amber-200'
            }`}>
              {active.daylight.is_night ? '🌙' : '☀'}{' '}
              {active.daylight.is_night
                ? `Malam · matahari terbit ${active.daylight.sunrise.slice(0, 5)}`
                : active.daylight.daylight_remaining_hours <= 2
                  ? `Sisa ${active.daylight.daylight_remaining_hours.toFixed(1)} jam siang · sunset ${active.daylight.sunset.slice(0, 5)}`
                  : `Siang ${active.daylight.daylight_remaining_hours.toFixed(1)} jam lagi · sunset ${active.daylight.sunset.slice(0, 5)}`}
            </span>
          </div>
        )}

        {/* Peril chips */}
        {active.perils.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">Tidak ada event bencana aktif dalam 72 jam terakhir.</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {active.perils.map((peril) => (
              <div
                key={peril.peril_type}
                className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2"
              >
                <span className="text-lg" aria-hidden="true">{perilGlyph(peril.peril_type)}</span>
                <div className="text-xs leading-tight">
                  <p className="font-semibold text-slate-100">
                    {peril.count_72h} <span className="font-normal text-slate-400">event</span>
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {peril.peril_type === 'wildfire' ? 'Karhutla' : peril.peril_type === 'earthquake' ? 'Gempa' : peril.peril_type === 'volcano' ? 'Vulkanik' : peril.peril_type === 'flood' ? 'Banjir' : peril.peril_type}
                    {' · '}
                    hari ini {peril.count_today}
                    {peril.max_magnitude > 0 ? ` · maks M${peril.max_magnitude.toFixed(1)}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Prakiraan cuaca 3 hari (Open-Meteo) */}
        {active.forecast && active.forecast.length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              🌦 Prakiraan 3 hari
            </p>
            <div className="grid grid-cols-3 gap-2">
              {active.forecast.map((day) => (
                <div
                  key={day.date}
                  className="rounded-lg border border-slate-800 bg-slate-900/70 px-2 py-1.5 text-center"
                  title={`${day.weather_label} · hujan ${day.rain_sum_mm}mm · angin maks ${day.wind_max_kmh} km/j`}
                >
                  <p className="text-[10px] font-semibold text-slate-400">
                    {new Date(day.date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </p>
                  <p className="mt-0.5 text-sm font-bold leading-tight text-slate-100">{day.weather_label}</p>
                  <div className="mt-1 flex items-center justify-center gap-1 text-[10px] leading-none">
                    <span className={day.rain_probability >= 60 ? 'font-bold text-sky-300' : 'text-slate-400'}>
                      💧{day.rain_probability}%
                    </span>
                    {day.wind_max_kmh > 0 && (
                      <span className="text-slate-400">💨{Math.round(day.wind_max_kmh)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {active.forecast.some((d) => d.rain_probability >= 70) && dominantPeril?.peril_type === 'wildfire' && (
              <p className="mt-1.5 rounded-lg border border-sky-400/20 bg-sky-500/10 px-2.5 py-1.5 text-[10px] leading-snug text-sky-200">
                💡 Hujan tinggi diprakirakan — karhutla berpotensi mereda, genangan berpotensi naik.
              </p>
            )}
          </div>
        )}

        {/* Meta info */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
          {active.news_count_7d > 0 && (
            <span>{active.news_count_7d} berita (7 hari)</span>
          )}
          {hasMagnitudes && dominantPeril && (
            <span>Terakhir: {formatRelative(dominantPeril.latest_at)}</span>
          )}
          {active.top_places.length > 0 && (
            <span className="min-w-0 truncate">
              Lokasi: {active.top_places.slice(0, 3).map(cleanPlace).join(' · ')}
            </span>
          )}
        </div>
      </div>
    </section>
  )
}

function formatRelative(iso: string): string {
  const timestamp = new Date(iso).getTime()
  if (Number.isNaN(timestamp)) return '—'
  const minutes = Math.floor((Date.now() - timestamp) / 60_000)
  if (minutes < 1) return 'baru saja'
  if (minutes < 60) return `${minutes} menit lalu`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} jam lalu`
  return `${Math.floor(hours / 24)} hari lalu`
}

function cleanPlace(place: string): string {
  return place
    .replace(/^Pusat gempa berada di (laut|darat)\s*/i, '')
    .replace(/^Hotspot\s*/i, '')
    .replace(/\d+ km\s*/i, '')
    .replace(/\d+\.\d+°[SN]\s*\d+\.\d+°[WE]/i, '')
    .replace(/^(utara|selatan|timur|barat|tenggara|barat daya|timur laut|utara)\s*/i, '')
    .trim() || place.slice(0, 20)
}
