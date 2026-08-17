import { useMemo } from 'react'
import OperationalMap from '../map/OperationalMap'
import type { WatchZoneMapPickerProps } from './WatchZoneMapPicker'

const INDONESIA_CENTER = { latitude: -2.5, longitude: 118 }

export default function MapLibreWatchZonePicker({
  latitude,
  longitude,
  radiusKm,
  onChange,
}: WatchZoneMapPickerProps) {
  const localOverlay = useMemo<GeoJSON.FeatureCollection | undefined>(() => {
    if (latitude === null || longitude === null) return undefined
    const latitudeRadius = radiusKm / 111.32
    const longitudeRadius = radiusKm / (111.32 * Math.max(Math.cos(latitude * Math.PI / 180), 0.01))
    const ring: GeoJSON.Position[] = Array.from({ length: 65 }, (_, index) => {
      const angle = index / 64 * Math.PI * 2
      return [
        longitude + Math.cos(angle) * longitudeRadius,
        latitude + Math.sin(angle) * latitudeRadius,
      ]
    })
    return {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { kind: 'watch-zone-draft' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [longitude, latitude] }, properties: { kind: 'watch-zone-center' } },
      ],
    }
  }, [latitude, longitude, radiusKm])

  return (
    <div className="space-y-3">
      <div className="h-80 overflow-hidden rounded-xl border border-slate-800">
        <OperationalMap
          mode="picker"
          initialLayers={[]}
          className="h-full"
          onPick={(lat, lon) => onChange(lat, lon, radiusKm)}
          localOverlay={localOverlay}
          focusCenter={latitude !== null && longitude !== null ? [longitude, latitude] : undefined}
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          <label htmlFor="maplibre-watch-zone-radius">Radius</label>
          <span className="text-indigo-300">{radiusKm} km</span>
        </div>
        <input
          id="maplibre-watch-zone-radius"
          aria-label="Radius"
          type="range"
          min={10}
          max={500}
          step={10}
          value={radiusKm}
          onChange={(event) => onChange(
            latitude ?? INDONESIA_CENTER.latitude,
            longitude ?? INDONESIA_CENTER.longitude,
            Number(event.target.value),
          )}
          className="w-full accent-indigo-500"
        />
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Coordinate label="Lat" value={latitude === null ? null : latitude.toFixed(4)} />
        <Coordinate label="Lon" value={longitude === null ? null : longitude.toFixed(4)} />
        <Coordinate label="Radius" value={`${radiusKm} km`} />
      </div>
    </div>
  )
}

function Coordinate({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="font-mono text-slate-200">{value ?? '-'}</p>
    </div>
  )
}
