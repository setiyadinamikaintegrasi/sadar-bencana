import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

import { config } from '../shared/config'
import { fetchJson } from '../shared/http'

export const generateWorkerBriefingTool = createTool({
  id: 'generate-worker-briefing',
  description:
    'Trigger briefings generation pada worker FastAPI untuk mendapatkan context briefing terbaru dari pipeline existing.',
  inputSchema: z.object({
    force: z.boolean().default(false),
  }),
  outputSchema: z.object({
    ok: z.boolean().optional(),
    status: z.string().optional(),
    message: z.string().optional(),
  }).passthrough(),
  execute: async ({ force = false }) => {
    return fetchJson(`${config.workerBaseUrl}/briefings/generate`, {
      method: 'POST',
      body: JSON.stringify({ force: force ?? false }),
    })
  },
})
