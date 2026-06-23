import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

import { config } from '../shared/config'
import { fetchJson } from '../shared/http'

const eventsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      event_id: z.string(),
      source: z.string(),
      event_type: z.string(),
      magnitude: z.number(),
      latitude: z.number(),
      longitude: z.number(),
      place: z.string(),
      event_time: z.string(),
      url: z.string(),
      severity: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
  meta: z.object({
    count: z.number(),
    limit: z.number().optional().default(0),
  }),
})

const alertsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      event_id: z.string().nullable(),
      source: z.string().nullable(),
      place: z.string().nullable(),
      magnitude: z.number().nullable(),
      event_time: z.string().nullable(),
      alert_type: z.string(),
      severity: z.enum(['Critical', 'High', 'Moderate']),
      message: z.string(),
      acknowledged: z.boolean(),
      created_at: z.string(),
    }),
  ),
  meta: z.object({
    count: z.number(),
    unacknowledged: z.number(),
  }),
})

const exposuresResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      region_name: z.string(),
      region_keywords: z.array(z.string()),
      total_exposure: z.number(),
      treaty_category: z.string().nullable().optional(),
      risk_multiplier: z.number(),
      is_active: z.boolean(),
      created_at: z.string(),
      updated_at: z.string(),
    }),
  ),
  meta: z.object({
    count: z.number(),
  }),
})

const newsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      item_id: z.string(),
      source: z.string(),
      title: z.string(),
      summary: z.string(),
      url: z.string(),
      published_at: z.string().nullable(),
      perils: z.array(z.string()),
      lat: z.number().nullable(),
      lon: z.number().nullable(),
      place_name: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
  meta: z.object({
    count: z.number(),
    limit: z.number().optional().default(0),
  }),
})

const riskScoresResponseSchema = z.object({
  data: z.array(
    z.object({
      entity_id: z.string(),
      score: z.number(),
      factors: z
        .object({
          severity: z.string().nullable().optional(),
          magnitude: z.number().nullable().optional(),
          base_score: z.number().nullable().optional(),
          estimated_impact: z.string().nullable().optional(),
        })
        .passthrough(),
      calculated_at: z.string(),
      place: z.string(),
      magnitude: z.number(),
      source: z.string(),
    }),
  ),
  meta: z.object({
    count: z.number(),
    limit: z.number(),
  }).partial().passthrough().optional().default({}),
})

const briefingResponseSchema = z.object({
  data: z.object({
    date: z.string(),
    summary: z.string(),
    event_count: z.number(),
    top_events: z.array(
      z.object({
        event_id: z.string(),
        magnitude: z.number(),
        place: z.string().nullable(),
        source: z.string().nullable(),
      }),
    ),
  }),
})

const connectorHealthResponseSchema = z.object({
  data: z.array(
    z.object({
      name: z.string(),
      status: z.enum(['ok', 'stale', 'error']),
      last_polled_at: z.string().nullable(),
      items_fetched: z.number(),
      error_message: z.string().nullable(),
      threshold_seconds: z.number(),
      updated_at: z.string().nullable(),
    }),
  ),
  meta: z.object({
    count: z.number(),
  }),
})

const pickTop = <T>(items: T[] | undefined, limit: number): T[] => (items ?? []).slice(0, limit)
const pickStrings = (items: unknown, limit: number): string[] =>
  Array.isArray(items) ? items.filter((item): item is string => typeof item === 'string').slice(0, limit) : []

export const getDashboardContextTool = createTool({
  id: 'get-dashboard-context',
  description:
    'Fetch dashboard context read-only dari API internal Reinsurance Risk Monitor untuk briefing dan analyst copilot.',
  inputSchema: z.object({
    includeNews: z.boolean().default(true),
    includeConnectorHealth: z.boolean().default(true),
  }),
  outputSchema: z.object({
    events: eventsResponseSchema,
    alerts: alertsResponseSchema,
    exposures: exposuresResponseSchema,
    riskScores: riskScoresResponseSchema,
    briefing: briefingResponseSchema,
    news: newsResponseSchema.optional(),
    connectorHealth: connectorHealthResponseSchema.optional(),
  }),
  execute: async ({ includeNews = true, includeConnectorHealth = true }) => {
    const [eventsRaw, alertsRaw, exposuresRaw, riskScoresRaw, briefing, newsRaw, connectorHealthRaw] = await Promise.all([
      fetchJson<any>(`${config.apiBaseUrl}/events`),
      fetchJson<any>(`${config.apiBaseUrl}/alerts`),
      fetchJson<any>(`${config.apiBaseUrl}/exposures`),
      fetchJson<any>(`${config.apiBaseUrl}/risk-scores`),
      fetchJson<z.infer<typeof briefingResponseSchema>>(`${config.apiBaseUrl}/briefings/today`),
      includeNews ? fetchJson<any>(`${config.apiBaseUrl}/news`) : Promise.resolve(undefined),
      includeConnectorHealth ? fetchJson<any>(`${config.apiBaseUrl}/health/connectors`) : Promise.resolve(undefined),
    ])

    const events = {
      data: pickTop(eventsRaw?.data, 5).map((item: any) => ({
        id: item.id,
        event_id: item.event_id,
        source: item.source,
        event_type: item.event_type,
        magnitude: item.magnitude,
        latitude: item.latitude,
        longitude: item.longitude,
        place: item.place,
        event_time: item.event_time,
        url: item.url ?? '',
        severity: item.severity ?? null,
        created_at: item.created_at,
      })),
      meta: {
        count: eventsRaw?.meta?.count ?? eventsRaw?.data?.length ?? 0,
        limit: 5,
      },
    }

    const alerts = {
      data: pickTop(alertsRaw?.data, 5).map((item: any) => ({
        id: item.id,
        event_id: item.event_id ?? null,
        source: item.source ?? null,
        place: item.place ?? null,
        magnitude: item.magnitude ?? null,
        event_time: item.event_time ?? null,
        alert_type: item.alert_type,
        severity: item.severity,
        message: item.message,
        acknowledged: item.acknowledged,
        created_at: item.created_at,
      })),
      meta: {
        count: alertsRaw?.meta?.count ?? alertsRaw?.data?.length ?? 0,
        unacknowledged: alertsRaw?.meta?.unacknowledged ?? 0,
      },
    }

    const exposures = {
      data: pickTop(exposuresRaw?.data, 5).map((item: any) => ({
        id: item.id,
        region_name: item.region_name,
        region_keywords: pickStrings(item.region_keywords, 5),
        total_exposure: item.total_exposure,
        treaty_category: item.treaty_category ?? null,
        risk_multiplier: item.risk_multiplier,
        is_active: item.is_active,
        created_at: item.created_at,
        updated_at: item.updated_at,
      })),
      meta: {
        count: exposuresRaw?.meta?.count ?? exposuresRaw?.data?.length ?? 0,
      },
    }

    const riskScores = {
      data: pickTop(riskScoresRaw?.data, 5).map((item: any) => ({
        entity_id: item.entity_id,
        score: item.score,
        factors: {
          severity: item.factors?.severity ?? null,
          magnitude: item.factors?.magnitude ?? null,
          base_score: item.factors?.base_score ?? null,
          estimated_impact: item.factors?.estimated_impact ?? null,
        },
        calculated_at: item.calculated_at,
        place: item.place,
        magnitude: item.magnitude,
        source: item.source,
      })),
      meta: {
        count: riskScoresRaw?.meta?.count ?? riskScoresRaw?.data?.length ?? 0,
        limit: 5,
      },
    }

    const news = newsRaw
      ? {
          data: pickTop(newsRaw?.data, 3).map((item: any) => ({
            id: item.id,
            item_id: item.item_id,
            source: item.source,
            title: item.title,
            summary: String(item.summary ?? '').slice(0, 240),
            url: item.url,
            published_at: item.published_at ?? null,
            perils: pickStrings(item.perils, 3),
            lat: item.lat ?? null,
            lon: item.lon ?? null,
            place_name: item.place_name ?? null,
            created_at: item.created_at,
          })),
          meta: {
            count: newsRaw?.meta?.count ?? newsRaw?.data?.length ?? 0,
            limit: 3,
          },
        }
      : undefined

    const connectorHealth = connectorHealthRaw
      ? {
          data: (connectorHealthRaw?.data ?? [])
            .filter((item: any) => item.status !== 'ok')
            .slice(0, 5)
            .map((item: any) => ({
              name: item.name,
              status: item.status,
              last_polled_at: item.last_polled_at ?? null,
              items_fetched: item.items_fetched ?? 0,
              error_message: item.error_message ?? null,
              threshold_seconds: item.threshold_seconds ?? 0,
              updated_at: item.updated_at ?? null,
            })),
          meta: {
            count: connectorHealthRaw?.meta?.count ?? connectorHealthRaw?.data?.length ?? 0,
          },
        }
      : undefined

    return {
      events,
      alerts,
      exposures,
      riskScores,
      briefing,
      ...(news ? { news } : {}),
      ...(connectorHealth ? { connectorHealth } : {}),
    }
  },
})
