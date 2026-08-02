import { ExternalLink, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { OperationalMapFeature } from './types'

interface MapDetailSheetProps {
  feature: OperationalMapFeature | null
  onClose: () => void
}

const approvedSourceHosts: Record<string, readonly string[]> = {
  bmkg: ['bmkg.go.id'],
  usgs: ['usgs.gov'],
  'nasa-firms': ['nasa.gov'],
  osm: ['openstreetmap.org'],
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
          <p className="operational-map__detail-type">{properties.layer}</p>
          <h2>{properties.label}</h2>
        </div>
        <button type="button" className="operational-map__icon-button" aria-label="Tutup detail" title="Tutup detail" onClick={onClose}>
          <X aria-hidden="true" size={18} />
        </button>
      </header>
      <dl className="operational-map__detail-list">
        <DetailRow label="Sumber">{properties.source}</DetailRow>
        <DetailRow label="Atribusi">{properties.attribution}</DetailRow>
        <DetailRow label="Verifikasi">{properties.verification_status}</DetailRow>
        {observation ? <DetailRow label="Pengamatan">{observation}</DetailRow> : null}
        {properties.category ? <DetailRow label="Kategori udara">{properties.category}</DetailRow> : null}
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
          Buka sumber <ExternalLink aria-hidden="true" size={15} />
        </a>
      ) : null}
    </aside>
  )
}
