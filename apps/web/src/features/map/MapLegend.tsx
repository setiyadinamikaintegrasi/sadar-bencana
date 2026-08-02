import type { PublicMapLayerResult } from './mapApi'
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
  onToggle: (layer: PublicOperationalMapLayer) => void
}

export function MapLegend({ enabledLayers, results, onToggle }: MapLegendProps) {
  const collections = Object.values(results).flatMap((result) => result?.collection ? [result.collection] : [])
  const stale = Object.values(results).some((result) => result?.state === 'stale')
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
              checked={enabledLayers.includes(layer)}
              onChange={() => onToggle(layer)}
            />
            <span>{LAYER_LABELS[layer]}</span>
          </label>
        ))}
      </fieldset>
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
