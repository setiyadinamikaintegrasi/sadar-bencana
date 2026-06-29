import { supabase } from '../supabase'

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1'

export type Meta = {
  service: string
  version: string
  environment: string
  risk_free_limit: number
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
  const headers = new Headers(init?.headers)
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers })

  if (res.status === 401) {
    // Token expired — attempt one silent refresh then retry
    const { data: refreshData } = await supabase.auth.refreshSession()
    const freshToken = refreshData.session?.access_token
    if (freshToken) {
      const retryHeaders = new Headers(init?.headers)
      retryHeaders.set('Authorization', `Bearer ${freshToken}`)
      const retryRes = await fetch(`${BASE_URL}${path}`, { ...init, headers: retryHeaders })
      if (retryRes.ok) return (await retryRes.json()) as T
      if (retryRes.status !== 401) {
        const err = new Error(`API request failed: ${retryRes.status} ${retryRes.statusText}`) as Error & { status?: number }
        err.status = retryRes.status
        throw err
      }
    }
    await supabase.auth.signOut()
    const err = new Error(`API request failed: ${res.status} ${res.statusText}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  if (!res.ok) {
    const err = new Error(`API request failed: ${res.status} ${res.statusText}`) as Error & { status?: number }
    err.status = res.status
    throw err
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

export type MapOverlay = {
  id: string
  layer_class: 'official' | 'static_risk' | 'watch_zone'
  peril_type: string | null
  label: string
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] } | null
  latitude: number | null
  longitude: number | null
  radius_km: number | null
  effective_at: string | null
  expires_at: string | null
  data_vintage: string | null
  attribution: string | null
  source_url: string | null
}

export async function getMapOverlays(): Promise<MapOverlay[]> {
  const response = await request<{ data: MapOverlay[] }>('/map/overlays')
  return response.data
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

export type AlertSeverity = 'Critical' | 'High' | 'Moderate'
export type AlertVerification = 'unverified' | 'corroborated' | 'official'

export type Alert = {
  id: string
  event_id: string | null
  source: string | null
  place: string | null
  magnitude: number | null
  event_time: string | null
  alert_type: string
  severity: AlertSeverity
  verification_status: AlertVerification
  source_count: number
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

export type AlertActionCard = {
  alert_id: string
  what_happened: string
  why_received: string
  peril_type: string
  source: string | null
  confidence_class: string
  last_update: string
  effective_at: string | null
  expires_at: string | null
  guidance_version: string
  guidance: { before: string[]; during: string[]; after: string[] }
  guidance_source: string | null
}

export async function getAlertActionCard(id: string): Promise<AlertActionCard> {
  const response = await request<{ data: AlertActionCard }>(
    `/alerts/${encodeURIComponent(id)}/action-card`,
  )
  return response.data
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

  const eventRows = topEvents.length > 0
    ? topEvents.map(
        (event) =>
          `| ${event.place ?? 'Lokasi belum tersedia'} | ${event.event_id} | ${event.source ?? 'n/a'} | M${event.magnitude.toFixed(1)} |`,
      )
    : ['| Tidak ada top event | - | - | - |']

  const riskRows = topRisks.length > 0
    ? topRisks.map(
        (risk) =>
          `| ${risk.place} | ${risk.entity_id} | ${risk.source} | ${risk.score} | ${risk.factors.severity ?? 'n/a'} |`,
      )
    : ['| Risk score belum tersedia | - | - | - | - |']

  const actionRows = topAlerts.length > 0
    ? topAlerts.map(
        (alert) =>
          `- Tinjau alert **${alert.id}** (${alert.severity})${alert.source ? ` · source ${alert.source}` : ''}${alert.event_id ? ` · event_id ${alert.event_id}` : ''}: ${alert.message}`,
      )
    : ['- Tidak ada alert prioritas yang perlu ditindaklanjuti saat ini.']

  const lines = [
    '## Ringkasan Situasi',
    briefing.summary,
    '',
    '## Top Risk Movers',
    '| Lokasi | Event ID | Source | Magnitude |',
    '|---|---|---|---|',
    ...eventRows,
    '',
    '## Probable Impact',
    '| Lokasi | Event ID | Source | Score | Severity |',
    '|---|---|---|---|---|',
    ...riskRows,
    '',
    '## Recommended Follow-up Actions',
    ...actionRows,
    '',
    `*Catatan fallback: ${reason}*`,
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

/**
 * Stream a chat message to the Analyst Copilot agent via the Go backend proxy.
 * Returns an abort controller handle so the caller can cancel mid-stream.
 */
export function streamCopilotChat(
  message: string,
  callbacks: {
    onChunk?: (text: string) => void
    onComplete?: () => void
    onError?: (err: Error) => void
  },
): AbortController {
  const controller = new AbortController()

  fetch(`${BASE_URL}/ai/copilot/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const body = await response.text()
        throw new Error(`Copilot API error ${response.status}: ${body}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('Response body is not readable')
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let done = false

      while (!done) {
        const { value, done: streamDone } = await reader.read()
        done = streamDone

        if (value) {
          buffer += decoder.decode(value, { stream: true })

          // Parse Mastra chatRoute SSE format:
          //   data: {"type":"tool-input-delta","inputTextDelta":"..."}   — tool progress (intermediate)
          //   data: {"type":"result","...":"final answer..."}            — result event
          //   0:"some text\n"                                            — AI SDK v5 text chunk (final generation)
          const lines = buffer.split('\n')
          // Keep the last (potentially incomplete) line in the buffer
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue

            // "0:..." — AI SDK v5 text chunk (final generation text)
            if (trimmed.startsWith('0:')) {
              let text = trimmed.slice(2)
              // AI SDK wraps text in quotes: 0:"Hello\n"  — unwrap
              if (text.startsWith('"') && text.endsWith('"')) {
                text = text.slice(1, -1)
              }
              // Unescape \n to actual newline
              text = text.replace(/\\n/g, '\n')
              if (text) {
                callbacks.onChunk?.(text)
              }
              continue
            }

            // "data: {...}" — Mastra chatRoute event (tool calls, intermediate progress)
            if (trimmed.startsWith('data:')) {
              const jsonStr = trimmed.slice(5).trim()
              if (!jsonStr) continue
              try {
                const event = JSON.parse(jsonStr)
                // Real-time text stream from Mastra chatRoute
                if (event.type === 'text-delta' && event.delta) {
                  callbacks.onChunk?.(event.delta)
                } else if (event.type === 'error' && (event.error || event.errorText)) {
                  callbacks.onChunk?.(`[Error: ${event.error ?? event.errorText}] `)
                }
                // Tool-call events are intentionally hidden from the chat UI.
                // They are useful for tracing, but showing tool names/arguments makes
                // the copilot answer look machine-generated and noisy for analysts.
              } catch {
                // Malformed JSON — skip silently
              }
              continue
            }
          }
        }
      }

      // Flush remaining buffer
      if (buffer.trim()) {
        const trimmed = buffer.trim()
        if (trimmed.startsWith('0:')) {
          let text = trimmed.slice(2)
          if (text.startsWith('"') && text.endsWith('"')) {
            text = text.slice(1, -1)
          }
          text = text.replace(/\\n/g, '\n')
          if (text) {
            callbacks.onChunk?.(text)
          }
        }
      }

      callbacks.onComplete?.()
    })
    .catch((err) => {
      if (err.name === 'AbortError') return
      callbacks.onError?.(err instanceof Error ? err : new Error(String(err)))
    })

  return controller
}

export type AcceptanceContract = {
  id: string
  contract_no: string
  cedant_name: string
  object_name: string
  object_address: string
  peril: 'earthquake' | 'flood' | 'volcano' | 'fire' | 'windstorm' | 'other'
  treaty_type: 'facultative' | 'treaty'
  occupancy: string
  latitude: number
  longitude: number
  currency: string
  sum_insured: number
  share_pct: number
  share_amount: number
  premium: number
  claim_amount: number
  inception_date: string
  expiry_date: string
  created_at?: string
  updated_at?: string
  distance_km?: number
}

export type ContractFilters = {
  peril?: string
  treaty_type?: string
  cedant?: string
  q?: string
  active_on?: string
  bbox?: string
  limit?: number
  offset?: number
}

export async function getContracts(
  params: ContractFilters = {},
): Promise<{ data: AcceptanceContract[]; meta: { count: number } }> {
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && `${v}` !== '') qs.set(k, `${v}`)
  })
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return request(`/contracts${suffix}`)
}

export async function getContract(id: string): Promise<{ data: AcceptanceContract }> {
  return request(`/contracts/${id}`)
}

export async function createContract(
  body: Partial<AcceptanceContract>,
): Promise<{ data: AcceptanceContract }> {
  return request('/contracts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function updateContract(
  id: string,
  body: Partial<AcceptanceContract>,
): Promise<{ data: AcceptanceContract }> {
  return request(`/contracts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function deleteContract(id: string): Promise<void> {
  await request(`/contracts/${id}`, { method: 'DELETE' })
}

export type ImportResult = {
  data?: { inserted: number; failed: number; errors: { row: number; message: string }[] }
  error?: string
  message?: string
  errors?: { row: number; message: string }[]
}

export async function importContracts(file: File): Promise<ImportResult> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`${BASE_URL}/contracts/import`, { method: 'POST', body: fd })
  return (await res.json()) as ImportResult
}

export type AccumulationSummary = {
  sum_insured: number
  share_amount: number
  premium: number
  claim_amount: number
  count: number
}
export type AccumulationByPeril = { peril: string; share_amount: number; count: number }
export type AccumulationResult = {
  summary: AccumulationSummary
  by_peril: AccumulationByPeril[]
  contracts: AcceptanceContract[]
  params: { lat: number; lon: number; radius_km: number; peril: string; active_on: string }
}

export async function getAccumulation(p: {
  lat: number
  lon: number
  radiusKm: number
  peril?: string
  activeOn?: string
}): Promise<{ data: AccumulationResult }> {
  const qs = new URLSearchParams({
    lat: `${p.lat}`,
    lon: `${p.lon}`,
    radius_km: `${p.radiusKm}`,
  })
  if (p.peril) qs.set('peril', p.peril)
  if (p.activeOn) qs.set('active_on', p.activeOn)
  return request(`/accumulation?${qs.toString()}`)
}
