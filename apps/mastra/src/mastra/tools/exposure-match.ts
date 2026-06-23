import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

import { config } from '../shared/config'
import { fetchJson } from '../shared/http'

const matchedExposureSchema = z.object({
  id: z.string(),
  region_name: z.string(),
  region_keywords: z.array(z.string()),
  total_exposure: z.number(),
  treaty_category: z.string().nullable().optional(),
  risk_multiplier: z.number(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  estimated_impact: z.number().nullable().optional(),
  matched_keyword: z.string().nullable().optional(),
  matched_place: z.string().nullable().optional(),
})

export const matchExposureTool = createTool({
  id: 'match-exposure',
  description: 'Cari exposure match untuk lokasi/event tertentu secara read-only.',
  inputSchema: z.object({
    place: z.string().min(2),
  }),
  outputSchema: z.object({
    data: z.array(matchedExposureSchema),
    meta: z.object({
      count: z.number(),
      place: z.string(),
    }),
  }),
  execute: async ({ place }) => {
    const params = new URLSearchParams({ place })
    return fetchJson(`${config.apiBaseUrl}/exposures/match?${params.toString()}`)
  },
})
