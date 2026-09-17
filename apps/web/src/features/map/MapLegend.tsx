import { useEffect, useRef } from 'react'
import { SEVERITY_TONES, type SeverityTone } from '../../components/severityTones'
import { eventPerilLegend } from './layers/eventIcons'
import type { PublicMapLayerResult, PublicMapLayerViewState } from './mapApi'
import { PUBLIC_OPERATIONAL_MAP_LAYERS, type PublicOperationalMapLayer } from './types'

const LAYER_LABELS: Record<PublicOperationalMapLayer, string> = {
  events: 'Kejadian',
  'official-alerts': 'Peringatan resmi',
  'air-quality': 'Kualitas udara',
  evacuations: 'Lokasi evakuasi',
  aircraft: 'Lalu lintas udara',
  shakemaps: 'Shakemap MMI',
  'flood-areas': 'Genangan banjir',
  cctv: 'CCTV jalan tol',
}

interface MapLegendProps {
  enabledLayers: PublicOperationalMapLayer[]
  results: Partial<Record<PublicOperationalMapLayer, PublicMapLayerResult>>
  layerStates?: Partial<Record<PublicOperationalMapLayer, PublicMapLayerViewState>>
  onToggle: (layer: PublicOperationalMapLayer) => void
  /** Mode heatmap kepadatan kejadian (menggantikan titik/klaster). */
  heatmapOn?: boolean
  onToggleHeatmap?: (next: boolean) => void
  /** Overlay radar cuaca (RainViewer). */
  radarOn?: boolean
  radarVintage?: string | null
  onToggleRadar?: (next: boolean) => void
  /** Overlay satelit inframerah — suhu puncak awan (NASA GIBS Himawari). */
  irOn?: boolean
  irVintage?: string | null
  onToggleIR?: (next: boolean) => void
  truecolorOn?: boolean
  truecolorVintage?: string | null
  onToggleTruecolor?: (next: boolean) => void
  floodSatOn?: boolean
  floodSatVintage?: string | null
  onToggleFloodSat?: (next: boolean) => void
  aerosolOn?: boolean
  aerosolVintage?: string | null
  onToggleAerosol?: (next: boolean) => void
  /** Terrain 3D (AWS Terrarium) + hillshade. */
  terrainOn?: boolean
  onToggleTerrain?: (next: boolean) => void
  /** Proyeksi globe (vs mercator). */
  globeOn?: boolean
  onToggleGlobe?: (next: boolean) => void
  /** Tema basemap terang/gelap. */
  theme?: 'light' | 'dark'
  onToggleTheme?: (next: 'light' | 'dark') => void
  /** Unduh cuplikan peta sebagai PNG (P9). */
  onExportSnapshot?: () => void
}

const healthLabel: Record<PublicMapLayerViewState['health'], string> = {
  loading: 'Memuat',
  current: 'Terkini',
  stale: 'Terlambat',
  unavailable: 'Tidak tersedia',
  empty: 'Kosong',
}

// Kunci severity: kritis & tinggi ditandai berkedip di peta/notifikasi.
const SEVERITY_KEY: Array<{ tone: Exclude<SeverityTone, 'none'>; blinks: boolean }> = [
  { tone: 'critical', blinks: true },
  { tone: 'high', blinks: true },
  { tone: 'moderate', blinks: false },
  { tone: 'low', blinks: false },
]

function fallbackState(result: PublicMapLayerResult | undefined): PublicMapLayerViewState | undefined {
  if (!result) return undefined
  return {
    collection: result.collection,
    health: result.state === 'ready' ? 'current' : result.state,
    refreshing: false,
  }
}

export function MapLegend({ enabledLayers, results, layerStates, onToggle, heatmapOn = false, onToggleHeatmap, radarOn = false, radarVintage = null, onToggleRadar, irOn = false, irVintage = null, onToggleIR, truecolorOn = false, truecolorVintage = null, onToggleTruecolor, floodSatOn = false, floodSatVintage = null, onToggleFloodSat, aerosolOn = false, aerosolVintage = null, onToggleAerosol, terrainOn = false, onToggleTerrain, globeOn = false, onToggleGlobe, theme = 'light', onToggleTheme, onExportSnapshot }: MapLegendProps) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null)
  // Di layar kecil legenda diringkas agar tidak menutupi peta; pengguna bisa
  // membukanya lewat summary. Desktop tetap terbuka.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    if (window.matchMedia('(max-width: 42rem)').matches && detailsRef.current) {
      detailsRef.current.open = false
    }
  }, [])
  const states = PUBLIC_OPERATIONAL_MAP_LAYERS.map((layer) => layerStates?.[layer] ?? fallbackState(results[layer]))
  const collections = states.flatMap((state) => state?.collection ? [state.collection] : [])
  const stale = states.some((state) => state?.health === 'stale')
  const truncated = collections.some((collection) => collection.truncated)
  const attributions = [...new Set(collections.flatMap((collection) => (
    collection.features.map((feature) => feature.properties.attribution).filter(Boolean)
  )))]

  return (
    <aside className="operational-map__legend" aria-label="Lapisan peta">
      <details ref={detailsRef} className="operational-map__legend-details" open>
        <summary>Lapisan</summary>
        <fieldset className="operational-map__layer-controls">
          {PUBLIC_OPERATIONAL_MAP_LAYERS.map((layer) => (
            <label key={layer} className="operational-map__layer-toggle">
              <input
                type="checkbox"
                aria-label={LAYER_LABELS[layer]}
                checked={enabledLayers.includes(layer)}
                onChange={() => onToggle(layer)}
              />
              <span>{LAYER_LABELS[layer]}</span>
              {enabledLayers.includes(layer) && (layerStates?.[layer] ?? fallbackState(results[layer])) ? (
                <span className="operational-map__layer-health" data-state={(layerStates?.[layer] ?? fallbackState(results[layer]))?.health}>
                  {healthLabel[(layerStates?.[layer] ?? fallbackState(results[layer]))!.health]}
                </span>
              ) : null}
            </label>
          ))}
        </fieldset>
        {onToggleHeatmap ? (
          <label className="operational-map__layer-toggle operational-map__layer-toggle--mode">
            <input
              type="checkbox"
              aria-label="Mode heatmap kepadatan"
              checked={heatmapOn}
              disabled={!enabledLayers.includes('events')}
              onChange={() => onToggleHeatmap(!heatmapOn)}
            />
            <span>Heatmap kepadatan</span>
          </label>
        ) : null}
        {onToggleRadar ? (
          <label className="operational-map__layer-toggle operational-map__layer-toggle--mode">
            <input
              type="checkbox"
              aria-label="Radar cuaca hujan"
              checked={radarOn}
              onChange={() => onToggleRadar(!radarOn)}
            />
            <span>Radar cuaca</span>
            {radarOn && radarVintage ? (
              <span className="operational-map__layer-health" title="Waktu observasi frame radar">
                {radarVintage}
              </span>
            ) : null}
          </label>
        ) : null}
        {onToggleIR ? (
          <label className="operational-map__layer-toggle operational-map__layer-toggle--mode">
            <input
              type="checkbox"
              aria-label="Satelit inframerah"
              checked={irOn}
              onChange={() => onToggleIR(!irOn)}
            />
            <span>Satelit IR</span>
            {irOn && irVintage ? (
              <span className="operational-map__layer-health" title="Tanggal granule satelit (UTC)">
                {irVintage}
              </span>
            ) : null}
          </label>
        ) : null}
        {onToggleTruecolor ? (
          <label className="operational-map__layer-toggle operational-map__layer-toggle--mode">
            <input
              type="checkbox"
              aria-label="Citra satelit warna asli (MODIS Terra, harian)"
              checked={truecolorOn}
              onChange={() => onToggleTruecolor(!truecolorOn)}
            />
            <span>Citra satelit</span>
            {truecolorOn && truecolorVintage ? (
              <span className="operational-map__layer-health" title="Tanggal granule MODIS Terra (UTC) — asap karhutla dan abu vulkanik terlihat langsung">
                {truecolorVintage}
              </span>
            ) : null}
          </label>
        ) : null}
        {onToggleFloodSat ? (
          <label
            className="operational-map__layer-toggle operational-map__layer-toggle--mode"
            title={floodSatVintage ? undefined : 'Granule satelit area ini belum tersedia — coba lagi nanti'}
          >
            <input
              type="checkbox"
              aria-label="Deteksi banjir satelit (MODIS 2 hari)"
              checked={floodSatOn}
              disabled={!floodSatVintage}
              onChange={() => onToggleFloodSat(!floodSatOn)}
            />
            <span>Banjir satelit</span>
            {floodSatOn && floodSatVintage ? (
              <span className="operational-map__layer-health" title="Composite deteksi banjir MODIS (UTC) — pelengkap laporan ground">
                {floodSatVintage}
              </span>
            ) : null}
          </label>
        ) : null}
        {onToggleAerosol ? (
          <label
            className="operational-map__layer-toggle operational-map__layer-toggle--mode"
            title={aerosolVintage ? undefined : 'Granule satelit area ini belum tersedia — coba lagi nanti'}
          >
            <input
              type="checkbox"
              aria-label="Sebaran asap (indeks aerosol OMPS)"
              checked={aerosolOn}
              disabled={!aerosolVintage}
              onChange={() => onToggleAerosol(!aerosolOn)}
            />
            <span>Sebaran asap</span>
            {aerosolOn && aerosolVintage ? (
              <span className="operational-map__layer-health" title="Tanggal indeks aerosol OMPS (UTC) — pasangan visual panel asap lintas batas">
                {aerosolVintage}
              </span>
            ) : null}
          </label>
        ) : null}
        {onToggleTerrain ? (
          <label className="operational-map__layer-toggle operational-map__layer-toggle--mode">
            <input
              type="checkbox"
              aria-label="Terrain 3D"
              checked={terrainOn}
              onChange={() => onToggleTerrain(!terrainOn)}
            />
            <span>Terrain 3D</span>
          </label>
        ) : null}
        {onToggleGlobe ? (
          <label className="operational-map__layer-toggle operational-map__layer-toggle--mode">
            <input
              type="checkbox"
              aria-label="Mode globe"
              checked={globeOn}
              onChange={() => onToggleGlobe(!globeOn)}
            />
            <span>Globe</span>
          </label>
        ) : null}
        {onToggleTheme ? (
          <label className="operational-map__layer-toggle operational-map__layer-toggle--mode">
            <input
              type="checkbox"
              aria-label="Tema peta gelap"
              checked={theme === 'dark'}
              onChange={() => onToggleTheme(theme === 'dark' ? 'light' : 'dark')}
            />
            <span>Tema gelap</span>
          </label>
        ) : null}
        <div className="operational-map__severity-key" aria-label="Tingkat kewaspadaan">
          <p className="operational-map__severity-title">Tingkat kewaspadaan</p>
          <ul>
            {SEVERITY_KEY.map(({ tone, blinks }) => (
              <li key={tone}>
                <span
                  className="operational-map__severity-dot"
                  data-tone={tone}
                  style={{ backgroundColor: SEVERITY_TONES[tone].color }}
                />
                <span>{SEVERITY_TONES[tone].label}</span>
                {blinks ? <span className="operational-map__severity-blink-hint">berkedip</span> : null}
              </li>
            ))}
          </ul>
        </div>
        <div className="operational-map__severity-key" aria-label="Jenis bencana">
          <p className="operational-map__severity-title">Jenis bencana</p>
          <ul>
            {eventPerilLegend().map((icon) => (
              <li key={icon.imageId}>
                <span className="operational-map__peril-glyph" aria-hidden="true">{icon.glyph}</span>
                <span>{icon.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </details>
      {/* Tombol unduh cuplikan (P9) di luar <details> agar tetap terlihat
          saat legenda diringkas di layar kecil. */}
      {onExportSnapshot ? (
        <button type="button" className="operational-map__snapshot-button" onClick={onExportSnapshot}>
          Unduh peta (PNG)
        </button>
      ) : null}
      {/* Nota status & atribusi tetap terlihat meski legenda diringkas. */}
      {enabledLayers.length === 0 ? <p className="operational-map__notice">Aktifkan setidaknya satu lapisan.</p> : null}
      {states.some((state) => state?.refreshing) ? <p className="operational-map__notice">Memperbarui data peta.</p> : null}
      {states.some((state) => state?.refreshFailed) ? <p className="operational-map__notice" data-state="stale">Data tersimpan, muat ulang gagal.</p> : null}
      {stale ? <p className="operational-map__notice" data-state="stale">Data mungkin terlambat.</p> : null}
      {truncated ? <p className="operational-map__notice">Hasil dibatasi untuk area ini.</p> : null}
      {attributions.length > 0 ? (
        <p className="operational-map__attribution">
          {attributions.join(' | ')}
        </p>
      ) : null}
    </aside>
  )
}
