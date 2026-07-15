import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ExternalLink, MapPin, RefreshCw } from 'lucide-react'
import {
  fetchMyActiveWarnings,
  filterBmkgActiveWarnings,
  type EWSActiveWarning,
  type EWSSafetyGuidance,
} from '../../lib/api/ews'
import { formatIndonesiaTime, safeBmkgSourceUrl } from '../executive/bmkgPresentation'

const BMKG_ATTRIBUTION = 'BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)'
const ACTIVE_WARNING_CLOCK_MS = 60_000

const perilLabels = {
  weather: 'Cuaca',
  air_quality: 'Kualitas Udara',
} as const

const lifecycleLabels = {
  alert: 'Peringatan baru',
  update: 'Pembaruan',
  cancel: 'Pembatalan',
} as const

const statusLabels = {
  active: 'Aktif',
  updated: 'Diperbarui',
  expired: 'Berakhir',
  cancelled: 'Dibatalkan',
} as const

const guidanceSections: Array<{
  key: keyof EWSSafetyGuidance
  label: string
}> = [
  { key: 'before', label: 'Sebelum' },
  { key: 'during', label: 'Saat terjadi' },
  { key: 'after', label: 'Setelah' },
]

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Gagal memuat peringatan.'
}

function safeWarningSourceUrl(value: string | null): string | null {
  const allowed = safeBmkgSourceUrl(value)
  if (!allowed) return null
  const parsed = new URL(allowed)
  if (parsed.username || parsed.password || parsed.port) return null
  return allowed
}

function WarningRow({
  warning,
  onViewOnMap,
}: {
  warning: EWSActiveWarning
  onViewOnMap: (officialAlertId: string) => void
}) {
  const headline = warning.headline ?? 'Peringatan resmi BMKG'
  const sourceUrl = safeWarningSourceUrl(warning.source_url ?? null)
  const guidanceSource = safeWarningSourceUrl(warning.guidance_source ?? null)
  const hasMapLocation = warning.area_geojson != null
    || (warning.latitude != null && warning.longitude != null)
  const watchZones = warning.matched_watch_zone_labels.length > 0
    ? warning.matched_watch_zone_labels.join(', ')
    : 'Watch zone tidak bernama'

  return (
    <article aria-label={headline} className="px-1 py-4 sm:px-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-sky-300">Resmi BMKG</p>
          <p className="mt-0.5 break-words text-[11px] text-slate-500">{BMKG_ATTRIBUTION}</p>
          <h3 className="mt-1.5 break-words text-sm font-semibold text-slate-100">{headline}</h3>
          {warning.description && (
            <p className="mt-1 max-w-4xl break-words text-sm leading-5 text-slate-300">
              {warning.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <span className="rounded-md border border-sky-400/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-200">
            {perilLabels[warning.peril_type]}
          </span>
          <span className="rounded-md border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
            {warning.severity}
          </span>
          <span className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
            {statusLabels[warning.status]}
          </span>
        </div>
      </div>

      <div className="mt-3 grid gap-x-6 gap-y-1 text-xs text-slate-400 md:grid-cols-2">
        <p>
          <span>{lifecycleLabels[warning.message_type]}</span>
          {warning.category ? <> · <span className="text-slate-300">{warning.category}</span></> : null}
        </p>
        <p>{warning.area_name ?? 'Wilayah belum terpetakan'} · Watch zone: {watchZones}</p>
        <p>Diterbitkan: {formatIndonesiaTime(warning.sent_at)}</p>
        <p>
          Berlaku: {warning.effective_at ? formatIndonesiaTime(warning.effective_at) : 'sekarang'} sampai{' '}
          {warning.expires_at ? formatIndonesiaTime(warning.expires_at) : 'ada pembaruan'}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {hasMapLocation && (
          <button
            type="button"
            onClick={() => onViewOnMap(warning.id)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-indigo-400/40 px-2.5 text-xs font-semibold text-indigo-200 transition hover:bg-indigo-500/10 focus:outline-none focus:ring-2 focus:ring-indigo-400/60"
          >
            <MapPin aria-hidden="true" className="h-3.5 w-3.5" />
            Lihat di peta
          </button>
        )}
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-700 px-2.5 text-xs font-semibold text-sky-200 transition hover:border-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400/60"
          >
            Sumber BMKG
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {warning.guidance && (
        <details className="mt-3 border-t border-slate-800/80 pt-3 text-xs text-slate-300">
          <summary className="cursor-pointer font-semibold text-slate-200">Panduan keselamatan</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {guidanceSections.map(({ key, label }) => warning.guidance?.[key]?.length ? (
              <div key={key}>
                <p className="font-semibold text-slate-300">{label}</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-slate-400">
                  {warning.guidance[key].map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            ) : null)}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            Ikuti arahan BMKG dan otoritas setempat.
          </p>
          {guidanceSource && (
            <a
              href={guidanceSource}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-300"
            >
              Sumber panduan BMKG
              <ExternalLink aria-hidden="true" className="h-3 w-3" />
            </a>
          )}
        </details>
      )}
    </article>
  )
}

export default function ActiveWarningsTab({
  onViewOnMap,
}: {
  onViewOnMap: (officialAlertId: string) => void
}) {
  const [warnings, setWarnings] = useState<EWSActiveWarning[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const cachedWarnings = useRef<EWSActiveWarning[] | null>(null)
  const requestSequence = useRef(0)

  const loadWarnings = useCallback(async () => {
    const requestId = ++requestSequence.current
    const hasCache = cachedWarnings.current !== null
    if (hasCache) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const nextWarnings = await fetchMyActiveWarnings()
      if (requestId !== requestSequence.current) return
      cachedWarnings.current = nextWarnings
      setWarnings(nextWarnings)
    } catch (reason) {
      if (requestId !== requestSequence.current) return
      setError(errorMessage(reason))
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    void loadWarnings()
    const interval = window.setInterval(() => setNow(Date.now()), ACTIVE_WARNING_CLOCK_MS)
    return () => {
      requestSequence.current += 1
      window.clearInterval(interval)
    }
  }, [loadWarnings])

  const activeWarnings = useMemo(
    () => filterBmkgActiveWarnings(warnings ?? [], now),
    [now, warnings],
  )

  if (loading && warnings === null) {
    return (
      <div
        className="flex min-h-32 items-center justify-center"
        role="status"
        aria-label="Memuat peringatan aktif BMKG"
      >
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
      </div>
    )
  }

  if (error && warnings === null) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-rose-300">{error}</p>
        <button
          type="button"
          onClick={() => void loadWarnings()}
          className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-rose-300/40 px-2.5 text-xs font-semibold text-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-300/60"
        >
          <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
          Coba lagi
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 pb-3">
        <p className="text-xs text-slate-500">
          {activeWarnings.length} peringatan cocok dengan watch zone aktif
        </p>
        <button
          type="button"
          onClick={() => void loadWarnings()}
          disabled={refreshing}
          aria-label="Perbarui peringatan aktif"
          title="Perbarui peringatan aktif"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-700 text-slate-300 transition hover:border-slate-500 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400/60 disabled:opacity-50"
        >
          <RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && warnings !== null && (
        <div role="status" className="mb-2 flex flex-wrap items-center justify-between gap-2 border-y border-amber-400/25 bg-amber-500/10 px-3 py-2">
          <p className="inline-flex items-center gap-2 text-xs text-amber-100">
            <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
            Data terbaru belum terkonfirmasi. Menampilkan data terakhir. {error}
          </p>
          <button
            type="button"
            onClick={() => void loadWarnings()}
            className="text-xs font-semibold text-amber-100 underline underline-offset-2"
          >
            Coba lagi
          </button>
        </div>
      )}

      {activeWarnings.length === 0 ? (
        <p className="border-y border-slate-800 py-8 text-center text-sm text-slate-500">
          Tidak ada peringatan aktif untuk watch zone Anda.
        </p>
      ) : (
        <div className="divide-y divide-slate-800 border-y border-slate-800">
          {activeWarnings.map((warning) => (
            <WarningRow key={warning.id} warning={warning} onViewOnMap={onViewOnMap} />
          ))}
        </div>
      )}
    </div>
  )
}
