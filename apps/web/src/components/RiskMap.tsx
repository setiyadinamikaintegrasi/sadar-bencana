// apps/web/src/components/RiskMap.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Circle, MapContainer, Marker, Polygon, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { Event, MapOverlay, NewsItem } from '../lib/api/client'

const INDONESIA_CENTER: [number, number] = [-2.5, 118]

type PerilFilter = 'all' | 'earthquake' | 'wildfire' | 'volcano' | 'flood' | 'news'

const LAYER_FILTERS: Array<{ key: PerilFilter; label: string; icon: string; accent: string }> = [
  { key: 'all', label: 'Semua', icon: '◎', accent: 'text-indigo-200' },
  { key: 'earthquake', label: 'Gempa', icon: '●', accent: 'text-orange-300' },
  { key: 'wildfire', label: 'Karhutla', icon: '◆', accent: 'text-rose-300' },
  { key: 'volcano', label: 'Vulkanik', icon: '▲', accent: 'text-red-300' },
  { key: 'flood', label: 'Banjir', icon: '◒', accent: 'text-sky-300' },
  { key: 'news', label: 'News', icon: '✦', accent: 'text-emerald-300' },
]

const MAP_ANIMATION_CSS = `
  .risk-exec-marker {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
  }
  .risk-exec-marker::before,
  .risk-exec-marker::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 9999px;
    border: 2px solid var(--color);
    animation: risk-exec-ring 2.2s ease-out infinite;
    pointer-events: none;
  }
  .risk-exec-marker::after {
    animation-delay: 0.7s;
    display: var(--second-ring, none);
  }
  .risk-exec-marker__core {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    border: 1px solid rgba(255,255,255,0.45);
    background: var(--color);
    color: white;
    font-size: 10px;
    font-weight: 800;
    line-height: 1;
    box-shadow: 0 8px 24px rgba(0,0,0,0.45);
  }
  .risk-news-pin {
    border-radius: 8px;
    background: #0f172a;
    border: 1px solid rgba(16,185,129,0.65);
    color: #6ee7b7;
    box-shadow: 0 8px 22px rgba(0,0,0,0.45), 0 0 18px rgba(16,185,129,0.22);
  }
  @keyframes risk-exec-ring {
    0% { transform: scale(1); opacity: 0.68; }
    100% { transform: scale(2.7); opacity: 0; }
  }
  .risk-exec-map .leaflet-popup-content-wrapper {
    background: #0f172a !important;
    color: #cbd5e1 !important;
    border: 1px solid #334155 !important;
    border-radius: 12px !important;
    box-shadow: 0 20px 45px rgba(0,0,0,0.55) !important;
  }
  .risk-exec-map .leaflet-popup-tip { background: #0f172a !important; }
  .risk-exec-map .leaflet-popup-content { margin: 12px 14px !important; }
`

function eventColor(event: Event): string {
  const type = (event.event_type ?? '').toLowerCase()
  if (type.includes('wildfire') || type.includes('fire')) return '#f97316'
  if (type.includes('volcano')) return '#ef4444'
  if (type.includes('flood')) return '#38bdf8'
  if (event.magnitude >= 7) return '#dc2626'
  if (event.magnitude >= 6) return '#f97316'
  if (event.magnitude >= 5) return '#eab308'
  return '#22c55e'
}

function eventGlyph(event: Event): string {
  const type = (event.event_type ?? '').toLowerCase()
  if (type.includes('wildfire') || type.includes('fire')) return 'F'
  if (type.includes('volcano')) return 'V'
  if (type.includes('flood')) return 'B'
  if (type.includes('earthquake') || type.includes('quake')) return 'M'
  return 'R'
}

function eventLabel(eventType: string | null | undefined): string {
  const type = (eventType ?? '').toLowerCase()
  if (type.includes('wildfire')) return 'Karhutla'
  if (type.includes('fire')) return 'Kebakaran'
  if (type.includes('volcano')) return 'Vulkanik'
  if (type.includes('flood')) return 'Banjir'
  if (type.includes('earthquake') || type.includes('quake')) return 'Gempa'
  return eventType || 'Risk event'
}

function eventMatchesFilter(event: Event, filter: PerilFilter): boolean {
  if (filter === 'all') return true
  const type = (event.event_type ?? '').toLowerCase()
  if (filter === 'earthquake') return type.includes('earthquake') || type.includes('quake')
  if (filter === 'wildfire') return type.includes('wildfire') || type.includes('fire')
  if (filter === 'volcano') return type.includes('volcano')
  if (filter === 'flood') return type.includes('flood')
  return false
}

function pointInRing(latitude: number, longitude: number, ring: [number, number][]): boolean {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [latA, lonA] = ring[index]
    const [latB, lonB] = ring[previous]
    const crosses = (lonA > longitude) !== (lonB > longitude)
      && latitude < ((latB - latA) * (longitude - lonA)) / (lonB - lonA || Number.EPSILON) + latA
    if (crosses) inside = !inside
  }
  return inside
}

function createEventIcon(event: Event, selected: boolean): L.DivIcon {
  const color = eventColor(event)
  const critical = event.magnitude >= 6 || ['wildfire', 'volcano', 'flood'].includes((event.event_type ?? '').toLowerCase())
  const size = selected ? 34 : Math.max(22, Math.min(32, Math.round(16 + event.magnitude * 2)))
  const spread = size * 3
  return L.divIcon({
    className: '',
    iconSize: [spread, spread],
    iconAnchor: [spread / 2, spread / 2],
    html: `<div class="risk-exec-marker" style="--color:${color};--second-ring:${critical || selected ? 'block' : 'none'};width:${size}px;height:${size}px;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)">
      <div class="risk-exec-marker__core" style="width:${size}px;height:${size}px;${selected ? 'outline:2px solid #c4b5fd;outline-offset:3px;' : ''}">${eventGlyph(event)}</div>
    </div>`,
  })
}

function createNewsIcon(item: NewsItem): L.DivIcon {
  const glyph = item.perils.includes('flood') ? '🌊'
    : item.perils.includes('volcano') ? '🌋'
    : item.perils.includes('wildfire') || item.perils.includes('fire') ? '🔥'
    : item.perils.includes('earthquake') ? '●'
    : '📰'
  return L.divIcon({
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `<div class="risk-news-pin" style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:12px">${glyph}</div>`,
  })
}

function MiniMapController({ events, selectedEvent }: { events: Event[]; selectedEvent?: Event | null }) {
  const map = useMap()
  const hasInitialFit = useRef(false)

  // --- Scroll-zoom conditional: enable saat map focused, disable saat blur ---
  useEffect(() => {
    const container = map.getContainer()

    const enableZoom = () => {
      map.scrollWheelZoom.enable()
      container.classList.add('risk-map-active')
      container.classList.remove('risk-map-inactive')
    }
    const disableZoom = () => {
      map.scrollWheelZoom.disable()
      container.classList.remove('risk-map-active')
      container.classList.add('risk-map-inactive')
    }

    // Init state: inactive
    disableZoom()

    container.addEventListener('mousedown', enableZoom)
    container.addEventListener('focus', enableZoom)
    container.addEventListener('mouseleave', disableZoom)
    container.addEventListener('blur', disableZoom)

    return () => {
      container.removeEventListener('mousedown', enableZoom)
      container.removeEventListener('focus', enableZoom)
      container.removeEventListener('mouseleave', disableZoom)
      container.removeEventListener('blur', disableZoom)
    }
  }, [map])

  useEffect(() => {
    if (selectedEvent) {
      map.flyTo([selectedEvent.latitude, selectedEvent.longitude], 7, { animate: true, duration: 0.8 })
      return
    }
    if (hasInitialFit.current || events.length === 0) return
    hasInitialFit.current = true

    // Batasi initial view ke Indonesia — tidak zoom out ke seluruh dunia
    const inaEvents = events.filter(
      (e) => e.latitude > -12 && e.latitude < 7 && e.longitude > 94 && e.longitude < 142,
    )
    const pool = inaEvents.length >= 5 ? inaEvents : events
    const lats = pool.map((e) => e.latitude)
    const lngs = pool.map((e) => e.longitude)
    const bounds: L.LatLngBoundsExpression = [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ]
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 5 })
  }, [events, map, selectedEvent])

  return null
}

interface RiskMapProps {
  events: Event[]
  news?: NewsItem[]
  overlays?: MapOverlay[]
  activePerilFilter: string
  onFilterChange: (filter: string) => void
  onEventClick: (event: Event) => void
  selectedEvent?: Event | null
  height?: number | string
}

export default function RiskMap({
  events,
  news = [],
  overlays = [],
  activePerilFilter,
  onFilterChange,
  onEventClick,
  selectedEvent,
  height = 430,
}: RiskMapProps) {
  const [timelineHoursAgo, setTimelineHoursAgo] = useState(0)
  const [visibleOverlayClasses, setVisibleOverlayClasses] = useState(
    new Set(['official', 'static_risk', 'watch_zone']),
  )
  useEffect(() => {
    if (document.getElementById('risk-exec-map-css')) return
    const style = document.createElement('style')
    style.id = 'risk-exec-map-css'
    style.textContent = MAP_ANIMATION_CSS
    document.head.appendChild(style)
  }, [])

  const currentFilter = LAYER_FILTERS.some((filter) => filter.key === activePerilFilter)
    ? (activePerilFilter as PerilFilter)
    : 'all'

  const counts = useMemo(() => {
    const countFor = (filter: PerilFilter) => events.filter((event) => eventMatchesFilter(event, filter)).length
    return {
      all: events.length,
      earthquake: countFor('earthquake'),
      wildfire: countFor('wildfire'),
      volcano: countFor('volcano'),
      flood: countFor('flood'),
      news: news.filter((item) => item.lat != null && item.lon != null).length,
    }
  }, [events, news])

  const visibleEvents = useMemo(() => {
    if (currentFilter === 'news') return []
    return events
      .filter((event) => eventMatchesFilter(event, currentFilter))
      .sort((a, b) => b.magnitude - a.magnitude)
      .slice(0, 220)
  }, [events, currentFilter])

  const visibleNews = useMemo(
    () => news.filter((item) => item.lat != null && item.lon != null).slice(0, currentFilter === 'news' ? 60 : 20),
    [news, currentFilter],
  )

  const focusEvent = selectedEvent ?? visibleEvents[0] ?? events[0]
  const timelineAt = Date.now() - timelineHoursAgo * 60 * 60 * 1000
  const visibleOverlays = overlays.filter((overlay) => {
    if (!visibleOverlayClasses.has(overlay.layer_class)) return false
    if (overlay.layer_class !== 'official') return true
    const effective = overlay.effective_at ? new Date(overlay.effective_at).getTime() : 0
    const expires = overlay.expires_at ? new Date(overlay.expires_at).getTime() : Number.POSITIVE_INFINITY
    return effective <= timelineAt && expires >= timelineAt
  })

  const toggleOverlayClass = (layerClass: string) => {
    setVisibleOverlayClasses((current) => {
      const next = new Set(current)
      if (next.has(layerClass)) next.delete(layerClass)
      else next.add(layerClass)
      return next
    })
  }

  const overlayPolygons = (overlay: MapOverlay): [number, number][][] => {
    if (!overlay.geometry) return []
    if (overlay.geometry.type === 'Polygon') {
      const rings = overlay.geometry.coordinates as number[][][]
      return [rings[0].map(([lon, lat]) => [lat, lon])]
    }
    const polygons = overlay.geometry.coordinates as number[][][][]
    return polygons.map((polygon) => polygon[0].map(([lon, lat]) => [lat, lon]))
  }
  const officialPolygons = visibleOverlays
    .filter((overlay) => overlay.layer_class === 'official')
    .flatMap(overlayPolygons)
  const intersectingWatchZones = new Set(
    visibleOverlays
      .filter((overlay) => overlay.layer_class === 'watch_zone' && overlay.latitude != null && overlay.longitude != null)
      .filter((overlay) => officialPolygons.some((ring) => pointInRing(overlay.latitude!, overlay.longitude!, ring)))
      .map((overlay) => overlay.id),
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {LAYER_FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => onFilterChange(filter.key)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold transition ${
              currentFilter === filter.key
                ? 'bg-indigo-500/20 text-indigo-100 ring-1 ring-inset ring-indigo-400/40'
                : 'bg-slate-950/70 text-slate-400 hover:bg-slate-800 hover:text-slate-100'
            }`}
          >
            <span className={filter.accent}>{filter.icon}</span>
            {filter.label}
            <span className="rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-500">
              {counts[filter.key]}
            </span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
        {[
          ['official', 'Warning resmi'],
          ['static_risk', 'Kajian risiko'],
          ['watch_zone', 'Watch zone'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={visibleOverlayClasses.has(key)}
            onClick={() => toggleOverlayClass(key)}
            className={`rounded-lg border px-2 py-1 ${
              visibleOverlayClasses.has(key)
                ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-100'
                : 'border-slate-700 text-slate-500'
            }`}
          >
            {label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2">
          Waktu: {timelineHoursAgo === 0 ? 'sekarang' : `${timelineHoursAgo} jam lalu`}
          <input
            aria-label="Waktu lifecycle peta"
            type="range"
            min="0"
            max="72"
            value={timelineHoursAgo}
            onChange={(event) => setTimelineHoursAgo(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="risk-exec-map relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
        <div className="pointer-events-none absolute left-3 top-3 z-[500] max-w-[70%] rounded-xl border border-slate-700/80 bg-slate-950/85 px-3 py-2 shadow-2xl shadow-slate-950/50 backdrop-blur">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Map Focus</p>
          <p className="mt-1 line-clamp-1 text-xs font-semibold text-slate-100">
            {focusEvent ? `${eventLabel(focusEvent.event_type)} · ${focusEvent.place}` : 'Menunggu data peta'}
          </p>
          <p className="mt-1 text-[10px] text-slate-500">
            Events {visibleEvents.length} · News pins {visibleNews.length}
          </p>
        </div>

        <div className="pointer-events-none absolute bottom-3 left-3 z-[500] flex flex-wrap gap-2 rounded-xl border border-slate-700/80 bg-slate-950/85 px-3 py-2 text-[10px] text-slate-400 shadow-2xl shadow-slate-950/50 backdrop-blur">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-500" /> Gempa</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-400" /> Banjir</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> Vulkanik</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-400" /> Karhutla</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-emerald-400" /> News</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 bg-fuchsia-400" /> Official</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-400" /> Observed</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 bg-violet-400/50" /> Static / inferred</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 bg-slate-400" /> Unverified</span>
        </div>

        <div style={{ height: typeof height === 'number' ? `${height}px` : height }}>
          <MapContainer
            center={INDONESIA_CENTER}
            zoom={4}
            scrollWheelZoom={false}
            zoomControl
            doubleClickZoom
            touchZoom
            attributionControl={false}
            style={{ height: '100%', width: '100%', background: '#020617' }}
          >
            <MiniMapController events={visibleEvents.length > 0 ? visibleEvents : events} selectedEvent={selectedEvent} />
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />

            {visibleOverlays.flatMap((overlay) =>
              overlayPolygons(overlay).map((positions, index) => (
                <Polygon
                  key={`${overlay.id}-${index}`}
                  positions={positions}
                  pathOptions={{
                    color: overlay.layer_class === 'official' ? '#e879f9' : '#8b5cf6',
                    fillOpacity: overlay.layer_class === 'official' ? 0.24 : 0.1,
                    dashArray: overlay.layer_class === 'official' ? undefined : '6 5',
                  }}
                >
                  <Popup>
                    <strong>{overlay.label}</strong>
                    <br />
                    <span>{overlay.layer_class === 'official' ? 'Warning resmi' : 'Kajian risiko statis'}</span>
                    <br />
                    <span style={{ color: '#94a3b8', fontSize: '11px' }}>
                      {overlay.attribution ?? 'Sumber belum dicantumkan'}
                      {overlay.layer_class === 'static_risk'
                        ? ` · vintage ${overlay.data_vintage ?? 'tidak tersedia'}`
                        : ''}
                    </span>
                  </Popup>
                </Polygon>
              )),
            )}

            {visibleOverlays
              .filter((overlay) => overlay.layer_class === 'watch_zone' && overlay.latitude != null && overlay.longitude != null)
              .map((overlay) => (
                <Circle
                  key={overlay.id}
                  center={[overlay.latitude!, overlay.longitude!]}
                  radius={(overlay.radius_km ?? 0) * 1000}
                  pathOptions={{
                    color: intersectingWatchZones.has(overlay.id) ? '#fb7185' : '#22d3ee',
                    fillOpacity: intersectingWatchZones.has(overlay.id) ? 0.16 : 0.04,
                    dashArray: '4 6',
                  }}
                >
                  <Popup>
                    <strong>Watch zone · {overlay.label}</strong>
                    <br />
                    {intersectingWatchZones.has(overlay.id)
                      ? 'Beririsan dengan polygon warning pada waktu terpilih.'
                      : 'Tidak ada irisan warning pada waktu terpilih.'}
                  </Popup>
                </Circle>
              ))}

            {visibleEvents.map((ev) => (
              <Marker
                key={ev.event_id}
                position={[ev.latitude, ev.longitude]}
                icon={createEventIcon(ev, selectedEvent?.id === ev.id)}
              >
                <Popup>
                  <div style={{ minWidth: '190px' }}>
                    <strong>{eventLabel(ev.event_type)} · M{ev.magnitude.toFixed(1)}</strong>
                    <br />
                    <span>{ev.place}</span>
                    <br />
                    <span style={{ color: '#94a3b8', fontSize: '11px' }}>
                      {ev.source.toUpperCase()} · {new Date(ev.event_time).toLocaleString('id-ID')}
                    </span>
                    <br />
                    <button
                      onClick={() => onEventClick(ev)}
                      style={{
                        marginTop: '8px',
                        color: '#a5b4fc',
                        cursor: 'pointer',
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        fontSize: '12px',
                        fontWeight: 700,
                      }}
                    >
                      Fokuskan berita →
                    </button>
                  </div>
                </Popup>
              </Marker>
            ))}

            {(currentFilter === 'all' || currentFilter === 'news') && visibleNews.map((item) => (
              <Marker
                key={`news-${item.id}`}
                position={[item.lat!, item.lon!]}
                icon={createNewsIcon(item)}
              >
                <Popup>
                  <div style={{ minWidth: '190px' }}>
                    <strong>{item.source.toUpperCase()}</strong>
                    <br />
                    <span>{item.title}</span>
                    {item.place_name && (
                      <>
                        <br />
                        <span style={{ color: '#94a3b8', fontSize: '11px' }}>{item.place_name}</span>
                      </>
                    )}
                    <br />
                    <a href={item.url} target="_blank" rel="noreferrer" style={{ color: '#6ee7b7', fontSize: '12px', fontWeight: 700 }}>
                      Buka sumber ↗
                    </a>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </div>
    </div>
  )
}
