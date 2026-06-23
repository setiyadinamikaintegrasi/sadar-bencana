import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'

import { executiveBriefingAgent } from '../agents/executive-briefing-agent'
import { config } from '../shared/config'
import { fetchJson } from '../shared/http'

const pickTop = <T>(items: T[] | undefined, limit: number): T[] => (items ?? []).slice(0, limit)

const gatherContextStep = createStep({
  id: 'gather-dashboard-context',
  inputSchema: z.object({
    triggerWorkerRefresh: z.boolean().default(false),
  }),
  outputSchema: z.object({
    refreshTriggered: z.boolean(),
    prompt: z.string(),
  }),
  execute: async ({ inputData }) => {
    if (inputData.triggerWorkerRefresh) {
      await fetchJson(`${config.workerBaseUrl}/briefings/generate`, {
        method: 'POST',
        body: JSON.stringify({ force: true }),
      })
    }

    const [eventsRaw, alertsRaw, exposuresRaw, riskScoresRaw, briefing, newsRaw, connectorHealthRaw] = await Promise.all([
      fetchJson<any>(`${config.apiBaseUrl}/events`),
      fetchJson<any>(`${config.apiBaseUrl}/alerts`),
      fetchJson<any>(`${config.apiBaseUrl}/exposures`),
      fetchJson<any>(`${config.apiBaseUrl}/risk-scores`),
      fetchJson<any>(`${config.apiBaseUrl}/briefings/today`),
      fetchJson<any>(`${config.apiBaseUrl}/news`).catch(() => undefined),
      fetchJson<any>(`${config.apiBaseUrl}/health/connectors`).catch(() => undefined),
    ])

    const compactContext = {
      briefing: briefing?.data,
      topEvents: pickTop(eventsRaw?.data, 5).map((item: any) => ({
        event_id: item.event_id,
        source: item.source,
        event_type: item.event_type,
        magnitude: item.magnitude,
        place: item.place,
        event_time: item.event_time,
        severity: item.severity ?? null,
        url: item.url ?? '',
      })),
      topAlerts: pickTop(alertsRaw?.data, 5).map((item: any) => ({
        id: item.id,
        alert_type: item.alert_type,
        severity: item.severity,
        message: item.message,
        event_id: item.event_id ?? null,
        source: item.source ?? null,
        place: item.place ?? null,
      })),
      topRiskScores: pickTop(riskScoresRaw?.data, 5).map((item: any) => ({
        entity_id: item.entity_id,
        source: item.source,
        place: item.place,
        magnitude: item.magnitude,
        score: item.score,
        severity: item.factors?.severity ?? null,
        estimated_impact: item.factors?.estimated_impact ?? null,
      })),
      exposureWatchlist: pickTop(exposuresRaw?.data, 5).map((item: any) => ({
        region_name: item.region_name,
        treaty_category: item.treaty_category ?? null,
        total_exposure: item.total_exposure,
        risk_multiplier: item.risk_multiplier,
      })),
      newsSignals: pickTop(newsRaw?.data, 3).map((item: any) => ({
        source: item.source,
        title: item.title,
        summary: String(item.summary ?? '').slice(0, 200),
        url: item.url,
        published_at: item.published_at ?? null,
      })),
      connectorExceptions: (connectorHealthRaw?.data ?? [])
        .filter((item: any) => item.status !== 'ok')
        .slice(0, 5)
        .map((item: any) => ({
          name: item.name,
          status: item.status,
          error_message: item.error_message ?? null,
          updated_at: item.updated_at ?? null,
        })),
    }

    return {
      refreshTriggered: inputData.triggerWorkerRefresh,
      prompt: JSON.stringify(compactContext, null, 2),
    }
  },
})

const generateBriefingStep = createStep({
  id: 'generate-executive-briefing',
  inputSchema: z.object({
    refreshTriggered: z.boolean(),
    prompt: z.string(),
  }),
  outputSchema: z.object({
    briefing: z.string(),
  }),
  execute: async ({ inputData }) => {
    const response = await executiveBriefingAgent.generate(`
Susun executive briefing untuk Reinsurance Risk Monitor berdasarkan context JSON berikut.

Keluaran wajib:
1. Ringkasan situasi 1 paragraf
2. Top 3 risk movers
3. Probable impact
4. Recommended follow-up actions
5. Setiap poin wajib menyebut event_id / source / alert id bila tersedia
6. Jangan sebut field teknis kosong/undefined

Context JSON:
${inputData.prompt}
`)

    return {
      briefing: response.text,
    }
  },
})

export const dailyBriefingWorkflow = createWorkflow({
  id: 'daily-briefing-workflow',
  inputSchema: z.object({
    triggerWorkerRefresh: z.boolean().default(false),
  }),
  outputSchema: z.object({
    briefing: z.string(),
  }),
})
  .then(gatherContextStep)
  .then(generateBriefingStep)
  .commit()
