import { ExternalLink, X } from 'lucide-react'
import type { ReactNode } from 'react'
import SeverityBadge from '../../components/SeverityBadge'
import type { OperationalMapFeature, OperationalMapFeatureProperties } from './types'

interface MapDetailSheetProps {
  feature: OperationalMapFeature | null
  onClose: () => void
}

const approvedSourceHosts: Record<string, readonly string[]> = {
  bmkg: ['bmkg.go.id'],
  bmkg_air_quality: ['bmkg.go.id'],
  bmkg_cap: ['bmkg.go.id'],
  inatews: ['bmkg.go.id'],
  usgs: ['usgs.gov'],
  'nasa-firms': ['firms.modaps.eosdis.nasa.gov'],
  nasa_firms: ['firms.modaps.eosdis.nasa.gov'],
  osm: ['openstreetmap.org'],
  gdacs_fl: ['gdacs.org'],
  gdacs_vo: ['gdacs.org'],
  petabencana: ['petabencana.id'],
  gvp: ['volcano.si.edu'],
  pvmbg: ['esdm.go.id'],
}

function safeExternalUrl(source: string, value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    const approvedHosts = approvedSourceHosts[source.toLowerCase()]
    const hostname = url.hostname.toLowerCase()
    if (
      url.protocol === 'https:'
      && !url.username
      && !url.password
      && approvedHosts?.some((host) => hostname === host || hostname.endsWith(`.${host}`))
    ) return url.href
  } catch {
    // Omit invalid source URLs rather than presenting untrusted navigation.
  }
  return undefined
}

const LAYER_LABELS: Record<string, string> = {
  aircraft: 'Lalu lintas udara',
}

const PERIL_LABELS: Record<string, string> = {
  earthquake: 'Gempa bumi',
  wildfire: 'Karhutla',
  flood: 'Banjir',
  volcano: 'Aktivitas vulkanik',
  wind: 'Angin kencang',
  storm: 'Badai',
  tsunami: 'Tsunami',
}

function layerTypeLabel(properties: OperationalMapFeatureProperties): string {
  if (properties.layer === 'events' && properties.peril_type) {
    return PERIL_LABELS[properties.peril_type] ?? properties.peril_type
  }
  return LAYER_LABELS[properties.layer] ?? properties.layer
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(date)
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="operational-map__detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function TimestampRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <DetailRow label={label}>
      <time dateTime={value}>{formatTimestamp(value)}</time>
    </DetailRow>
  )
}

export function MapDetailSheet({ feature, onClose }: MapDetailSheetProps) {
  if (!feature) return null

  const { properties } = feature
  const sourceUrl = safeExternalUrl(properties.source, properties.source_url)
  const observation = [properties.pollutant, properties.value, properties.unit].filter((value) => value !== undefined && value !== '').join(' ')

  return (
    <aside className="operational-map__detail-sheet" role="dialog" aria-label="Detail peta">
      <header className="operational-map__detail-header">
        <div>
          <p className="operational-map__detail-type">{layerTypeLabel(properties)}</p>
          <h2>{properties.label}</h2>
        </div>
        <button type="button" className="operational-map__icon-button" aria-label="Tutup detail" title="Tutup detail" onClick={onClose}>
          <X aria-hidden="true" size={14} />
        </button>
      </header>
      <dl className="operational-map__detail-list">
        {properties.magnitude != null ? (
          <DetailRow label="Magnitudo">
            <strong className="operational-map__magnitude">M {properties.magnitude.toFixed(1)}</strong>
          </DetailRow>
        ) : null}
        {properties.place ? <DetailRow label="Lokasi">{properties.place}</DetailRow> : null}
        <DetailRow label="Sumber">{properties.source}</DetailRow>
        {properties.severity ? (
          <DetailRow label="Severity">
            <SeverityBadge severity={properties.severity} pulse />
          </DetailRow>
        ) : null}
        <DetailRow label="Atribusi">{properties.attribution}</DetailRow>
        <DetailRow label="Verifikasi">{properties.verification_status}</DetailRow>
        {observation ? <DetailRow label="Pengamatan">{observation}</DetailRow> : null}
        {properties.category ? <DetailRow label="Kategori udara">{properties.category}</DetailRow> : null}
        {properties.layer === 'aircraft' ? (
          <>
            {properties.altitude_m != null ? (
              <DetailRow label="Ketinggian">{Math.round(properties.altitude_m).toLocaleString('id-ID')} m ({Math.round(properties.altitude_m * 3.28084).toLocaleString('id-ID')} ft)</DetailRow>
            ) : null}
            {properties.velocity_ms != null ? (
              <DetailRow label="Kecepatan">{Math.round(properties.velocity_ms * 3.6).toLocaleString('id-ID')} km/j</DetailRow>
            ) : null}
            {properties.heading_deg != null ? (
              <DetailRow label="Arah">{Math.round(properties.heading_deg)}°</DetailRow>
            ) : null}
            {properties.category ? <DetailRow label="Negara asal">{properties.category}</DetailRow> : null}
          </>
        ) : null}
        {properties.layer === 'evacuations' ? (
          <>
            {properties.location_type ? <DetailRow label="Jenis lokasi">{properties.location_type}</DetailRow> : null}
            <DetailRow label="Status evakuasi">
              {properties.open === true && properties.full === false
                ? 'Terbuka'
                : properties.open === true && properties.full === true
                  ? 'Terbuka, penuh'
                  : properties.open === false
                    ? 'Tutup'
                    : 'Status belum diketahui'}
            </DetailRow>
          </>
        ) : null}
        <TimestampRow label="Diamati" value={properties.observed_at} />
        <TimestampRow label="Berlaku" value={properties.effective_at} />
        <TimestampRow label="Berakhir" value={properties.expires_at} />
        <TimestampRow label="Data diperbarui" value={properties.data_vintage} />
      </dl>
      {sourceUrl ? (
        <a className="operational-map__source-link" href={sourceUrl} target="_blank" rel="noreferrer noopener">
          Buka sumber <ExternalLink aria-hidden="true" size={12} />
        </a>
      ) : null}
    </aside>
  )
}
