import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MarkdownMessage from '../../components/MarkdownMessage'
import SourceBadge from '../../components/SourceBadge'
import {
  getBriefing,
  type AiExecutiveBriefing,
  type AiBriefingDoneEvent,
  type AiBriefingErrorEvent,
  type AiBriefingFinalEvent,
  type AiBriefingStatusEvent,
  type Briefing,
  streamAiExecutiveBriefing,
} from '../../lib/api/client'

const REFRESH_INTERVAL_MS = 60_000

const magnitudeBadgeClasses = {
  high: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-400/30',
  medium: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/30',
  low: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30',
}

function formatBriefingDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function magnitudeClasses(magnitude: number): string {
  if (magnitude >= 6) return magnitudeBadgeClasses.high
  if (magnitude >= 5) return magnitudeBadgeClasses.medium
  return magnitudeBadgeClasses.low
}

type ProgressItem = {
  id: string
  stage: string
  message: string
}

function cleanAiBriefingContent(content: string) {
  return content
    .replace(/^(Saya\s+(akan|coba|perlu)\s+[^.?!]+[.?!]\s*)/i, '')
    .replace(/^(Saya\s+sudah\s+(menyusun|membuat|menyiapkan|menganalisis|merangkum)[^.?!]+[.?!]\s*)/i, '')
    .replace(/^Berdasarkan\s+data\s+yang\s+saya\s+(cek|lihat|temukan|analisis)[^.?!]+[.?!]\s*/i, '')
    .replace(/\n\s*(Apakah\s+(Anda|Bapak|Bapak)[^?]+\?\s*)$/i, '')
    .replace(/\n\s*(Ada\s+yang\s+ingin\s+ditanyakan\s+lagi\??\s*)$/i, '')
    .replace(/\n\s*(Bila\s+(Anda|Bapak|Bapak)[^\n]+saya\s+siap\s+membantu\.?)\s*$/i, '')
    .replace(/\n\s*(Jika\s+(Anda|Bapak|Bapak)[^\n]+saya\s+siap\s+membantu\.?)\s*$/i, '')
    .replace(/^\s*---+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function getBriefingProgressLabel(stage: string, message?: string) {
  const normalizedStage = stage.toLowerCase()
  const normalizedMessage = message?.toLowerCase() ?? ''

  if (normalizedStage.includes('start') || normalizedMessage.includes('workflow started')) {
    return 'Memulai penyusunan executive briefing.'
  }

  if (normalizedStage.includes('context')) {
    return 'Menyiapkan data dan konteks briefing harian.'
  }

  if (normalizedStage.includes('generation') || normalizedStage.includes('partial')) {
    return 'Menyusun narasi ringkasan eksekutif.'
  }

  if (normalizedStage.includes('final')) {
    return 'Merapikan format briefing untuk dibaca.'
  }

  if (normalizedStage.includes('done')) {
    return 'Briefing selesai disusun.'
  }

  if (normalizedStage.includes('error')) {
    return message || 'Terjadi kendala saat menyusun briefing.'
  }

  return message || 'Memproses briefing harian.'
}

export default function BriefingPage() {
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiBriefing, setAiBriefing] = useState<AiExecutiveBriefing | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiStatus, setAiStatus] = useState<string>('Menunggu briefing harian.')
  const [aiProgress, setAiProgress] = useState<ProgressItem[]>([])
  const [aiLiveContent, setAiLiveContent] = useState('')
  const activeAiStreamRef = useRef<ReturnType<typeof streamAiExecutiveBriefing> | null>(null)

  const stopAiStream = useCallback(() => {
    activeAiStreamRef.current?.close()
    activeAiStreamRef.current = null
  }, [])

  const appendAiProgress = useCallback((stage: string, message: string) => {
    const progressMessage = getBriefingProgressLabel(stage, message)

    setAiProgress((current) => {
      if (current[current.length - 1]?.message === progressMessage) return current

      const next = [
        ...current,
        { id: `${Date.now()}-${current.length}`, stage, message: progressMessage },
      ]
      return next.slice(-4)
    })
  }, [])

  const loadBriefing = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') {
      setLoading(true)
    } else {
      setRefreshing(true)
    }

    setError(null)

    try {
      const response = await getBriefing()
      setBriefing(response.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load daily briefing.')
    } finally {
      if (mode === 'initial') {
        setLoading(false)
      } else {
        setRefreshing(false)
      }
    }
  }, [])

  const loadAiBriefing = useCallback((triggerWorkerRefresh = false) => {
    stopAiStream()
    setAiLoading(true)
    setAiError(null)
    setAiBriefing(null)
    setAiLiveContent('')
    setAiStatus('Menyiapkan executive briefing…')
    setAiProgress([
      {
        id: `${Date.now()}-start`,
        stage: 'start',
        message: 'Menyiapkan data dan konteks briefing harian.',
      },
    ])

    const handleStatus = (event: AiBriefingStatusEvent) => {
      setAiStatus(getBriefingProgressLabel(event.stage, event.message))
      appendAiProgress(event.stage, event.message)
    }

    const handleFinal = (event: AiBriefingFinalEvent) => {
      const content = cleanAiBriefingContent(event.content)
      setAiLiveContent(content)
      setAiBriefing({
        content,
        mode: event.mode,
        note: event.note,
        runId: event.runId,
      })
    }

    const handleError = (event: AiBriefingErrorEvent) => {
      setAiError(event.message || 'Failed to generate AI briefing.')
      setAiStatus('Stream AI briefing berhenti karena error.')
      appendAiProgress('error', event.message || 'Terjadi error pada stream AI briefing.')
      setAiLoading(false)
      activeAiStreamRef.current = null
    }

    const handleDone = (event: AiBriefingDoneEvent) => {
      setAiStatus(
        event.mode === 'fallback'
          ? 'Briefing selesai dengan mode fallback.'
          : 'Briefing selesai dihasilkan oleh AI.',
      )
      appendAiProgress('done', `Stream selesai untuk run ${event.runId}.`)
      setAiLoading(false)
      activeAiStreamRef.current = null
    }

    const stream = streamAiExecutiveBriefing({
      triggerWorkerRefresh,
      onStatus: handleStatus,
      onPartial: (event) => {
        setAiLiveContent(event.content)
      },
      onFinal: handleFinal,
      onError: handleError,
      onDone: handleDone,
    })

    activeAiStreamRef.current = stream

    void stream.completed.catch((error) => {
      if (activeAiStreamRef.current !== stream) return
      setAiError(error instanceof Error ? error.message : 'Failed to generate AI briefing.')
      setAiStatus('Koneksi AI briefing terputus.')
      appendAiProgress(
        'error',
        error instanceof Error ? error.message : 'Koneksi AI briefing terputus.',
      )
      setAiLoading(false)
      activeAiStreamRef.current = null
    })
  }, [appendAiProgress, stopAiStream])

  useEffect(() => {
    void loadBriefing('initial')
  }, [loadBriefing])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void loadBriefing('refresh')
    }, REFRESH_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [loadBriefing])

  useEffect(() => {
    if (!briefing || aiBriefing || aiLoading) return
    void loadAiBriefing(false)
  }, [aiBriefing, aiLoading, briefing, loadAiBriefing])

  useEffect(() => stopAiStream, [stopAiStream])

  const formattedDate = useMemo(
    () => (briefing ? formatBriefingDate(briefing.date) : '—'),
    [briefing],
  )

  const handleRefresh = useCallback(() => {
    void loadBriefing('refresh')
    loadAiBriefing(true)
  }, [loadAiBriefing, loadBriefing])

  const handleAiRefresh = useCallback(() => {
    loadAiBriefing(true)
  }, [loadAiBriefing])

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-2xl font-semibold text-slate-50">Operational Risk Briefing</h3>
            <p className="mt-2 text-sm text-slate-400">
              Ringkasan briefing harian untuk pemantauan risiko bencana.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300 ring-1 ring-inset ring-slate-700">
              {briefing ? `${briefing.event_count} events` : 'Awaiting data'}
            </span>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading || refreshing}
              className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-indigo-400 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
      </section>

      {loading ? (
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-6">
            <div className="h-4 w-32 animate-pulse rounded bg-slate-800" />
            <div className="mt-4 h-8 w-72 animate-pulse rounded bg-slate-800" />
            <div className="mt-6 space-y-3">
              <div className="h-4 animate-pulse rounded bg-slate-800" />
              <div className="h-4 animate-pulse rounded bg-slate-800" />
              <div className="h-4 w-5/6 animate-pulse rounded bg-slate-800" />
            </div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-6">
            <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-400">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400" />
              Loading briefing...
            </div>
          </div>
        </section>
      ) : error ? (
        <section className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 shadow-2xl shadow-slate-950/40">
          <p className="text-sm font-semibold text-rose-100">Failed to load briefing</p>
          <p className="mt-2 break-words text-sm text-rose-300/80">{error}</p>
          <p className="mt-3 text-sm text-rose-300/60">
            Verify the API is running and reachable at the configured Vite proxy.
          </p>
        </section>
      ) : briefing ? (
        <>
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h4 className="text-xl font-semibold text-slate-50">AI Executive Briefing</h4>
                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${
                      aiBriefing?.mode === 'fallback'
                        ? 'bg-amber-500/15 text-amber-300 ring-amber-400/30'
                        : aiLoading
                          ? 'bg-cyan-500/15 text-cyan-300 ring-cyan-400/30'
                          : 'bg-indigo-500/15 text-indigo-300 ring-indigo-400/30'
                    }`}
                  >
                    {aiBriefing?.mode === 'fallback'
                      ? 'Fallback API'
                      : aiLoading
                        ? 'Sedang disusun'
                        : 'AI Briefing'}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-400">
                  Ringkasan eksekutif otomatis dari briefing harian, disajikan dalam format siap baca untuk pemantauan operasional.
                </p>
                {aiBriefing ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Run ID: {aiBriefing.runId} · {aiBriefing.note}
                  </p>
                ) : null}
              </div>

              <button
                type="button"
                onClick={handleAiRefresh}
                disabled={aiLoading}
                className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-indigo-400 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {aiLoading ? 'Menyusun Briefing…' : aiBriefing ? 'Refresh AI Briefing' : 'Generate AI Briefing'}
              </button>
            </div>

            <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/70 p-5">
              <div className="mb-4 rounded-xl border border-slate-800/80 bg-slate-900/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Status briefing
                    </p>
                    <p className="mt-2 text-sm text-slate-300">{aiStatus}</p>
                  </div>
                  {aiLoading ? (
                    <span className="mt-1 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400" />
                  ) : null}
                </div>
                {aiProgress.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {aiProgress.slice(-3).map((item) => (
                      <span
                        key={item.id}
                        className="inline-flex rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1 text-xs text-slate-400"
                      >
                        {item.message}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              {aiLoading && aiLiveContent.length === 0 ? (
                <div className="space-y-4 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4">
                  <div className="flex items-center gap-3 text-sm text-slate-300">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400" />
                    Menyusun ringkasan eksekutif dari data briefing harian…
                  </div>
                  <div className="space-y-3">
                    <div className="h-4 w-11/12 animate-pulse rounded bg-slate-800" />
                    <div className="h-4 w-4/5 animate-pulse rounded bg-slate-800" />
                    <div className="h-4 w-2/3 animate-pulse rounded bg-slate-800" />
                  </div>
                </div>
              ) : aiError ? (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
                  <p className="font-semibold">AI briefing gagal dimuat</p>
                  <p className="mt-2 break-words text-rose-200/80">{aiError}</p>
                </div>
              ) : aiBriefing || aiLiveContent ? (
                <>
                  {aiBriefing?.mode === 'fallback' ? (
                    <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                      <p className="font-semibold">Fallback aktif</p>
                      <p className="mt-1 text-amber-100/80">{aiBriefing.note}</p>
                    </div>
                  ) : null}
                  <MarkdownMessage
                    content={aiLiveContent || aiBriefing?.content || ''}
                    streaming={aiLoading}
                    emptyLabel="Menyusun ringkasan eksekutif…"
                  />
                </>
              ) : (
                <p className="text-sm text-slate-400">
                  AI briefing belum dibuat. Tekan tombol generate untuk memulai stream dari backend wrapper.
                </p>
              )}
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-6">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-[11px] font-medium text-indigo-400">Briefing Date</p>
                <span className="inline-flex rounded-full bg-indigo-500/15 px-3 py-1 text-xs font-semibold text-indigo-300 ring-1 ring-inset ring-indigo-400/30">
                  {briefing.event_count} monitored events
                </span>
              </div>
              <h4 className="mt-3 text-2xl font-semibold text-slate-50">{formattedDate}</h4>
              <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/70 p-5">
                <p className="text-[11px] font-medium text-slate-500">Summary</p>
                <p className="mt-3 whitespace-pre-line text-sm leading-7 text-slate-300">
                  {briefing.summary}
                </p>
              </div>
            </article>

            <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-xl font-semibold text-slate-50">
                    Priority catastrophe watchlist
                  </h4>
                </div>
              </div>

              {briefing.event_count === 0 || briefing.top_events.length === 0 ? (
                <div className="mt-6 rounded-xl border border-dashed border-slate-700 bg-slate-800/50 p-8 text-center">
                  <p className="text-sm font-medium text-slate-200">No events in today&apos;s briefing</p>
                  <p className="mt-2 text-sm text-slate-400">
                    The API returned an empty daily briefing. Refresh again after the next ingest cycle.
                  </p>
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  {briefing.top_events.map((event) => (
                    <div
                      key={event.event_id}
                      className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-3">
                            <span
                              className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${magnitudeClasses(event.magnitude)}`}
                            >
                              M {event.magnitude.toFixed(1)}
                            </span>
                            <p className="text-sm font-semibold text-slate-100">
                              {event.place ?? 'Unknown location'}
                            </p>
                          </div>
                          <p className="mt-3 text-xs text-slate-500">Event ID: {event.event_id}</p>
                        </div>

                        {event.source ? <SourceBadge source={event.source} /> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </section>
        </>
      ) : (
        <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-900 p-8 text-center shadow-2xl shadow-slate-950/40">
          <p className="text-sm font-medium text-slate-200">No briefing data available</p>
          <p className="mt-2 text-sm text-slate-400">
            The briefing endpoint returned no payload. Try refreshing the page.
          </p>
        </section>
      )}
    </div>
  )
}
