import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import { getEvents, type Event } from '../../lib/api/client'
import { getVessels, getAircraft, type Vessel, type Aircraft } from '../../lib/api/assets'

// --- helpers --------------------------------------------------------------

function magnitudeColor(mag: number): string {
  if (mag >= 7) return '#dc2626' // red-600
  if (mag >= 6) return '#f97316' // orange-500
  if (mag >= 5) return '#eab308' // yellow-500
  return '#22c55e' // green-500
}

function sourceColor(src: string): string {
  if (src.includes('bmkg')) return '#ef4444'
  if (src.includes('usgs')) return '#3b82f6'
  if (src.includes('seed')) return '#a78bfa'
  return '#64748b'
}

// Component to recenter map when needed
function Recenter({ center }: { center: [number, number] }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center, 5)
  }, [map, center[0], center[1]])
  return null
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
        <div className="flex gap-4">
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
        <div style={{ height: '600px', width: '100%' }}>
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
                  <CircleMarker
                    key={ev.event_id}
                    center={[ev.latitude, ev.longitude]}
                    radius={4 + ev.magnitude * 1.5}
                    pathOptions={{
                      color: magnitudeColor(ev.magnitude),
                      fillColor: magnitudeColor(ev.magnitude),
                      fillOpacity: 0.6,
                    }}
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
                  </CircleMarker>
                ))}

              {/* Vessels (M9) */}
              {activeLayers.has('vessels') &&
                vessels.map((v) => (
                  <CircleMarker
                    key={`v-${v.mmsi}`}
                    center={[v.latitude, v.longitude]}
                    radius={4}
                    pathOptions={{ color: '#06b6d4', fillColor: '#06b6d4', fillOpacity: 0.8 }}
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
                  </CircleMarker>
                ))}

              {/* Aircraft (M9) */}
              {activeLayers.has('aircraft') &&
                aircraft.map((a) => (
                  <CircleMarker
                    key={`a-${a.icao24}`}
                    center={[a.latitude, a.longitude]}
                    radius={4}
                    pathOptions={{ color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.8 }}
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
                  </CircleMarker>
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
