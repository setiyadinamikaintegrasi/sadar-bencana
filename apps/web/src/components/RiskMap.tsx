// apps/web/src/components/RiskMap.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap, Circle, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import type { Event, NewsItem } from '../lib/api/client'
import { getAccumulation, type AccumulationResult } from '../lib/api/client'
import RiskLayer from './RiskLayer'
import AccumulationPanel from './AccumulationPanel'
import { eventTypeToPerilClient } from './perilMap'

const INDONESIA_CENTER: [number, number] = [-2.5, 118]

type PerilFilter = 'all' | 'earthquake' | 'wildfire' | 'volcano' | 'flood' | 'news' | 'risiko'

const LAYER_FILTERS: Array<{ key: PerilFilter; label: string; icon: string; accent: string }> = [
  { key: 'all', label: 'Semua', icon: '◎', accent: 'text-indigo-200' },
  { key: 'earthquake', label: 'Gempa', icon: '●', accent: 'text-orange-300' },
  { key: 'wildfire', label: 'Karhutla', icon: '◆', accent: 'text-rose-300' },
  { key: 'volcano', label: 'Vulkanik', icon: '▲', accent: 'text-red-300' },
  { key: 'flood', label: 'Banjir', icon: '◒', accent: 'text-sky-300' },
  { key: 'news', label: 'News', icon: '✦', accent: 'text-emerald-300' },
  { key: 'risiko', label: 'Risiko', icon: '◉', accent: 'text-violet-300' },
]

const MAP_ANIMATION_CSS = `
  .rrm-exec-marker {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
  }
  .rrm-exec-marker::before,
  .rrm-exec-marker::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 9999px;
    border: 2px solid var(--color);
    animation: rrm-exec-ring 2.2s ease-out infinite;
    pointer-events: none;
  }
  .rrm-exec-marker::after {
    animation-delay: 0.7s;
    display: var(--second-ring, none);
  }
  .rrm-exec-marker__core {
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
  .rrm-news-pin {
    border-radius: 8px;
    background: #0f172a;
    border: 1px solid rgba(16,185,129,0.65);
    color: #6ee7b7;
    box-shadow: 0 8px 22px rgba(0,0,0,0.45), 0 0 18px rgba(16,185,129,0.22);
  }
  @keyframes rrm-exec-ring {
    0% { transform: scale(1); opacity: 0.68; }
    100% { transform: scale(2.7); opacity: 0; }
  }
  .rrm-exec-map .leaflet-popup-content-wrapper {
    background: #0f172a !important;
    color: #cbd5e1 !important;
    border: 1px solid #334155 !important;
    border-radius: 12px !important;
    box-shadow: 0 20px 45px rgba(0,0,0,0.55) !important;
  }
  .rrm-exec-map .leaflet-popup-tip { background: #0f172a !important; }
  .rrm-exec-map .leaflet-popup-content { margin: 12px 14px !important; }
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

function createEventIcon(event: Event, selected: boolean): L.DivIcon {
  const color = eventColor(event)
  const critical = event.magnitude >= 6 || ['wildfire', 'volcano', 'flood'].includes((event.event_type ?? '').toLowerCase())
  const size = selected ? 34 : Math.max(22, Math.min(32, Math.round(16 + event.magnitude * 2)))
  const spread = size * 3
  return L.divIcon({
    className: '',
    iconSize: [spread, spread],
    iconAnchor: [spread / 2, spread / 2],
    html: `<div class="rrm-exec-marker" style="--color:${color};--second-ring:${critical || selected ? 'block' : 'none'};width:${size}px;height:${size}px;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)">
      <div class="rrm-exec-marker__core" style="width:${size}px;height:${size}px;${selected ? 'outline:2px solid #c4b5fd;outline-offset:3px;' : ''}">${eventGlyph(event)}</div>
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
    html: `<div class="rrm-news-pin" style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:12px">${glyph}</div>`,
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
      container.classList.add('rrm-map-active')
      container.classList.remove('rrm-map-inactive')
    }
    const disableZoom = () => {
      map.scrollWheelZoom.disable()
      container.classList.remove('rrm-map-active')
      container.classList.add('rrm-map-inactive')
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

function AccumulationController({
  center, radiusKm, whatIf, onPick,
}: {
  center: [number, number] | null
  radiusKm: number
  whatIf: boolean
  onPick: (lat: number, lon: number) => void
}) {
  useMapEvents({
    click: (e) => {
      if (whatIf) onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  if (!center) return null
  return <Circle center={center} radius={radiusKm * 1000} pathOptions={{ color: '#a78bfa', weight: 1, fillOpacity: 0.08 }} />
}

interface RiskMapProps {
  events: Event[]
  news?: NewsItem[]
  activePerilFilter: string
  onFilterChange: (filter: string) => void
  onEventClick: (event: Event) => void
  selectedEvent?: Event | null
  height?: number | string
}

export default function RiskMap({
  events,
  news = [],
  activePerilFilter,
  onFilterChange,
  onEventClick,
  selectedEvent,
  height = 430,
}: RiskMapProps) {
  useEffect(() => {
    if (document.getElementById('rrm-exec-map-css')) return
    const style = document.createElement('style')
    style.id = 'rrm-exec-map-css'
    style.textContent = MAP_ANIMATION_CSS
    document.head.appendChild(style)
  }, [])

  const [radiusKm, setRadiusKm] = useState(50)
  const [accPeril, setAccPeril] = useState('')
  const [whatIf, setWhatIf] = useState(false)
  const [accCenter, setAccCenter] = useState<[number, number] | null>(null)
  const [accResult, setAccResult] = useState<AccumulationResult | null>(null)
  const [accActiveOn, setAccActiveOn] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (selectedEvent) {
      setWhatIf(false)
      setAccCenter([selectedEvent.latitude, selectedEvent.longitude])
      setAccPeril(eventTypeToPerilClient(selectedEvent.event_type))
      setAccActiveOn(selectedEvent.event_time ? selectedEvent.event_time.slice(0, 10) : undefined)
    }
  }, [selectedEvent])

  useEffect(() => {
    if (!accCenter) {
      setAccResult(null)
      return
    }
    let cancelled = false
    getAccumulation({
      lat: accCenter[0],
      lon: accCenter[1],
      radiusKm,
      peril: accPeril || undefined,
      activeOn: accActiveOn,
    })
      .then((res) => { if (!cancelled) setAccResult(res.data) })
      .catch(() => { if (!cancelled) setAccResult(null) })
    return () => { cancelled = true }
  }, [accCenter, radiusKm, accPeril, accActiveOn])

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
      risiko: 0,
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

      <div className="rrm-exec-map relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
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

            <RiskLayer active={currentFilter === 'risiko'} />
            <AccumulationController
              center={accCenter}
              radiusKm={radiusKm}
              whatIf={whatIf}
              onPick={(lat, lon) => { setAccActiveOn(undefined); setAccCenter([lat, lon]) }}
            />
          </MapContainer>
        </div>

        {(currentFilter === 'risiko' || selectedEvent) && (
          <AccumulationPanel
            result={accResult}
            radiusKm={radiusKm}
            onRadiusChange={setRadiusKm}
            peril={accPeril}
            onPerilChange={setAccPeril}
            whatIf={whatIf}
            onToggleWhatIf={() => setWhatIf((v) => !v)}
            onClear={() => { setAccCenter(null); setAccResult(null); setWhatIf(false) }}
          />
        )}
      </div>
    </div>
  )
}
