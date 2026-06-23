import { createOpenAI } from '@ai-sdk/openai'

import { config } from './config'

const localOpenAI = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? 'local-dev-placeholder',
  baseURL: process.env.OPENAI_BASE_URL ?? 'http://127.0.0.1:8080/v1',
  name: 'local-openai-compatible',
})

export const localChatModel = localOpenAI.chat(config.model)
