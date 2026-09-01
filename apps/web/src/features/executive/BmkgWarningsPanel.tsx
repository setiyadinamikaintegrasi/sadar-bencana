import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  AlertTriangle,
  Clock3,
  CloudLightning,
  ExternalLink,
  MapPin,
  RefreshCw,
  ShieldAlert,
  Wind,
} from 'lucide-react'
import type { AirQualityObservation, OfficialAlert } from '../../lib/api/client'
import {
  filterActiveOfficialAlerts,
  formatIndonesiaTime,
  formatTimeRemaining,
  lifecycleStatusText,
  safeBmkgSourceUrl,
  sortAirQualityObservations,
  sortOfficialAlerts,
} from './bmkgPresentation'
import type { BmkgEndpointStatuses } from './useBmkgWarnings'

type PanelTab = 'weather' | 'air_quality'

export type BmkgWarningsPanelProps = {
  weatherAlerts: OfficialAlert[]
  airQualityAlerts: OfficialAlert[]
  observations: AirQualityObservation[]
  sourceActive: boolean | null
  loading: boolean
  errors: Record<string, string>
  status: BmkgEndpointStatuses
  now: number
  onFocusAlert: (id: string) => void
  onRetry: () => void
}

const PM25_BMKG_URL = 'https://iklim.bmkg.go.id/en/kualitas-udara-indonesia/'

const severityClasses: Record<string, string> = {
  Critical: 'border-rose-400/40 bg-rose-500/15 text-rose-200 severity-blink severity-blink--critical',
  High: 'border-orange-400/40 bg-orange-500/15 text-orange-200 severity-blink severity-blink--high',
  Moderate: 'border-amber-400/40 bg-amber-500/15 text-amber-200',
}

const categoryClasses: Record<string, string> = {
  Baik: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200',
  Sedang: 'border-sky-400/40 bg-sky-500/15 text-sky-200',
  'Tidak Sehat': 'border-amber-400/40 bg-amber-500/15 text-amber-200',
  'Sangat Tidak Sehat': 'border-orange-400/40 bg-orange-500/15 text-orange-200',
  Berbahaya: 'border-rose-400/40 bg-rose-500/15 text-rose-200',
}

function hasMapPosition(alert: OfficialAlert): boolean {
  return alert.area_geojson != null || (alert.latitude != null && alert.longitude != null)
}

function AlertSeverity({ severity }: { severity: OfficialAlert['severity'] }) {
  const label = severity ?? 'Belum dinilai'
  const classes = severity ? severityClasses[severity] : 'border-slate-600 bg-slate-800 text-slate-300'
  return (
    <span
      aria-label={`Tingkat keparahan ${label}`}
      className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold ${classes}`}
    >
      {label}
    </span>
  )
}

function OfficialAlertRow({
  alert,
  onFocusAlert,
  uncertain,
  now,
  isActive,
}: {
  alert: OfficialAlert
  onFocusAlert: (id: string) => void
  uncertain: boolean
  now: number
  isActive: boolean
}) {
  const sourceUrl = safeBmkgSourceUrl(alert.source_url)
  const headline = alert.headline ?? 'Peringatan resmi BMKG'
  return (
    <article className="grid gap-3 border-t border-slate-800 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:px-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="min-w-0 text-sm font-semibold text-slate-100">{headline}</h4>
          <AlertSeverity severity={alert.severity} />
          {alert.category && (
            <span
              aria-label={`Kategori kualitas udara ${alert.category}`}
              className="rounded-md border border-slate-600 bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-200"
            >
              {alert.category}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-400">
          {alert.area_name ?? 'Wilayah belum terpetakan'}
        </p>
        {alert.description && (
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{alert.description}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
          <span className={uncertain ? 'font-semibold text-amber-300' : 'font-semibold text-emerald-300'}>
            {lifecycleStatusText(alert, now, uncertain)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />
            Efektif {formatIndonesiaTime(alert.effective_at ?? alert.sent_at)}
          </span>
          {alert.expires_at && <span>Berakhir {formatIndonesiaTime(alert.expires_at)}</span>}
          <span>{formatTimeRemaining(alert.expires_at, now)}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Sumber BMKG"
            tabIndex={isActive ? undefined : -1}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-700 px-2.5 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400/60"
          >
            Sumber BMKG
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
          </a>
        )}
        {hasMapPosition(alert) && (
          <button
            type="button"
            onClick={() => onFocusAlert(alert.id)}
            aria-label={`Fokuskan ${headline} di peta`}
            disabled={!isActive}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-indigo-400/40 bg-indigo-500/15 px-2.5 text-xs font-semibold text-indigo-100 transition hover:bg-indigo-500/25 focus:outline-none focus:ring-2 focus:ring-indigo-400/60"
          >
            <MapPin aria-hidden="true" className="h-3.5 w-3.5" />
            Fokus peta
          </button>
        )}
      </div>
    </article>
  )
}

function ObservationRow({
  observation,
  uncertain,
  isActive,
}: {
  observation: AirQualityObservation
  uncertain: boolean
  isActive: boolean
}) {
  const sourceUrl = safeBmkgSourceUrl(observation.source_url)
  return (
    <article className="grid gap-3 border-t border-slate-800 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:px-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold text-slate-100">{observation.station_name}</h4>
          <span
            aria-label={`Kategori kualitas udara ${observation.category}`}
            className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${categoryClasses[observation.category]}`}
          >
            {observation.category}
          </span>
          {observation.stale && (
            <span className="rounded-md border border-slate-600 bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
              Data terlambat
            </span>
          )}
          {uncertain && (
            <span className="rounded-md border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
              Data terbaru belum terkonfirmasi
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-400">
          PM2.5 <span className="font-semibold text-slate-200">{observation.value.toLocaleString('id-ID')}</span> {observation.unit}
        </p>
        <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-slate-500">
          <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />
          Diamati {formatIndonesiaTime(observation.observed_at)}
        </p>
      </div>
      {sourceUrl && (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Sumber BMKG ${observation.station_name}`}
          tabIndex={isActive ? undefined : -1}
          className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-slate-700 px-2.5 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400/60"
        >
          Sumber BMKG
          <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
        </a>
      )}
    </article>
  )
}

function ErrorRow({
  message,
  onRetry,
  isActive,
}: {
  message: string
  onRetry: () => void
  isActive: boolean
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-rose-400/25 bg-rose-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-5">
      <p className="inline-flex items-center gap-2 text-xs font-medium text-rose-200">
        <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={!isActive}
        className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-rose-300/40 px-2.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/15 focus:outline-none focus:ring-2 focus:ring-rose-300/60"
      >
        <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
        Coba lagi
      </button>
    </div>
  )
}

function LoadingRows() {
  return (
    <div role="status" aria-label="Memuat peringatan BMKG" style={{ minHeight: '18rem' }}>
      <span className="sr-only">Memuat peringatan BMKG</span>
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          data-skeleton-row="true"
          className="h-24 animate-pulse border-t border-slate-800 px-4 py-3 md:px-5"
        >
          <div className="h-3 w-2/5 rounded bg-slate-800" />
          <div className="mt-3 h-2.5 w-3/5 rounded bg-slate-800/80" />
          <div className="mt-3 h-2.5 w-1/3 rounded bg-slate-800/60" />
        </div>
      ))}
    </div>
  )
}

function EmptyRow({ stale = false }: { stale?: boolean }) {
  return (
    <div className="flex min-h-32 items-center justify-center border-t border-slate-800 px-4 py-8 text-center">
      {stale ? (
        <div>
          <p className="text-sm font-medium text-amber-300">Tidak ada peringatan aktif.</p>
          <p className="mt-1 text-xs text-amber-400/80">
            Sumber BMKG belum menerbitkan peringatan baru (&gt;48 jam) — feed aman
            diakses, menunggu penerbitan resmi berikutnya.
          </p>
        </div>
      ) : (
        <p className="text-sm font-medium text-slate-400">Tidak ada peringatan aktif.</p>
      )}
    </div>
  )
}

function SourceStateRow({ children }: { children: string }) {
  return (
    <div className="border-t border-amber-400/25 bg-amber-500/10 px-4 py-3 md:px-5">
      <p className="text-xs font-medium text-amber-100">{children}</p>
    </div>
  )
}

export default function BmkgWarningsPanel({
  weatherAlerts,
  airQualityAlerts,
  observations,
  sourceActive,
  loading,
  errors,
  status,
  now,
  onFocusAlert,
  onRetry,
}: BmkgWarningsPanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>('weather')
  // Deteksi sumber stale (mis. BMKG belum menerbitkan peringatan baru >48 jam):
  // tampilkan pesan jujur, bukan sekadar 'Tidak ada peringatan aktif'.
  const [sourceStale, setSourceStale] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/health/connectors')
      .then(async (res) => (res.ok ? res.json() : null))
      .then((data: { data?: { name: string; status: string }[] } | null) => {
        if (cancelled || !data?.data) return
        const cap = data.data.find((item) => item.name === 'bmkg_cap')
        setSourceStale(cap?.status === 'feed_stale')
      })
      .catch(() => {
        // Health endpoint tak wajib — panel tetap berfungsi.
      })
    return () => { cancelled = true }
  }, [])
  const instanceId = useId()
  const titleId = `${instanceId}-title`
  const weatherTabId = `${instanceId}-tab-weather`
  const airTabId = `${instanceId}-tab-air-quality`
  const weatherPanelId = `${instanceId}-panel-weather`
  const airPanelId = `${instanceId}-panel-air-quality`
  const tabRefs = useRef<Record<PanelTab, HTMLButtonElement | null>>({
    weather: null,
    air_quality: null,
  })
  const sortedWeather = useMemo(
    () => sortOfficialAlerts(filterActiveOfficialAlerts(weatherAlerts, now)),
    [now, weatherAlerts],
  )
  const sortedAirAlerts = useMemo(
    () => sortOfficialAlerts(filterActiveOfficialAlerts(airQualityAlerts, now)),
    [airQualityAlerts, now],
  )
  const sortedObservations = useMemo(
    () => sortAirQualityObservations(observations),
    [observations],
  )
  const airHasError = Boolean(errors.air_quality || errors.observations)
  const weatherConfirmedEmpty = status.weather.loaded
    && !status.weather.uncertain
    && sortedWeather.length === 0
  const airConfirmedEmpty = sourceActive === true
    && status.air_quality.loaded
    && status.observations.loaded
    && !status.air_quality.uncertain
    && !status.observations.uncertain
    && sortedAirAlerts.length === 0
    && sortedObservations.length === 0
  const weatherIsActive = activeTab === 'weather'
  const airIsActive = activeTab === 'air_quality'
  const panelClassName = (isActive: boolean) => (
    `col-start-1 row-start-1 ${isActive ? '' : 'invisible pointer-events-none'}`
  )
  const setPanelInert = (element: HTMLDivElement | null, isActive: boolean) => {
    if (!element) return
    if (isActive) {
      element.removeAttribute('inert')
    } else {
      element.setAttribute('inert', '')
    }
  }

  const selectTab = (tab: PanelTab) => {
    setActiveTab(tab)
    tabRefs.current[tab]?.focus()
  }

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tab: PanelTab) => {
    let next: PanelTab | null = null
    if (event.key === 'Home') next = 'weather'
    if (event.key === 'End') next = 'air_quality'
    if (event.key === 'ArrowRight') next = tab === 'weather' ? 'air_quality' : 'weather'
    if (event.key === 'ArrowLeft') next = tab === 'weather' ? 'air_quality' : 'weather'
    if (!next) return
    event.preventDefault()
    selectTab(next)
  }

  return (
    <section aria-labelledby={titleId} className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/90 shadow-xl shadow-slate-950/30">
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldAlert aria-hidden="true" className="h-4 w-4 shrink-0 text-fuchsia-300" />
            <h3 id={titleId} className="text-sm font-semibold text-slate-50">
              Peringatan Resmi BMKG
            </h3>
          </div>
          <p className="mt-1 whitespace-normal break-words text-[11px] leading-4 text-slate-500">
            BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Jenis peringatan BMKG"
          className="grid w-full grid-cols-2 rounded-lg border border-slate-700 bg-slate-950/70 p-1 sm:w-auto"
        >
          <button
            ref={(element) => { tabRefs.current.weather = element }}
            id={weatherTabId}
            type="button"
            role="tab"
            aria-label="Cuaca Ekstrem"
            aria-selected={activeTab === 'weather'}
            aria-controls={weatherPanelId}
            tabIndex={activeTab === 'weather' ? 0 : -1}
            onClick={() => setActiveTab('weather')}
            onKeyDown={(event) => handleTabKeyDown(event, 'weather')}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-indigo-400/60 ${
              activeTab === 'weather'
                ? 'bg-indigo-500/20 text-indigo-100'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <CloudLightning aria-hidden="true" className="h-3.5 w-3.5" />
            Cuaca Ekstrem
            <span
              aria-label={`${sortedWeather.length} peringatan cuaca aktif`}
              className="min-w-5 rounded bg-slate-900 px-1 text-center text-[10px] text-slate-300"
            >
              {sortedWeather.length}
            </span>
          </button>
          <button
            ref={(element) => { tabRefs.current.air_quality = element }}
            id={airTabId}
            type="button"
            role="tab"
            aria-label="Kualitas Udara"
            aria-selected={activeTab === 'air_quality'}
            aria-controls={airPanelId}
            tabIndex={activeTab === 'air_quality' ? 0 : -1}
            onClick={() => setActiveTab('air_quality')}
            onKeyDown={(event) => handleTabKeyDown(event, 'air_quality')}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-indigo-400/60 ${
              activeTab === 'air_quality'
                ? 'bg-indigo-500/20 text-indigo-100'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <Wind aria-hidden="true" className="h-3.5 w-3.5" />
            Kualitas Udara
          </button>
        </div>
      </div>

      <div className="grid">
        <div
          id={weatherPanelId}
          role="tabpanel"
          aria-labelledby={weatherTabId}
          aria-hidden={!weatherIsActive}
          ref={(element) => setPanelInert(element, weatherIsActive)}
          className={panelClassName(weatherIsActive)}
        >
          {loading ? <LoadingRows /> : (
          <>
          {errors.weather && (
            <ErrorRow message="Gagal memuat sebagian data cuaca BMKG." onRetry={onRetry} isActive={weatherIsActive} />
          )}
          {sortedWeather.map((alert) => (
            <OfficialAlertRow
              key={alert.id}
              alert={alert}
              onFocusAlert={onFocusAlert}
              uncertain={status.weather.uncertain}
              now={now}
              isActive={weatherIsActive}
            />
          ))}
          {weatherConfirmedEmpty && <EmptyRow stale={sourceStale} />}
          </>
          )}
        </div>

        <div
          id={airPanelId}
          role="tabpanel"
          aria-labelledby={airTabId}
          aria-hidden={!airIsActive}
          ref={(element) => setPanelInert(element, airIsActive)}
          className={panelClassName(airIsActive)}
        >
          {loading ? <LoadingRows /> : (
          <>
          {sourceActive === false && status.observations.uncertain && (
            <SourceStateRow>
              Status terakhir: integrasi kualitas udara BMKG belum aktif; status terbaru belum diketahui
            </SourceStateRow>
          )}
          {sourceActive === false && !status.observations.uncertain && (
            <div className="flex flex-col gap-2 border-t border-amber-400/25 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-5">
              <p className="text-xs font-medium text-amber-100">
                Integrasi kualitas udara BMKG belum aktif
              </p>
              <a
                href={PM25_BMKG_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Lihat informasi PM2.5 BMKG"
                tabIndex={airIsActive ? undefined : -1}
                className="inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-amber-200 hover:text-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-300/60"
              >
                Informasi PM2.5 BMKG
                <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
              </a>
            </div>
          )}
          {sourceActive === null && (
            <SourceStateRow>Status integrasi kualitas udara BMKG belum diketahui</SourceStateRow>
          )}
          {airHasError && (
            <ErrorRow message="Gagal memuat sebagian data kualitas udara BMKG." onRetry={onRetry} isActive={airIsActive} />
          )}
          {sortedAirAlerts.map((alert) => (
            <OfficialAlertRow
              key={alert.id}
              alert={alert}
              onFocusAlert={onFocusAlert}
              uncertain={status.air_quality.uncertain}
              now={now}
              isActive={airIsActive}
            />
          ))}
          {sortedObservations.map((observation) => (
            <ObservationRow
              key={observation.id}
              observation={observation}
              uncertain={status.observations.uncertain}
              isActive={airIsActive}
            />
          ))}
          {airConfirmedEmpty && <EmptyRow stale={sourceStale} />}
          </>
          )}
        </div>
      </div>
    </section>
  )
}
