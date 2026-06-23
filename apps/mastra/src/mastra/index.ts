import { Mastra } from '@mastra/core/mastra'
import { LibSQLStore } from '@mastra/libsql'

import { executiveBriefingAgent } from './agents/executive-briefing-agent'
import { analystCopilotAgent } from './agents/analyst-copilot-agent'
import { dailyBriefingWorkflow } from './workflows/daily-briefing-workflow'

const storageUrl = `file:${new URL('../../.mastra/mastra.db', import.meta.url).pathname}`

const storage = new LibSQLStore({
  id: 'rrm-mastra-store',
  url: storageUrl,
})

await storage.init()

export const mastra = new Mastra({
  agents: {
    executiveBriefingAgent,
    analystCopilotAgent,
  },
  workflows: {
    dailyBriefingWorkflow,
  },
  storage,
})
