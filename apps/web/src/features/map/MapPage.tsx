import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import { getEvents, type Event } from '../../lib/api/client'
import { getVessels, getAircraft, type Vessel, type Aircraft } from '../../lib/api/assets'

// --- helpers --------------------------------------------------------------

const MAP_ANIMATION_CSS = `
  .event-dot {
    position: relative;
    border-radius: 50%;
    background: var(--color);
    opacity: 0.9;
  }
  .event-dot::before,
  .event-dot::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 100%;
    height: 100%;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    border: 2px solid var(--color);
    animation: ring-expand 2s ease-out infinite;
    pointer-events: none;
  }
  .event-dot::after { display: none; }
  .pulse-critical::before { animation-duration: 1.2s; }
  .pulse-critical::after  { display: block; animation-duration: 1.2s; animation-delay: 0.6s; }
  .pulse-high::before     { animation-duration: 2s; }
  .pulse-medium           { animation: breathe 3s ease-in-out infinite; }
  @keyframes ring-expand {
    0%   { transform: translate(-50%, -50%) scale(1);   opacity: 0.8; }
    100% { transform: translate(-50%, -50%) scale(3.5); opacity: 0;   }
  }
  @keyframes breathe {
    0%, 100% { transform: scale(1);   opacity: 0.85; }
    50%      { transform: scale(1.3); opacity: 0.5;  }
  }
  .vessel-moving { filter: drop-shadow(0 0 4px #06b6d4); }
  .vessel-anchor { opacity: 0.45; }
  .aircraft-airborne { animation: aircraft-pulse 4s ease-in-out infinite; }
  @keyframes aircraft-pulse {
    0%, 100% { opacity: 1;   transform: scale(1);    }
    50%      { opacity: 0.6; transform: scale(0.85); }
  }
  .stat-value { animation: count-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
  @keyframes count-pop {
    0%   { transform: scale(1.25); opacity: 0.4; }
    100% { transform: scale(1);    opacity: 1;   }
  }
  @keyframes countdown {
    from { transform: scaleX(1); }
    to   { transform: scaleX(0); }
  }
  .leaflet-popup-content-wrapper {
    background: #1e293b !important;
    color: #cbd5e1 !important;
    border: 1px solid #334155 !important;
    border-radius: 8px !important;
    box-shadow: 0 4px 24px rgba(0,0,0,0.6) !important;
  }
  .leaflet-popup-tip { background: #1e293b !important; }
  .leaflet-popup-content { margin: 10px 14px !important; }
`

function magnitudeColor(mag: number): string {
  if (mag >= 7) return '#dc2626' // red-600
  if (mag >= 6) return '#f97316' // orange-500
  if (mag >= 5) return '#eab308' // yellow-500
  return '#22c55e' // green-500
}

function createEventIcon(magnitude: number): L.DivIcon {
  const color = magnitudeColor(magnitude)
  const size = Math.round(6 + magnitude * 1.8)
  const pulseClass =
    magnitude >= 7 ? 'pulse-critical' :
    magnitude >= 6 ? 'pulse-high' :
    magnitude >= 5 ? 'pulse-medium' : ''
  const spread = size * 5
  return L.divIcon({
    className: '',
    iconSize: [spread, spread],
    iconAnchor: [spread / 2, spread / 2],
    html: `<div
      class="event-dot ${pulseClass}"
      style="--color:${color};width:${size}px;height:${size}px;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)"
    ></div>`,
  })
}

function createVesselIcon(vessel: Vessel): L.DivIcon {
  const rotation = vessel.cog ?? vessel.heading ?? 0
  const isMoving = (vessel.sog ?? 0) > 0.5

  if (isMoving) {
    return L.divIcon({
      className: '',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      html: `<div class="vessel-moving" style="width:24px;height:24px">
        <div style="transform:rotate(${rotation}deg);width:100%;height:100%">
          <svg viewBox="0 0 20 20" fill="#06b6d4" xmlns="http://www.w3.org/2000/svg" width="24" height="24">
            <polygon points="10,2 18,18 10,14 2,18"/>
          </svg>
        </div>
      </div>`,
    })
  }

  return L.divIcon({
    className: '',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html: `<div class="vessel-anchor" style="width:16px;height:16px;opacity:0.45">
      <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
        <circle cx="8" cy="4" r="2" stroke="#06b6d4" stroke-width="1.5" fill="none"/>
        <line x1="8" y1="6" x2="8" y2="13" stroke="#06b6d4" stroke-width="1.5"/>
        <line x1="3" y1="9" x2="13" y2="9" stroke="#06b6d4" stroke-width="1.5"/>
        <line x1="3" y1="13" x2="5" y2="11" stroke="#06b6d4" stroke-width="1.5"/>
        <line x1="13" y1="13" x2="11" y2="11" stroke="#06b6d4" stroke-width="1.5"/>
      </svg>
    </div>`,
  })
}

// --- main page ------------------------------------------------------------

const INDONESIA_CENTER: [number, number] = [-2.5, 118]

type LayerToggle = 'events' | 'vessels' | 'aircraft'

export default function MapPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [vessels, setVessels] = useState<Vessel[]>([])
  const [aircraft, setAircraft] = useState<Aircraft[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeLayers, setActiveLayers] = useState<Set<LayerToggle>>(new Set(['events']))

  useEffect(() => {
    const existing = document.getElementById('map-animations')
    if (existing) return
    const style = document.createElement('style')
    style.id = 'map-animations'
    style.textContent = MAP_ANIMATION_CSS
    document.head.appendChild(style)
    return () => {
      document.getElementById('map-animations')?.remove()
    }
  }, [])

  const toggleLayer = useCallback((layer: LayerToggle) => {
    setActiveLayers((prev) => {
      const next = new Set(prev)
      if (next.has(layer)) next.delete(layer)
      else next.add(layer)
      return next
    })
  }, [])

  const loadAll = useCallback(async () => {
    try {
      const [ev, vs, ac] = await Promise.allSettled([
        getEvents(),
        getVessels(),
        getAircraft(),
      ])
      if (ev.status === 'fulfilled') setEvents(ev.value)
      if (vs.status === 'fulfilled') setVessels(vs.value)
      if (ac.status === 'fulfilled') setAircraft(ac.value)
      if (ev.status === 'rejected') setError('Gagal memuat data gempa')
    } catch {
      setError('Gagal memuat data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
    const id = setInterval(loadAll, 60_000)
    return () => clearInterval(id)
  }, [loadAll])

  const stats = useMemo(() => {
    const critical = events.filter((e) => e.magnitude >= 6).length
    return {
      total: events.length,
      critical,
      vessels: vessels.length,
      aircraft: aircraft.length,
    }
  }, [events, vessels, aircraft])

  return (
    <div className="space-y-4">
      {/* Header + stats */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-semibold text-slate-100">Risk Map — Indonesia &amp; Sekitar</h3>
          <p className="mt-1 text-sm text-slate-400">
            Real-time seismic events, maritime traffic, dan flight tracking.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 md:gap-4">
          <Stat label='Gempa' value={stats.total} sub={`${stats.critical} M≥6`} color='text-red-400' />
          <Stat label='Kapal' value={stats.vessels} color='text-cyan-400' />
          <Stat label='Pesawat' value={stats.aircraft} color='text-amber-400' />
        </div>
      </div>

      {/* Layer toggles */}
      <div className="flex gap-3">
        {(['events', 'vessels', 'aircraft'] as LayerToggle[]).map((layer) => (
          <button
            key={layer}
            type='button'
            onClick={() => toggleLayer(layer)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              activeLayers.has(layer)
                ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-inset ring-indigo-400/40'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {layer === 'events' ? '🔴 Gempa' : layer === 'vessels' ? '⚓ Kapal' : '✈ Pesawat'}
          </button>
        ))}
      </div>

      {error && (
        <div className='rounded-lg border border-red-800 bg-red-900/30 px-4 py-2 text-sm text-red-300'>
          {error}
        </div>
      )}

      {/* Map */}
      <div className='overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-slate-950/40'>
        <div style={{ height: 'clamp(300px, 50vh, 600px)', width: '100%' }}>
          {loading ? (
            <div className='flex h-full items-center justify-center text-slate-400'>
              Loading map…
            </div>
          ) : (
            <MapContainer
              center={INDONESIA_CENTER}
              zoom={5}
              scrollWheelZoom
              style={{ height: '100%', width: '100%', background: '#0f172a' }}
            >
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url='https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
              />

              {/* Earthquake events */}
              {activeLayers.has('events') &&
                events.map((ev) => (
                  <Marker
                    key={ev.event_id}
                    position={[ev.latitude, ev.longitude]}
                    icon={createEventIcon(ev.magnitude)}
                  >
                    <Popup>
                      <div style={{ minWidth: '180px' }}>
                        <strong>M{ev.magnitude.toFixed(1)} — {ev.place}</strong>
                        <br />
                        <span>Sumber: {ev.source}</span>
                        <br />
                        <span>Waktu: {new Date(ev.event_time).toLocaleString('id-ID')}</span>
                        <br />
                        <span>Kedalaman tersedia di detail</span>
                      </div>
                    </Popup>
                  </Marker>
                ))}

              {/* Vessels */}
              {activeLayers.has('vessels') &&
                vessels.map((v) => (
                  <Marker
                    key={`v-${v.mmsi}`}
                    position={[v.latitude, v.longitude]}
                    icon={createVesselIcon(v)}
                  >
                    <Popup>
                      <div>
                        <strong>⚓ {v.name || v.mmsi}</strong>
                        <br />
                        {v.ship_type && <span>Tipe: {v.ship_type}</span>}
                        <br />
                        <span>SOG: {v.sog?.toFixed(1) ?? '?'} kn</span>
                        <br />
                        <span>Update: {new Date(v.timestamp).toLocaleTimeString('id-ID')}</span>
                      </div>
                    </Popup>
                  </Marker>
                ))}

              {/* Aircraft (M9) */}
              {activeLayers.has('aircraft') &&
                aircraft.map((a) => (
                  <Marker
                    key={`a-${a.icao24}`}
                    position={[a.latitude, a.longitude]}
                  >
                    <Popup>
                      <div>
                        <strong>✈ {a.callsign?.trim() || a.icao24}</strong>
                        <br />
                        <span>{a.origin_country}</span>
                        <br />
                        <span>Alt: {a.altitude != null ? `${a.altitude.toFixed(0)}m` : 'N/A'}</span>
                        <br />
                        <span>Vel: {a.velocity != null ? `${a.velocity.toFixed(0)} m/s` : 'N/A'}</span>
                      </div>
                    </Popup>
                  </Marker>
                ))}
            </MapContainer>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, color }: { label: string; value: number; sub?: string; color: string }) {
  return (
    <div className='rounded-xl border border-slate-800 bg-slate-900 px-4 py-2'>
      <p className='text-xs uppercase tracking-wider text-slate-500'>{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className='text-xs text-slate-500'>{sub}</p>}
    </div>
  )
}
