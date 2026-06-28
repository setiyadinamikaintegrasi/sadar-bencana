import { useMemo } from 'react'
import { Circle, MapContainer, Marker, TileLayer, useMapEvents } from 'react-leaflet'
import L from 'leaflet'

const INDONESIA_CENTER: [number, number] = [-2.5, 118]

// Simple DivIcon avoids bundler asset-path issues with the default Leaflet marker.
const markerIcon = L.divIcon({
  className: '',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  html:
    '<div style="width:18px;height:18px;border-radius:9999px;border:2px solid #fff;' +
    'background:#a78bfa;box-shadow:0 4px 12px rgba(0,0,0,0.5)"></div>',
})

interface WatchZoneMapPickerProps {
  latitude: number | null
  longitude: number | null
  radiusKm: number
  onChange: (lat: number, lon: number, radius: number) => void
}

function ClickAndDragLayer({
  latitude,
  longitude,
  radiusKm,
  onChange,
}: WatchZoneMapPickerProps) {
  useMapEvents({
    click: (e) => {
      onChange(e.latlng.lat, e.latlng.lng, radiusKm)
    },
  })

  if (latitude === null || longitude === null) return null

  return (
    <>
      <Circle
        center={[latitude, longitude]}
        radius={radiusKm * 1000}
        pathOptions={{ color: '#a78bfa', weight: 1, fillOpacity: 0.1 }}
      />
      <Marker
        position={[latitude, longitude]}
        icon={markerIcon}
        draggable
        eventHandlers={{
          dragend: (e) => {
            const { lat, lng } = e.target.getLatLng()
            onChange(lat, lng, radiusKm)
          },
        }}
      />
    </>
  )
}

export default function WatchZoneMapPicker({
  latitude,
  longitude,
  radiusKm,
  onChange,
}: WatchZoneMapPickerProps) {
  const center = useMemo<[number, number]>(
    () => (latitude !== null && longitude !== null ? [latitude, longitude] : INDONESIA_CENTER),
    [latitude, longitude],
  )

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-slate-800">
        <div style={{ height: 320 }}>
          <MapContainer
            center={center}
            zoom={latitude !== null ? 7 : 4}
            scrollWheelZoom
            zoomControl
            attributionControl={false}
            style={{ height: '100%', width: '100%', background: '#020617' }}
          >
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
            <ClickAndDragLayer
              latitude={latitude}
              longitude={longitude}
              radiusKm={radiusKm}
              onChange={onChange}
            />
          </MapContainer>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          <span>Radius</span>
          <span className="text-indigo-300">{radiusKm} km</span>
        </div>
        <input
          type="range"
          min={10}
          max={500}
          step={10}
          value={radiusKm}
          onChange={(e) =>
            onChange(latitude ?? INDONESIA_CENTER[0], longitude ?? INDONESIA_CENTER[1], Number(e.target.value))
          }
          className="w-full accent-indigo-500"
        />
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Lat</p>
          <p className="font-mono text-slate-200">{latitude !== null ? latitude.toFixed(4) : '—'}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Lon</p>
          <p className="font-mono text-slate-200">{longitude !== null ? longitude.toFixed(4) : '—'}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Radius</p>
          <p className="font-mono text-slate-200">{radiusKm} km</p>
        </div>
      </div>

      <p className="text-[11px] text-slate-500">
        Klik pada peta untuk menentukan titik pusat, lalu seret marker untuk menyesuaikan.
      </p>
    </div>
  )
}
