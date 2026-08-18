import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'

/**
 * Timeline replay kejadian bencana.
 *
 * Menyapu window waktu [T-72 jam, T] di mana T bergerak dari `hoursAgo`
 * (default 72) menuju 0 (sekarang). Posisi disimpan di state lokal yang
 * disinkronkan dari prop, sehingga replay berjalan mulus meski induk
 * merender asinkron; setiap langkah dilaporkan via `onChange(hoursAgo)`.
 */
export const TIMELINE_WINDOW_HOURS = 72

interface MapTimelineProps {
  hoursAgo: number
  onChange: (hoursAgo: number) => void
  className?: string
}

const SPEEDS = [1, 2, 4, 8] as const
const BASE_STEP_MS = 1200

function formatMoment(hoursAgo: number): string {
  const at = new Date(Date.now() - hoursAgo * 60 * 60 * 1000)
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at)
}

export function MapTimeline({ hoursAgo, onChange, className = '' }: MapTimelineProps) {
  const [playing, setPlaying] = useState(false)
  const [speedIndex, setSpeedIndex] = useState(0)
  const [position, setPosition] = useState(hoursAgo)
  const speed = SPEEDS[speedIndex]
  const timerRef = useRef<number | undefined>(undefined)
  const positionRef = useRef(position)
  positionRef.current = position
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Sinkronkan posisi internal ketika induk mengubah hoursAgo dari luar
  // (mis. slider di-drag manual atau reset dari kontrol lain).
  useEffect(() => {
    setPosition(hoursAgo)
  }, [hoursAgo])

  const step = (next: number) => {
    const bounded = Math.max(0, Math.min(TIMELINE_WINDOW_HOURS, next))
    setPosition(bounded)
    onChangeRef.current(bounded)
    if (bounded <= 0) setPlaying(false)
  }

  useEffect(() => {
    if (!playing) return
    timerRef.current = window.setInterval(() => {
      step(positionRef.current - 1)
    }, BASE_STEP_MS / speed)
    return () => {
      if (timerRef.current !== undefined) window.clearInterval(timerRef.current)
    }
  }, [playing, speed])

  const label = useMemo(() => {
    if (position <= 0) return 'Sekarang'
    const h = Math.floor(position)
    const m = Math.round((position - h) * 60)
    return m > 0 ? `${h} jam ${m} mnt lalu` : `${h} jam lalu`
  }, [position])

  const restart = () => {
    step(TIMELINE_WINDOW_HOURS)
    setPlaying(true)
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/55 px-3 py-2 text-[11px] text-slate-300 shadow-2xl shadow-slate-950/50 backdrop-blur-xl ${className}`.trim()}
      role="group"
      aria-label="Replay timeline kejadian"
    >
      <button
        type="button"
        aria-label={playing ? 'Jeda replay' : 'Putar replay'}
        onClick={() => {
          if (!playing && position <= 0) {
            step(TIMELINE_WINDOW_HOURS)
            setPlaying(true)
            return
          }
          setPlaying(!playing)
        }}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-indigo-400/40 bg-indigo-500/15 text-indigo-100 transition hover:bg-indigo-500/25"
      >
        {playing ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
      </button>
      <button
        type="button"
        aria-label="Ulangi dari 72 jam lalu"
        onClick={restart}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-600/60 bg-slate-800/60 text-slate-300 transition hover:bg-slate-700"
      >
        <RotateCcw size={13} aria-hidden="true" />
      </button>
      <input
        aria-label="Posisi waktu replay"
        type="range"
        min="0"
        max={TIMELINE_WINDOW_HOURS}
        step="1"
        value={position}
        onChange={(event) => step(Number(event.target.value))}
        className="min-w-32 flex-1 accent-indigo-400"
      />
      <span className="whitespace-nowrap font-semibold text-slate-100">{label}</span>
      <span className="whitespace-nowrap text-slate-500">{formatMoment(position)}</span>
      <button
        type="button"
        aria-label={`Kecepatan replay ${speed} jam per detik`}
        onClick={() => setSpeedIndex((index) => (index + 1) % SPEEDS.length)}
        className="rounded-lg border border-slate-700 bg-slate-900/70 px-2 py-1 font-semibold text-slate-300 transition hover:bg-slate-800"
      >
        {speed}×
      </button>
    </div>
  )
}
