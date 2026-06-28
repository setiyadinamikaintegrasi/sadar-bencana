// apps/web/src/components/NewsPanel.tsx
import { useMemo } from 'react'
import type { Event, NewsItem } from '../lib/api/client'

const PERIL_COLORS: Record<string, string> = {
  earthquake: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-400/30',
  flood: 'bg-blue-500/15 text-blue-300 ring-1 ring-inset ring-blue-400/30',
  wind: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/30',
  storm: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/30',
  tsunami: 'bg-purple-500/15 text-purple-300 ring-1 ring-inset ring-purple-400/30',
}
const PERIL_COLOR_DEFAULT = 'bg-slate-500/15 text-slate-300 ring-1 ring-inset ring-slate-400/30'

const PERIL_LABELS: Record<string, string> = {
  earthquake: 'Gempa',
  flood: 'Banjir',
  wind: 'Angin',
  storm: 'Angin',
  tsunami: 'Tsunami',
}

const PERIL_QUERY_PREFIX: Record<string, string> = {
  earthquake: 'gempa bumi',
  flood: 'banjir',
  wind: 'angin topan',
  storm: 'angin topan',
  tsunami: 'tsunami',
}

function buildYouTubeUrl(item: NewsItem, selectedEvent: Event | null): string {
  let query: string
  if (selectedEvent) {
    const type = (selectedEvent.event_type ?? '').toLowerCase()
    const prefix = PERIL_QUERY_PREFIX[type] ?? selectedEvent.event_type ?? 'bencana'
    const place = selectedEvent.place?.split(',')[0] ?? ''
    const mag = selectedEvent.magnitude.toFixed(1)
    query = `${prefix} ${place} M${mag}`.trim()
  } else {
    const peril = (item.perils[0] ?? '').toLowerCase()
    const prefix = PERIL_QUERY_PREFIX[peril] ?? peril
    const place = item.place_name ?? ''
    query = `${prefix} ${place}`.trim()
  }
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 1) return 'Baru saja'
  if (hours < 24) return `${hours} jam lalu`
  const days = Math.floor(hours / 24)
  return `${days} hari lalu`
}

interface NewsPanelProps {
  news: NewsItem[]
  loading: boolean
  selectedEvent: Event | null
  onClearSelection: () => void
}

export default function NewsPanel({
  news,
  loading,
  selectedEvent,
  onClearSelection,
}: NewsPanelProps) {
  const filteredNews = useMemo(() => {
    if (!selectedEvent) return news.slice(0, 5)

    const eventPeril = (selectedEvent.event_type ?? '').toLowerCase()
    const eventPlace = (selectedEvent.place ?? '').toLowerCase()

    const scored = news.map((item) => {
      const perilMatch = item.perils.some(
        (p) =>
          p.toLowerCase().includes(eventPeril) ||
          eventPeril.includes(p.toLowerCase()),
      )
      const placeMatch = item.place_name
        ? eventPlace.includes(item.place_name.toLowerCase()) ||
          item.place_name.toLowerCase().includes(eventPlace.split(',')[0].toLowerCase())
        : false
      return { item, score: (perilMatch ? 2 : 0) + (placeMatch ? 1 : 0) }
    })

    const relevant = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)

    return relevant.length > 0
      ? relevant.map((s) => s.item).slice(0, 5)
      : news.slice(0, 5)
  }, [news, selectedEvent])

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        {selectedEvent ? (
          <>
            <p className="text-xs font-semibold text-slate-300">
              Berita terkait:{' '}
              <span className="text-indigo-300">
                M{selectedEvent.magnitude.toFixed(1)} {selectedEvent.place?.split(',')[0]}
              </span>
            </p>
            <button
              type="button"
              onClick={onClearSelection}
              className="text-xs text-slate-500 transition hover:text-slate-300"
            >
              ✕ Hapus filter
            </button>
          </>
        ) : (
          <p className="text-xs font-semibold text-slate-400">Berita Risiko Terbaru</p>
        )}
      </div>

      {/* Cards */}
      <div className="max-h-[360px] divide-y divide-slate-800 overflow-y-auto">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2 p-4">
              <div className="h-3 w-20 animate-pulse rounded bg-slate-800" />
              <div className="h-4 w-full animate-pulse rounded bg-slate-800" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-slate-800" />
            </div>
          ))
        ) : filteredNews.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">
            Belum ada berita tersedia.
          </div>
        ) : (
          filteredNews.map((item) => {
            const peril = (item.perils[0] ?? '').toLowerCase()
            const perilColor = PERIL_COLORS[peril] ?? PERIL_COLOR_DEFAULT
            const perilLabel = PERIL_LABELS[peril] ?? item.perils[0] ?? 'Risiko'

            return (
              <article key={item.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${perilColor}`}
                  >
                    {perilLabel}
                  </span>
                  {item.place_name && (
                    <span className="text-[10px] text-slate-500">{item.place_name}</span>
                  )}
                  <span className="ml-auto text-[10px] text-slate-600">
                    {formatRelativeTime(item.published_at)}
                  </span>
                </div>

                <p className="line-clamp-2 text-sm font-semibold text-slate-100">
                  {item.title}
                </p>

                {item.summary && (
                  <p className="line-clamp-2 text-xs text-slate-400">{item.summary}</p>
                )}

                <div className="flex items-center gap-3 pt-1">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo-400 transition hover:text-indigo-300"
                  >
                    Baca ↗
                  </a>
                  <a
                    href={buildYouTubeUrl(item, selectedEvent)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-rose-400 transition hover:text-rose-300"
                  >
                    ▶ YouTube
                  </a>
                </div>
              </article>
            )
          })
        )}
      </div>
    </div>
  )
}
