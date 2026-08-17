import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { getOperationalMapEngine } from '../../config/mapEngine'
import MapLibreEvacuationMap from './MapLibreEvacuationMap'
import {
  EVACUATION_TYPE_META,
  type EvacuationBBox,
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

// ViewportWatcher melaporkan bbox + zoom peta ke parent — sekali saat siap dan
// setiap kali peta digeser/di-zoom — supaya marker dimuat per-viewport (bukan
// seluruh Indonesia sekaligus, yang bisa ribuan titik dan kena LIMIT server).
function ViewportWatcher({ onChange }: { onChange: (bbox: EvacuationBBox, zoom: number) => void }) {
  const cb = useRef(onChange)
  cb.current = onChange
  const emit = (map: L.Map) => {
    const b = map.getBounds()
    cb.current(
      { minLat: b.getSouth(), maxLat: b.getNorth(), minLon: b.getWest(), maxLon: b.getEast() },
      map.getZoom(),
    )
  }
  const map = useMapEvents({ moveend: () => emit(map) })
  useEffect(() => {
    emit(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])
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

export type EvacuationMapProps = {
  locations: EvacuationLocation[]
  userPos: [number, number] | null
  routeTo: [number, number] | null
  manualPinMode: boolean
  onMapClick: (lat: number, lon: number) => void
  onSelect: (loc: EvacuationLocation) => void
  onViewportChange: (bbox: EvacuationBBox, zoom: number) => void
}

export function LeafletEvacuationMap({
  locations, userPos, routeTo, manualPinMode, onMapClick, onSelect, onViewportChange,
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
      <ViewportWatcher onChange={onViewportChange} />
      <FitRoute routeTo={routeTo} userPos={userPos} />
      {markers}
      {userPos && <Marker position={userPos} icon={userIcon} />}
      {userPos && routeTo && (
        <Polyline positions={[userPos, routeTo]} pathOptions={{ color: '#6366f1', weight: 3, dashArray: '8 8' }} />
      )}
    </MapContainer>
  )
}

export default function EvacuationMap(props: EvacuationMapProps) {
  return getOperationalMapEngine() === 'maplibre'
    ? <MapLibreEvacuationMap {...props} />
    : <LeafletEvacuationMap {...props} />
}
