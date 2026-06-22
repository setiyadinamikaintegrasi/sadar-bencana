import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { getEvents, getNews, type Event, type NewsItem } from '../../lib/api/client'
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
  .peril-marker {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .peril-marker::before,
  .peril-marker::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 100%;
    height: 100%;
    transform: translate(-50%, -50%);
    border-radius: 9999px;
    border: 2px solid var(--color);
    animation: ring-expand 2s ease-out infinite;
    pointer-events: none;
  }
  .peril-marker::after { display: none; }
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
  .stat-value { animation: count-pop 0.35s cubic-bezier(0.22, 1, 0.36, 1); }
  @keyframes count-pop {
    0%   { transform: scale(1.15); opacity: 0.5; }
    100% { transform: scale(1);    opacity: 1;   }
  }
  @keyframes countdown {
    from { transform: scaleX(1); }
    to   { transform: scaleX(0); }
  }
  @keyframes corroborate-ring {
    0%, 100% { box-shadow: 0 0 0 2px rgba(255,255,255,0.9), 0 0 8px rgba(255,255,255,0.4); }
    50%       { box-shadow: 0 0 0 3px rgba(255,255,255,0.6), 0 0 14px rgba(255,255,255,0.2); }
  }
  .news-corroborated { animation: corroborate-ring 2s ease-in-out infinite; }
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

function createEventIcon(magnitude: number, corroborated = false): L.DivIcon {
  const color = magnitudeColor(magnitude)
  const size = Math.round(6 + magnitude * 1.8)
  const pulseClass =
    magnitude >= 7 ? 'pulse-critical' :
    magnitude >= 6 ? 'pulse-high' :
    magnitude >= 5 ? 'pulse-medium' : ''
  const spread = size * 5
  const corrClass = corroborated ? ' news-corroborated' : ''
  return L.divIcon({
    className: '',
    iconSize: [spread, spread],
    iconAnchor: [spread / 2, spread / 2],
    html: `<div
      class="event-dot ${pulseClass}${corrClass}"
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

function createAircraftIcon(aircraft: Aircraft): L.DivIcon {
  const rotation = aircraft.heading ?? 0
  const isAirborne = !aircraft.on_ground && (aircraft.altitude ?? 0) > 0
  const color = isAirborne ? '#f59e0b' : '#94a3b8'
  const opacity = isAirborne ? '1' : '0.5'
  const animClass = isAirborne ? 'aircraft-airborne' : ''

  return L.divIcon({
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<div class="${animClass}" style="width:20px;height:20px;opacity:${opacity}">
      <div style="transform:rotate(${rotation}deg);width:100%;height:100%">
        <svg viewBox="0 0 18 18" fill="${color}" xmlns="http://www.w3.org/2000/svg" width="20" height="20">
          <path d="M9,1 L11,7 L17,8 L11,11 L12,17 L9,15 L6,17 L7,11 L1,8 L7,7 Z"/>
        </svg>
      </div>
    </div>`,
  })
}

function MapController({ events }: { events: Event[] }) {
  const map = useMap()
  const hasFlown = useRef(false)

  useEffect(() => {
    if (events.length === 0 || hasFlown.current) return
    const lats = events.map((e) => e.latitude)
    const lngs = events.map((e) => e.longitude)
    const bounds: L.LatLngBoundsExpression = [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ]
    map.flyToBounds(bounds, { padding: [40, 40], animate: true, duration: 1.5, maxZoom: 7 })
    hasFlown.current = true
  }, [events.length]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

// --- main page ------------------------------------------------------------

const INDONESIA_CENTER: [number, number] = [-2.5, 118]

type LayerToggle = 'events' | 'vessels' | 'aircraft' | 'flood' | 'volcano' | 'wildfire' | 'news_locations'

function createFloodIcon(magnitude: number): L.DivIcon {
  const pulseClass = magnitude >= 3 ? 'pulse-high' : magnitude >= 1 ? 'pulse-medium' : ''
  return L.divIcon({
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `<div class="peril-marker ${pulseClass}" style="--color:#3b82f6;width:24px;height:24px">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">
        <path d="M12 2C9.5 5.2 6 9 6 13a6 6 0 1012 0c0-4-3.5-7.8-6-11z" fill="#3b82f6" fill-opacity="0.9"/>
      </svg>
    </div>`,
  })
}

function createVolcanoIcon(magnitude: number): L.DivIcon {
  const color = magnitude >= 2 ? '#ef4444' : '#6b7280'
  const pulseClass =
    magnitude >= 4 ? 'pulse-critical' :
    magnitude >= 3 ? 'pulse-high' :
    magnitude >= 2 ? 'pulse-medium' : ''
  return L.divIcon({
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `<div class="peril-marker ${pulseClass}" style="--color:${color};width:24px;height:24px">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">
        <path d="M4 20L10 8h4l6 12H4z" fill="${color}" fill-opacity="0.9"/>
        <circle cx="12" cy="6" r="2" fill="#f97316" fill-opacity="0.95"/>
      </svg>
    </div>`,
  })
}

function createWildfireIcon(magnitude: number): L.DivIcon {
  const pulseClass =
    magnitude >= 7 ? 'pulse-critical' :
    magnitude >= 4 ? 'pulse-high' :
    magnitude >= 2 ? 'pulse-medium' : ''
  const opacity = magnitude < 2 ? '0.5' : '0.95'
  return L.divIcon({
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `<div class="peril-marker ${pulseClass}" style="--color:#f97316;width:24px;height:24px;opacity:${opacity}">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">
        <path d="M13 2c1 3-1 4 0 6 1 1 3 2 3 5a4 4 0 11-8 0c0-2 1-3 2-4 1-1 2-2 3-7z" fill="#f97316" fill-opacity="0.95"/>
      </svg>
    </div>`,
  })
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function createNewsIcon(item: NewsItem): L.DivIcon {
  const emoji = item.perils[0] === 'earthquake' ? '🔴'
    : item.perils[0] === 'flood' ? '🌊'
    : item.perils[0] === 'volcano' ? '🌋'
    : item.perils[0] === 'wildfire' ? '🔥'
    : item.perils[0] === 'fire' ? '🔥' : '📰'
  return L.divIcon({
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<div style="width:20px;height:20px;border-radius:4px;background:#1e293b;
                       border:1px solid #475569;display:flex;align-items:center;
                       justify-content:center;font-size:11px;
                       box-shadow:0 1px 4px rgba(0,0,0,0.6)">${emoji}</div>`,
  })
}

export default function MapPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [vessels, setVessels] = useState<Vessel[]>([])
  const [aircraft, setAircraft] = useState<Aircraft[]>([])
  const [news, setNews] = useState<NewsItem[]>([])
  const [showNews, setShowNews] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeLayers, setActiveLayers] = useState<Set<LayerToggle>>(new Set(['events']))
  const [refreshKey, setRefreshKey] = useState(0)

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
    setRefreshKey((k) => k + 1)
    try {
      const [ev, vs, ac, nw] = await Promise.allSettled([
        getEvents(),
        getVessels(),
        getAircraft(),
        getNews(),
      ])
      if (ev.status === 'fulfilled') setEvents(ev.value)
      if (vs.status === 'fulfilled') setVessels(vs.value)
      if (ac.status === 'fulfilled') setAircraft(ac.value)
      if (nw.status === 'fulfilled') setNews(nw.value)
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

  const earthquakeEvents = useMemo(() => events.filter((e) => e.event_type === 'earthquake'), [events])
  const floodEvents = useMemo(() => events.filter((e) => e.event_type === 'flood'), [events])
  const volcanoEvents = useMemo(() => events.filter((e) => e.event_type === 'volcano'), [events])
  const wildfireEvents = useMemo(() => events.filter((e) => e.event_type === 'wildfire'), [events])
  const filteredNews = useMemo(() => {
    const activePerils = new Set<string>()
    if (activeLayers.has('events')) activePerils.add('earthquake')
    if (activeLayers.has('flood')) activePerils.add('flood')
    if (activeLayers.has('volcano')) activePerils.add('volcano')
    if (activeLayers.has('wildfire')) activePerils.add('wildfire')
    if (activeLayers.has('wildfire') || activeLayers.has('news_locations')) activePerils.add('fire')
    if (activePerils.size === 0) return []

    const filtered = news.filter((n) => n.perils.some((p) => activePerils.has(p)))
    return filtered.slice(0, 30)
  }, [news, activeLayers])

  const geolocatedNews = useMemo(
    () => news.filter((n) => n.lat != null && n.lon != null),
    [news]
  )

  const correlatedEventIds = useMemo(() => {
    const ids = new Set<string>()
    for (const n of geolocatedNews) {
      for (const e of events) {
        if (n.perils.includes(e.event_type) &&
            haversineKm(n.lat!, n.lon!, e.latitude, e.longitude) < 50) {
          ids.add(e.event_id)
        }
      }
    }
    return ids
  }, [geolocatedNews, events])

  const stats = useMemo(() => {
    const critical = earthquakeEvents.filter((e) => e.magnitude >= 6).length
    return {
      total: earthquakeEvents.length,
      critical,
      vessels: vessels.length,
      aircraft: aircraft.length,
      floods: floodEvents.length,
      volcanoes: volcanoEvents.length,
      wildfires: wildfireEvents.length,
    }
  }, [earthquakeEvents, vessels, aircraft, floodEvents, volcanoEvents, wildfireEvents])

  return (
    <div className="space-y-4">
      {/* Header + stats */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-semibold text-slate-100">Risk Map — Indonesia &amp; Sekitar</h3>
          <p className="mt-1 text-sm text-slate-400">
            Real-time seismic events, flood, volcano, wildfire, maritime traffic, dan flight tracking.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 md:gap-4">
          <Stat label='Gempa' value={stats.total} sub={`${stats.critical} M≥6`} color='text-red-400' />
          <Stat label='Banjir' value={stats.floods} color='text-blue-400' />
          <Stat label='Gunung Api' value={stats.volcanoes} color='text-rose-400' />
          <Stat label='Kebakaran' value={stats.wildfires} color='text-orange-400' />
          <Stat label='Kapal' value={stats.vessels} color='text-cyan-400' />
          <Stat label='Pesawat' value={stats.aircraft} color='text-amber-400' />
        </div>
      </div>

      {/* Layer toggles */}
      <div className="flex flex-wrap gap-3">
        {(['events', 'flood', 'volcano', 'wildfire', 'vessels', 'aircraft', 'news_locations'] as LayerToggle[]).map((layer) => (
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
            {layer === 'events' ? '🔴 Gempa' :
              layer === 'flood' ? '🌊 Banjir' :
              layer === 'volcano' ? '🌋 Gunung Api' :
              layer === 'wildfire' ? '🔥 Kebakaran' :
              layer === 'vessels' ? '⚓ Kapal' : 
              layer === 'news_locations' ? '📍 Berita Lokasi' : 
              '✈ Pesawat'}
          </button>
        ))}
        <button
          type='button'
          onClick={() => setShowNews((v) => !v)}
          className={`ml-auto rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            showNews
              ? 'bg-slate-700 text-slate-100 ring-1 ring-inset ring-slate-500'
              : 'bg-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          {`📰 Berita${news.length > 0 ? ` (${news.length})` : ''}`}
        </button>
      </div>

      {error && (
        <div className='rounded-lg border border-red-800 bg-red-900/30 px-4 py-2 text-sm text-red-300'>
          {error}
        </div>
      )}

      {/* Map */}
      <div className='overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-slate-950/40'>
        <div style={{ display: 'flex', height: 'clamp(300px, 50vh, 600px)', position: 'relative' }}>
          <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
            {/* Countdown bar */}
            <div
              key={refreshKey}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '2px',
                background: '#4f46e5',
                transformOrigin: 'left',
                animation: 'countdown 60s linear forwards',
                zIndex: 1000,
                pointerEvents: 'none',
              }}
            />
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
                <MapController events={events} />
                <TileLayer
                  attribution='&copy; OpenStreetMap contributors'
                  url='https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                />

              {/* Earthquake events */}
              {activeLayers.has('events') &&
                earthquakeEvents.map((ev) => (
                  <Marker
                    key={ev.event_id}
                    position={[ev.latitude, ev.longitude]}
                    icon={createEventIcon(ev.magnitude, correlatedEventIds.has(ev.event_id))}
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

              {/* Flood events */}
              {activeLayers.has('flood') &&
                floodEvents.map((ev) => (
                  <Marker
                    key={ev.event_id}
                    position={[ev.latitude, ev.longitude]}
                    icon={createFloodIcon(ev.magnitude)}
                  >
                    <Popup>
                      <div style={{ minWidth: '180px' }}>
                        <strong>🌊 {ev.place}</strong>
                        <br />
                        <span>Severity proxy: {ev.magnitude.toFixed(1)}</span>
                        <br />
                        <span>Sumber: {ev.source}</span>
                        <br />
                        <span>Waktu: {new Date(ev.event_time).toLocaleString('id-ID')}</span>
                      </div>
                    </Popup>
                  </Marker>
                ))}

              {/* Volcano events */}
              {activeLayers.has('volcano') &&
                volcanoEvents.map((ev) => (
                  <Marker
                    key={ev.event_id}
                    position={[ev.latitude, ev.longitude]}
                    icon={createVolcanoIcon(ev.magnitude)}
                  >
                    <Popup>
                      <div style={{ minWidth: '180px' }}>
                        <strong>🌋 {ev.place}</strong>
                        <br />
                        <span>Status proxy: {ev.magnitude.toFixed(1)}</span>
                        <br />
                        <span>Sumber: {ev.source}</span>
                        <br />
                        <span>Waktu: {new Date(ev.event_time).toLocaleString('id-ID')}</span>
                      </div>
                    </Popup>
                  </Marker>
                ))}

              {/* Wildfire events */}
              {activeLayers.has('wildfire') &&
                wildfireEvents.map((ev) => (
                  <Marker
                    key={ev.event_id}
                    position={[ev.latitude, ev.longitude]}
                    icon={createWildfireIcon(ev.magnitude)}
                  >
                    <Popup>
                      <div style={{ minWidth: '180px' }}>
                        <strong>🔥 {ev.place}</strong>
                        <br />
                        <span>FRP proxy: {ev.magnitude.toFixed(1)}</span>
                        <br />
                        <span>Sumber: {ev.source}</span>
                        <br />
                        <span>Waktu: {new Date(ev.event_time).toLocaleString('id-ID')}</span>
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

                {/* Aircraft */}
                {activeLayers.has('aircraft') &&
                  aircraft.map((a) => (
                    <Marker
                      key={`a-${a.icao24}`}
                      position={[a.latitude, a.longitude]}
                      icon={createAircraftIcon(a)}
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
                {/* News markers */}
                {activeLayers.has('news_locations') &&
                  geolocatedNews.map((n) => (
                    <Marker
                      key={`news-${n.id}`}
                      position={[n.lat!, n.lon!]}
                      icon={createNewsIcon(n)}
                    >
                      <Popup>
                        <div style={{ minWidth: '200px' }}>
                          <div style={{ marginBottom: '6px' }}>
                            <strong style={{ color: '#818cf8' }}>{n.source.toUpperCase()}</strong>
                            {n.perils.map(p => (
                              <span key={p} style={{ marginLeft: '4px' }}>
                                {p === 'earthquake' ? '🔴' : p === 'flood' ? '🌊' : p === 'volcano' ? '🌋' : '🔥'}
                              </span>
                            ))}
                          </div>
                          <p style={{ fontSize: '13px', margin: '0 0 6px' }}>{n.title}</p>
                          <p style={{ fontSize: '11px', color: '#94a3b8', margin: '0 0 4px' }}>
                            {n.place_name} · {n.published_at ? new Date(n.published_at).toLocaleString('id-ID') : ''}
                          </p>
                          <a href={n.url} target="_blank" rel="noopener noreferrer"
                             style={{ fontSize: '11px', color: '#6366f1' }}>Baca selengkapnya →</a>
                        </div>
                      </Popup>
                    </Marker>
                  ))}
              </MapContainer>
            )}
          </div>

          {showNews && (
            <aside className='w-[360px] shrink-0 border-l border-slate-800 bg-slate-950/80'>
              <div className='flex items-center justify-between border-b border-slate-800 px-4 py-3'>
                <div>
                  <h3 className='text-sm font-semibold text-slate-100'>Berita Terkait Hazard</h3>
                  <p className='text-xs text-slate-400'>Filter mengikuti layer hazard yang aktif</p>
                </div>
                <span className='rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300'>
                  {filteredNews.length}
                </span>
              </div>

              <div className='max-h-full overflow-y-auto p-3'>
                {filteredNews.length === 0 ? (
                  <div className='rounded-xl border border-slate-800 bg-slate-900 px-4 py-6 text-sm text-slate-400'>
                    Tidak ada berita yang cocok dengan layer hazard aktif.
                  </div>
                ) : (
                  <div className='space-y-3'>
                    {filteredNews.map((item) => (
                      <a
                        key={item.id}
                        href={item.url}
                        target='_blank'
                        rel='noreferrer'
                        className='block rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 transition hover:border-slate-700 hover:bg-slate-900/80'
                      >
                        <div className='mb-2 flex items-center gap-2 text-[11px] text-slate-500'>
                          <span>{item.source}</span>
                          <span>•</span>
                          <span>
                            {new Date(item.published_at ?? item.created_at).toLocaleString('id-ID')}
                          </span>
                        </div>
                        <h4 className='line-clamp-2 text-sm font-semibold text-slate-100'>
                          {item.title}
                        </h4>
                        <p className='mt-2 line-clamp-3 text-xs leading-5 text-slate-400'>
                          {item.summary}
                        </p>
                        {item.perils.length > 0 && (
                          <div className='mt-3 flex flex-wrap gap-2'>
                            {item.perils.map((peril) => (
                              <span
                                key={`${item.id}-${peril}`}
                                className='rounded-full bg-slate-800 px-2 py-1 text-[11px] text-slate-300'
                              >
                                {peril}
                              </span>
                            ))}
                          </div>
                        )}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, color }: { label: string; value: number; sub?: string; color: string }) {
  return (
    <div className='rounded-xl border border-slate-800 bg-slate-900 px-4 py-2'>
      <p className='text-[11px] font-medium text-slate-500'>{label}</p>
      <p className={`text-2xl font-bold ${color}`}>
        <span key={value} className='stat-value inline-block'>{value}</span>
      </p>
      {sub && (
        <p className='text-xs text-slate-500'>
          <span key={sub} className='stat-value inline-block'>{sub}</span>
        </p>
      )}
    </div>
  )
}
