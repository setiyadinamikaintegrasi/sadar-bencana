import { Mastra } from '@mastra/core/mastra'
import { LibSQLStore } from '@mastra/libsql'
import { chatRoute } from '@mastra/ai-sdk'

import { executiveBriefingAgent } from './agents/executive-briefing-agent'
import { analystCopilotAgent } from './agents/analyst-copilot-agent'
import { dailyBriefingWorkflow } from './workflows/daily-briefing-workflow'

const storageUrl = `file:${new URL('../../.mastra/mastra.db', import.meta.url).pathname}`

const storage = new LibSQLStore({
  id: 'sadar-mastra-store',
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
  server: {
    apiRoutes: [
      chatRoute({
        path: '/chat/:agentId',
        sendStart: false,
        sendFinish: false,
        sendReasoning: false,
        sendSources: false,
      }),
    ],
  },
})
