const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1'

export type Meta = {
  service: string
  version: string
  environment: string
  endpoints: string[]
}

export type Event = {
  id: string
  event_id: string
  source: string
  event_type: string
  magnitude: number
  latitude: number
  longitude: number
  place: string
  event_time: string
  url: string
  severity: string | null
  created_at: string
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, init)

  if (!res.ok) {
    throw new Error(`API request failed: ${res.status} ${res.statusText}`)
  }

  return (await res.json()) as T
}

export async function getMeta(): Promise<Meta> {
  return request<Meta>('/meta')
}

export async function getEvents(): Promise<Event[]> {
  const res = await request<{ data: Event[]; meta: { count: number; limit: number } }>('/events')
  return res.data
}

export type NewsItem = {
  id: string
  item_id: string
  source: string
  title: string
  summary: string
  url: string
  published_at: string | null
  perils: string[]
  lat: number | null
  lon: number | null
  place_name: string | null
  created_at: string
}

export type NewsResponse = {
  data: NewsItem[]
  meta: { count: number; limit: number }
}

export async function getNews(): Promise<NewsItem[]> {
  const res = await request<NewsResponse>('/news')
  return res.data
}

export type RiskScore = {
  entity_id: string
  place: string | null
  magnitude: number | null
  score: number
  source: string | null
  calculated_at: string
  factors: {
    severity: string | null
    magnitude: number | null
    base_score: number | null
    estimated_impact: string | null
  }
}

export type RiskScoresResponse = {
  data: RiskScore[]
  meta: { count: number; limit: number }
}

export async function getRiskScores(): Promise<RiskScoresResponse> {
  return request<RiskScoresResponse>('/risk-scores')
}

export type BriefingTopEvent = {
  event_id: string
  magnitude: number
  place: string | null
  source: string | null
}

export type Briefing = {
  date: string
  summary: string
  event_count: number
  top_events: BriefingTopEvent[]
}

export type BriefingResponse = {
  data: Briefing
}

export async function getBriefing(): Promise<BriefingResponse> {
  return request<BriefingResponse>('/briefings/today')
}

export type ExposureRule = {
  id: string
  region_name: string
  region_keywords: string[]
  total_exposure: number
  currency: string
  risk_multiplier: number
  portfolio_name: string
  estimated_impact: number
}

export type ExposuresResponse = {
  data: ExposureRule[]
  meta: { count: number }
}

export async function getExposures(): Promise<ExposuresResponse> {
  return request<ExposuresResponse>('/exposures')
}

export type ExposureMatch = {
  matched_rule: ExposureRule | null
  estimated_impact: number | null
}

export type ExposureMatchResponse = {
  data: ExposureMatch
}

export async function matchExposure(place: string): Promise<ExposureMatchResponse> {
  const qs = new URLSearchParams({ place })
  return request<ExposureMatchResponse>(`/exposures/match?${qs.toString()}`)
}

export type AlertSeverity = 'Critical' | 'High' | 'Moderate'

export type Alert = {
  id: string
  event_id: string | null
  source: string | null
  place: string | null
  magnitude: number | null
  event_time: string | null
  alert_type: string
  severity: AlertSeverity
  message: string
  acknowledged: boolean
  created_at: string
}

export type AlertsResponse = {
  data: Alert[]
  meta: { count: number; unacknowledged: number }
}

export async function getAlerts(): Promise<AlertsResponse> {
  return request<AlertsResponse>('/alerts')
}

export async function acknowledgeAlert(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/alerts/${encodeURIComponent(id)}/acknowledge`, {
    method: 'PATCH',
  })
}

export type ConnectorHealth = {
  name: string
  status: 'ok' | 'stale' | 'error'
  last_polled_at: string | null
  items_fetched: number
  error_message: string | null
  threshold_seconds: number
  updated_at: string | null
}

export async function getConnectorHealth(): Promise<ConnectorHealth[]> {
  const res = await request<{ data: ConnectorHealth[]; meta: { count: number } }>(
    '/health/connectors',
  )
  return res.data
}

export type AiExecutiveBriefing = {
  content: string
  mode: 'ai' | 'fallback'
  runId: string
  note: string
}

export type AiBriefingStatusEvent = {
  stage: string
  message: string
  runId: string
  mode?: 'ai' | 'fallback'
}

export type AiBriefingPartialEvent = {
  content: string
  runId: string
  mode: 'ai' | 'fallback'
}

export type AiBriefingFinalEvent = {
  content: string
  runId: string
  mode: 'ai' | 'fallback'
  note: string
}

export type AiBriefingErrorEvent = {
  message: string
  runId?: string
}

export type AiBriefingDoneEvent = {
  runId: string
  mode: 'ai' | 'fallback'
}

export type StreamAiExecutiveBriefingOptions = {
  triggerWorkerRefresh?: boolean
  onStatus?: (event: AiBriefingStatusEvent) => void
  onPartial?: (event: AiBriefingPartialEvent) => void
  onFinal?: (event: AiBriefingFinalEvent) => void
  onError?: (event: AiBriefingErrorEvent) => void
  onDone?: (event: AiBriefingDoneEvent) => void
}

type ParsedAiBriefingEventMap = {
  status: AiBriefingStatusEvent
  partial: AiBriefingPartialEvent
  final: AiBriefingFinalEvent
  briefing_error: AiBriefingErrorEvent
  done: AiBriefingDoneEvent
}

function parseStreamEvent<T>(event: MessageEvent<string>): T {
  return JSON.parse(event.data) as T
}

function buildDeterministicBriefing(
  briefing: Briefing,
  alerts: Alert[],
  riskScores: RiskScore[],
  reason: string,
): string {
  const topEvents = briefing.top_events.slice(0, 3)
  const topAlerts = alerts.slice(0, 3)
  const topRisks = riskScores.slice(0, 3)

  const lines = [
    'Ringkasan situasi',
    briefing.summary,
    '',
    'Top risk movers',
    ...(topEvents.length > 0
      ? topEvents.map(
          (event, index) =>
            `${index + 1}. ${event.place ?? 'Lokasi belum tersedia'} — event_id ${event.event_id} · source ${event.source ?? 'n/a'} · M${event.magnitude.toFixed(1)}`,
        )
      : ['1. Tidak ada top event pada briefing hari ini.']),
    '',
    'Probable impact',
    ...(topRisks.length > 0
      ? topRisks.map(
          (risk, index) =>
            `${index + 1}. ${risk.place} — event_id ${risk.entity_id} · source ${risk.source} · score ${risk.score} · severity ${risk.factors.severity ?? 'n/a'}`,
        )
      : ['1. Risk score belum tersedia dari endpoint saat ini.']),
    '',
    'Recommended follow-up actions',
    ...(topAlerts.length > 0
      ? topAlerts.map(
          (alert, index) =>
            `${index + 1}. Tinjau alert ${alert.id} (${alert.severity})${alert.source ? ` · source ${alert.source}` : ''}${alert.event_id ? ` · event_id ${alert.event_id}` : ''} — ${alert.message}`,
        )
      : ['1. Tidak ada alert prioritas yang perlu ditindaklanjuti saat ini.']),
    '',
    `Catatan fallback: ${reason}`,
  ]

  return lines.join('\n')
}

export async function getAiExecutiveBriefing(
  options?: { triggerWorkerRefresh?: boolean },
): Promise<AiExecutiveBriefing> {
  return new Promise<AiExecutiveBriefing>((resolve, reject) => {
    let finalEvent: AiBriefingFinalEvent | null = null
    let settled = false

    const stream = streamAiExecutiveBriefing({
      triggerWorkerRefresh: options?.triggerWorkerRefresh,
      onFinal: (event) => {
        finalEvent = event
      },
      onError: (event) => {
        if (settled) return
        settled = true
        reject(new Error(event.message || 'Failed to generate AI briefing.'))
      },
      onDone: () => {
        if (settled) return
        if (!finalEvent) {
          settled = true
          reject(new Error('AI briefing stream selesai tanpa payload final.'))
          return
        }

        settled = true
        resolve({
          content: finalEvent.content,
          mode: finalEvent.mode,
          runId: finalEvent.runId,
          note: finalEvent.note,
        })
      },
    })

    void stream.completed.catch((error) => {
      if (settled) return
      settled = true
      reject(error instanceof Error ? error : new Error('Failed to generate AI briefing.'))
    })
  })
}

export function streamAiExecutiveBriefing(options: StreamAiExecutiveBriefingOptions = {}) {
  const params = new URLSearchParams()

  if (options.triggerWorkerRefresh) {
    params.set('triggerWorkerRefresh', 'true')
  }

  params.set('_ts', Date.now().toString())

  const url = `${BASE_URL}/ai/briefings/executive/stream?${params.toString()}`
  const eventSource = new EventSource(url)

  let closed = false
  let settled = false
  let resolveCompleted!: () => void
  let rejectCompleted!: (error: Error) => void

  const completed = new Promise<void>((resolve, reject) => {
    resolveCompleted = resolve
    rejectCompleted = reject
  })

  const cleanup = () => {
    if (closed) return
    closed = true
    eventSource.close()
  }

  const finishSuccess = () => {
    if (settled) return
    settled = true
    cleanup()
    resolveCompleted()
  }

  const finishError = (error: Error) => {
    if (settled) return
    settled = true
    cleanup()
    rejectCompleted(error)
  }

  const attach = <K extends keyof ParsedAiBriefingEventMap>(
    eventName: K,
    handler?: (event: ParsedAiBriefingEventMap[K]) => void,
  ) => {
    eventSource.addEventListener(eventName, (rawEvent) => {
      try {
        const parsedEvent = parseStreamEvent<ParsedAiBriefingEventMap[K]>(
          rawEvent as MessageEvent<string>,
        )
        handler?.(parsedEvent)

        if (eventName === 'briefing_error') {
          finishError(new Error((parsedEvent as AiBriefingErrorEvent).message || 'AI briefing stream failed.'))
        }

        if (eventName === 'done') {
          finishSuccess()
        }
      } catch (error) {
        finishError(error instanceof Error ? error : new Error('Invalid AI briefing stream payload.'))
      }
    })
  }

  attach('status', options.onStatus)
  attach('partial', options.onPartial)
  attach('final', options.onFinal)
  attach('briefing_error', options.onError)
  attach('done', options.onDone)

  eventSource.onerror = () => {
    finishError(new Error('Koneksi AI briefing terputus sebelum selesai.'))
  }

  return {
    close: () => {
      cleanup()
      finishSuccess()
    },
    completed,
  }
}
