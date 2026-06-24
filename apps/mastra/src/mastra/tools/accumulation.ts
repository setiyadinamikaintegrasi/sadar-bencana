import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

import { config } from '../shared/config'
import { fetchJson } from '../shared/http'

const accumulationResultSchema = z.object({
  summary: z.object({
    sum_insured: z.number(),
    share_amount: z.number(),
    premium: z.number(),
    claim_amount: z.number(),
    count: z.number(),
  }),
  by_peril: z.array(
    z.object({ peril: z.string(), share_amount: z.number(), count: z.number() }),
  ),
})

export const getAccumulationTool = createTool({
  id: 'get-accumulation',
  description:
    'Hitung akumulasi eksposur portofolio dalam radius (km) dari satu titik (lat/lon): total sum insured, share/eksposur perusahaan, premi, klaim, jumlah kontrak, dan rincian per peril. Read-only. Gunakan koordinat event dari dashboard context.',
  inputSchema: z.object({
    lat: z.number(),
    lon: z.number(),
    radius_km: z.number().default(50),
    peril: z.string().optional(),
  }),
  outputSchema: accumulationResultSchema,
  execute: async ({ lat, lon, radius_km = 50, peril }) => {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      radius_km: String(radius_km),
    })
    if (peril) params.set('peril', peril)
    const res = await fetchJson<any>(`${config.apiBaseUrl}/accumulation?${params.toString()}`)
    return { summary: res.data.summary, by_peril: res.data.by_peril }
  },
})
