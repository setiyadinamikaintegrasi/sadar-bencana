import { useEffect, useMemo } from 'react'
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import {
  EVACUATION_TYPE_META,
  type EvacuationLocation,
} from '../../lib/api/evacuation'

const INDONESIA_CENTER: [number, number] = [-2.5, 118]

function statusColor(loc: EvacuationLocation): string {
  if (loc.is_open === false) return '#64748b' // tutup: abu-abu
  if (loc.is_open === null) return '#64748b' // tidak diketahui: abu-abu
  if (loc.is_full === true) return '#fbbf24' // buka tapi penuh: kuning
  return '#34d399' // buka & tersedia: hijau
}

function locationIcon(loc: EvacuationLocation): L.DivIcon {
  const meta = EVACUATION_TYPE_META[loc.location_type]
  return L.divIcon({
    className: '',
    html: `<div style="width:24px;height:24px;border-radius:9999px;background:${statusColor(loc)};border:1px solid rgba(255,255,255,.5);display:flex;align-items:center;justify-content:center;color:#0f172a;font-size:11px;font-weight:800;box-shadow:0 4px 12px rgba(0,0,0,.4)">${meta.glyph}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
}

const userIcon = L.divIcon({
  className: '',
  html: '<div style="width:16px;height:16px;border-radius:9999px;background:#6366f1;border:3px solid white;box-shadow:0 0 0 4px rgba(99,102,241,.35)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

function MapClickCapture({ enabled, onMapClick }: { enabled: boolean; onMapClick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      if (enabled) onMapClick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

function FitRoute({ routeTo, userPos }: { routeTo: [number, number] | null; userPos: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    if (routeTo && userPos) map.fitBounds(L.latLngBounds([userPos, routeTo]), { padding: [48, 48] })
    else if (userPos) map.setView(userPos, 13)
  }, [map, routeTo, userPos])
  return null
}

type EvacuationMapProps = {
  locations: EvacuationLocation[]
  userPos: [number, number] | null
  routeTo: [number, number] | null
  manualPinMode: boolean
  onMapClick: (lat: number, lon: number) => void
  onSelect: (loc: EvacuationLocation) => void
}

export default function EvacuationMap({
  locations, userPos, routeTo, manualPinMode, onMapClick, onSelect,
}: EvacuationMapProps) {
  const markers = useMemo(
    () =>
      locations.map((loc) => (
        <Marker
          key={loc.id}
          position={[loc.latitude, loc.longitude]}
          icon={locationIcon(loc)}
          eventHandlers={{ click: () => onSelect(loc) }}
        >
          <Popup>
            <span className="font-semibold">{loc.name}</span>
            <br />
            {EVACUATION_TYPE_META[loc.location_type].label}
          </Popup>
        </Marker>
      )),
    [locations, onSelect],
  )

  return (
    <MapContainer
      center={INDONESIA_CENTER}
      zoom={5}
      className="h-[420px] w-full rounded-2xl md:h-[520px]"
      style={{ background: '#0f172a' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapClickCapture enabled={manualPinMode} onMapClick={onMapClick} />
      <FitRoute routeTo={routeTo} userPos={userPos} />
      {markers}
      {userPos && <Marker position={userPos} icon={userIcon} />}
      {userPos && routeTo && (
        <Polyline positions={[userPos, routeTo]} pathOptions={{ color: '#6366f1', weight: 3, dashArray: '8 8' }} />
      )}
    </MapContainer>
  )
}
