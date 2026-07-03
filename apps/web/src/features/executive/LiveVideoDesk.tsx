import { useState } from 'react'
import { liveVideoSources, type LiveVideoSource } from './liveVideoSources'

type PlayerStatus = 'loading' | 'ready' | 'unavailable'

const statusClasses: Record<PlayerStatus, string> = {
  loading: 'bg-amber-500/15 text-amber-200 ring-amber-400/30',
  ready: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30',
  unavailable: 'bg-rose-500/15 text-rose-200 ring-rose-400/30',
}

const statusLabels: Record<PlayerStatus, string> = {
  loading: 'Memuat player',
  ready: 'Player siap',
  unavailable: 'Tidak dapat diputar',
}

function SourceTypeBadge({ source }: { source: LiveVideoSource }) {
  const official = source.sourceType === 'official'
  const weather = source.sourceType === 'weather'

  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
        official
          ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
          : weather
            ? 'border-sky-400/30 bg-sky-500/10 text-sky-200'
          : 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200'
      }`}
    >
      {official ? 'RESMI' : weather ? 'CUACA' : 'MEDIA'}
    </span>
  )
}

function availabilityLabel(source: LiveVideoSource): string {
  if (source.availability === 'forecast') return 'Peta prakiraan'
  if (source.availability === 'continuous') return 'Live 24/7'
  return 'Live/Jadwal'
}

export default function LiveVideoDesk() {
  const [selectedId, setSelectedId] = useState(liveVideoSources[0].id)
  const [playerStatus, setPlayerStatus] = useState<PlayerStatus>('loading')
  const selected = liveVideoSources.find((source) => source.id === selectedId) ?? liveVideoSources[0]
  const readyLabel = selected.contentType === 'weather-map' ? 'Peta siap' : statusLabels[playerStatus]

  const selectSource = (source: LiveVideoSource) => {
    setSelectedId(source.id)
    setPlayerStatus(source.embedUrl ? 'loading' : 'unavailable')
  }

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-slate-950/40">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-50">Live Monitoring Desk</h3>
          <p className="text-xs text-slate-500">Peta cuaca interaktif dan kanal video untuk pemantauan situasi.</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusClasses[playerStatus]}`}
          aria-live="polite"
        >
          {playerStatus === 'ready' ? readyLabel : statusLabels[playerStatus]}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-black">
        <div className="aspect-video">
          {selected.embedUrl ? (
            <iframe
              key={selected.id}
              className="h-full w-full"
              src={selected.embedUrl}
              title={`${selected.contentType === 'weather-map' ? 'Peta cuaca' : 'Live video'} ${selected.name}`}
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
              onLoad={() => setPlayerStatus('ready')}
              onError={() => setPlayerStatus('unavailable')}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm font-semibold text-slate-200">Stream tidak tersedia untuk diputar di aplikasi.</p>
              <p className="max-w-md text-xs leading-5 text-slate-500">
                Sumber mungkin sedang tidak live atau menonaktifkan pemutaran di situs lain.
              </p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-950/90 p-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-slate-100">{selected.name}</p>
              <SourceTypeBadge source={selected} />
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {selected.category} · {availabilityLabel(selected)}
            </p>
          </div>
          <a
            href={selected.href}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-xs font-semibold text-indigo-200 transition hover:bg-indigo-500/20"
          >
            Buka sumber ↗
          </a>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {liveVideoSources.map((source) => {
          const active = source.id === selected.id
          return (
            <button
              key={source.id}
              type="button"
              onClick={() => selectSource(source)}
              aria-pressed={active}
              className={`rounded-xl border p-3 text-left transition ${
                active
                  ? 'border-indigo-400/60 bg-indigo-500/10'
                  : 'border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-800/70'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-slate-100">▶ {source.name}</p>
                <SourceTypeBadge source={source} />
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{source.description}</p>
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {availabilityLabel(source)} · {source.category}
              </p>
            </button>
          )
        })}
      </div>

      <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100/80">
        Windy merupakan visualisasi prakiraan pihak ketiga, bukan laporan atau peringatan dini resmi. Keputusan
        keselamatan harus mengacu pada BMKG, BNPB, PVMBG/Badan Geologi, dan pemerintah daerah. Jika embed ditolak
        penyedia, gunakan tombol “Buka sumber”.
      </p>
    </article>
  )
}
