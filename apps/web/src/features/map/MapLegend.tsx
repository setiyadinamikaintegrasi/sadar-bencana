import type { PublicMapLayerResult, PublicMapLayerViewState } from './mapApi'
import { PUBLIC_OPERATIONAL_MAP_LAYERS, type PublicOperationalMapLayer } from './types'

const LAYER_LABELS: Record<PublicOperationalMapLayer, string> = {
  events: 'Kejadian',
  'official-alerts': 'Peringatan resmi',
  'air-quality': 'Kualitas udara',
  evacuations: 'Lokasi evakuasi',
}

interface MapLegendProps {
  enabledLayers: PublicOperationalMapLayer[]
  results: Partial<Record<PublicOperationalMapLayer, PublicMapLayerResult>>
  layerStates?: Partial<Record<PublicOperationalMapLayer, PublicMapLayerViewState>>
  onToggle: (layer: PublicOperationalMapLayer) => void
}

const healthLabel: Record<PublicMapLayerViewState['health'], string> = {
  loading: 'Memuat',
  current: 'Terkini',
  stale: 'Terlambat',
  unavailable: 'Tidak tersedia',
  empty: 'Kosong',
}

function fallbackState(result: PublicMapLayerResult | undefined): PublicMapLayerViewState | undefined {
  if (!result) return undefined
  return {
    collection: result.collection,
    health: result.state === 'ready' ? 'current' : result.state,
    refreshing: false,
  }
}

export function MapLegend({ enabledLayers, results, layerStates, onToggle }: MapLegendProps) {
  const states = PUBLIC_OPERATIONAL_MAP_LAYERS.map((layer) => layerStates?.[layer] ?? fallbackState(results[layer]))
  const collections = states.flatMap((state) => state?.collection ? [state.collection] : [])
  const stale = states.some((state) => state?.health === 'stale')
  const truncated = collections.some((collection) => collection.truncated)
  const attributions = [...new Set(collections.flatMap((collection) => (
    collection.features.map((feature) => feature.properties.attribution).filter(Boolean)
  )))]

  return (
    <aside className="operational-map__legend" aria-label="Lapisan peta">
      <fieldset className="operational-map__layer-controls">
        <legend>Lapisan</legend>
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
