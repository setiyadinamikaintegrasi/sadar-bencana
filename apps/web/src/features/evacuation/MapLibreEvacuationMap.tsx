import { useMemo } from 'react'
import OperationalMap from '../map/OperationalMap'
import type { OperationalMapFeature } from '../map/types'
import type { EvacuationMapProps } from './EvacuationMap'

export default function MapLibreEvacuationMap({
  locations,
  userPos,
  routeTo,
  manualPinMode,
  onMapClick,
  onSelect,
  onViewportChange,
}: EvacuationMapProps) {
  const localOverlay = useMemo<GeoJSON.FeatureCollection | undefined>(() => {
    if (!userPos) return undefined
    const features: GeoJSON.Feature[] = [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [userPos[1], userPos[0]] },
      properties: { kind: 'user-position' },
    }]
    if (routeTo) features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[userPos[1], userPos[0]], [routeTo[1], routeTo[0]]] },
      properties: { kind: 'evacuation-route' },
    })
    return { type: 'FeatureCollection', features }
  }, [routeTo, userPos])

  const selectLocation = (feature: OperationalMapFeature) => {
    if (feature.properties.layer !== 'evacuations') return
    const location = locations.find((item) => item.id === feature.id || item.id === feature.properties.id)
    if (location) onSelect(location)
  }

  return (
    <OperationalMap
      mode="viewer"
      initialLayers={['evacuations']}
      className="h-[420px] w-full md:h-[520px]"
      onPick={manualPinMode ? onMapClick : undefined}
      onFeatureSelect={selectLocation}
      localOverlay={localOverlay}
      focusCenter={routeTo ? [routeTo[1], routeTo[0]] : userPos ? [userPos[1], userPos[0]] : undefined}
      onViewportChange={(viewport) => onViewportChange({
        minLat: viewport.bbox[1],
        maxLat: viewport.bbox[3],
        minLon: viewport.bbox[0],
        maxLon: viewport.bbox[2],
      }, viewport.zoom)}
    />
  )
}
