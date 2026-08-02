import { useMemo } from 'react'
import OperationalMap from '../map/OperationalMap'
import type { OperationalMapFeature, OperationalMapFeatureCollection } from '../map/types'
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
  const evacuationCollection = useMemo<OperationalMapFeatureCollection>(() => ({
    type: 'FeatureCollection',
    layer: 'evacuations',
    truncated: false,
    features: locations.map((location) => ({
      type: 'Feature',
      id: location.id,
      geometry: { type: 'Point', coordinates: [location.longitude, location.latitude] },
      properties: {
        id: location.id,
        layer: 'evacuations',
        label: location.name,
        source: location.source_type,
        attribution: location.source_type === 'osm' ? 'OpenStreetMap contributors' : 'SadarBencana',
        verification_status: location.source_type === 'manual' ? 'operator-managed' : 'source-reported',
        location_type: location.location_type,
        open: location.is_open ?? undefined,
        full: location.is_full ?? undefined,
      },
    })),
  }), [locations])

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
      visibleLayers={['evacuations']}
      controlledCollections={{ evacuations: evacuationCollection }}
      showLegend={false}
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
