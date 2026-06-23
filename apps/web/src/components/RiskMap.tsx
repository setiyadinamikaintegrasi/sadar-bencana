// apps/web/src/components/RiskMap.tsx
import { useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, Marker } from 'react-leaflet'
import L from 'leaflet'
import type { Event } from '../lib/api/client'

const INDONESIA_CENTER: [number, number] = [-2.5, 118]

const LAYER_FILTERS = [
  { key: 'all', label: 'Semua' },
  { key: 'earthquake', label: 'Gempa' },
  { key: 'flood', label: 'Banjir' },
  { key: 'wind', label: 'Angin' },
] as const

function magnitudeColor(mag: number): string {
  if (mag >= 7) return '#dc2626'
  if (mag >= 6) return '#f97316'
  if (mag >= 5) return '#eab308'
  return '#22c55e'
}

function createPulseIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `<div style="position:relative;width:24px;height:24px;">
      <div style="position:absolute;inset:0;border-radius:9999px;background:${color};opacity:0.35;animation:rrm-ping 1.5s cubic-bezier(0,0,0.2,1) infinite;"></div>
      <div style="position:absolute;top:6px;left:6px;width:12px;height:12px;border-radius:9999px;background:${color};"></div>
    </div>`,
  })
}

interface RiskMapProps {
  events: Event[]
  activePerilFilter: string
  onFilterChange: (filter: string) => void
  onEventClick: (event: Event) => void
}

export default function RiskMap({
  events,
  activePerilFilter,
  onFilterChange,
  onEventClick,
}: RiskMapProps) {
  const visibleEvents = useMemo(() => {
    if (activePerilFilter === 'all') return events
    return events.filter((e) => {
      const type = (e.event_type ?? '').toLowerCase()
      if (activePerilFilter === 'earthquake') return type.includes('earthquake') || type.includes('quake')
      if (activePerilFilter === 'flood') return type.includes('flood')
      if (activePerilFilter === 'wind') return type.includes('wind') || type.includes('storm') || type.includes('cyclone')
      return false
    })
  }, [events, activePerilFilter])

  return (
    <div className="relative">
      {/* Layer toggle buttons — overlaid on map top-left */}
      <div className="absolute left-2 top-2 z-[400] flex flex-wrap gap-1">
        {LAYER_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => onFilterChange(f.key)}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
              activePerilFilter === f.key
                ? 'bg-indigo-500/30 text-indigo-200 ring-1 ring-inset ring-indigo-400/40'
                : 'bg-slate-900/80 text-slate-400 hover:text-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div
        className="overflow-hidden rounded-xl border border-slate-800"
        style={{ height: '380px' }}
      >
        <MapContainer
          center={INDONESIA_CENTER}
          zoom={4}
          scrollWheelZoom={false}
          zoomControl={false}
          attributionControl={false}
          style={{ height: '100%', width: '100%', background: '#0f172a' }}
        >
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />

          {visibleEvents.map((ev) => {
            const isCritical = ev.magnitude >= 6
            const color = magnitudeColor(ev.magnitude)

            const popupContent = (
              <Popup>
                <div style={{ minWidth: '160px' }}>
                  <strong>
                    M{ev.magnitude.toFixed(1)} — {ev.place}
                  </strong>
                  <br />
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                    {new Date(ev.event_time).toLocaleString('id-ID')}
                  </span>
                  <br />
                  <button
                    onClick={() => onEventClick(ev)}
                    style={{
                      marginTop: '8px',
                      color: '#818cf8',
                      cursor: 'pointer',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      fontSize: '12px',
                    }}
                  >
                    Lihat Berita →
                  </button>
                </div>
              </Popup>
            )

            if (isCritical) {
              return (
                <Marker
                  key={ev.event_id}
                  position={[ev.latitude, ev.longitude]}
                  icon={createPulseIcon(color)}
                >
                  {popupContent}
                </Marker>
              )
            }

            return (
              <CircleMarker
                key={ev.event_id}
                center={[ev.latitude, ev.longitude]}
                radius={3 + ev.magnitude * 1.2}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: 0.65,
                  weight: 1,
                }}
              >
                {popupContent}
              </CircleMarker>
            )
          })}
        </MapContainer>
      </div>
    </div>
  )
}
