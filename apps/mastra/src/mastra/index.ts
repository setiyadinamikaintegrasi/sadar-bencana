import { timingSafeEqual } from 'node:crypto'
import { Mastra } from '@mastra/core/mastra'
import { LibSQLStore } from '@mastra/libsql'
import { chatRoute } from '@mastra/ai-sdk'

import { executiveBriefingAgent } from './agents/executive-briefing-agent'
import { analystCopilotAgent } from './agents/analyst-copilot-agent'
import { dailyBriefingWorkflow } from './workflows/daily-briefing-workflow'

const deploymentMode = (process.env.API_ENV ?? 'local').trim().toLowerCase()
const isProtectedMode = ['production', 'hosted', 'docker'].includes(deploymentMode)
const mastraApiToken = (process.env.MASTRA_API_TOKEN ?? '').trim()

if (isProtectedMode && mastraApiToken.length < 32) {
  throw new Error('MASTRA_API_TOKEN must contain at least 32 characters outside local development')
}

function tokenMatches(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided)
  const expectedBytes = Buffer.from(expected)
  return providedBytes.length === expectedBytes.length
    && timingSafeEqual(providedBytes, expectedBytes)
}

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
    cors: isProtectedMode ? false : undefined,
    middleware: mastraApiToken
      ? [
          async (context, next) => {
            if (context.req.path === '/health') {
              return next()
            }

            const authorization = context.req.header('Authorization') ?? ''
            const provided = authorization.startsWith('Bearer ')
              ? authorization.slice('Bearer '.length)
              : ''
            if (!tokenMatches(provided, mastraApiToken)) {
              return context.json({ error: 'unauthorized' }, 401)
            }

            return next()
          },
        ]
      : undefined,
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
