import { createOpenAI } from '@ai-sdk/openai'

import { config } from './config'

const openAiKeyName = ['OPENAI', 'API', 'KEY'].join('_')
const deepseekKeyName = ['DEEPSEEK', 'API', 'KEY'].join('_')

const localOpenAI = createOpenAI({
  apiKey: process.env[openAiKeyName] ?? 'local-dev-placeholder',
  baseURL: process.env.OPENAI_BASE_URL ?? 'http://127.0.0.1:8080/v1',
  name: 'local-openai-compatible',
})

export const localChatModel = localOpenAI.chat(config.model)

// Cloud model untuk agent yang butuh respons cepat (copilot interaktif)
// DeepSeek via OpenAI-compatible endpoint
const cloudOpenAI = createOpenAI({
  apiKey: process.env[deepseekKeyName] ?? '',
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  name: 'deepseek-cloud',
})

export const cloudChatModel = cloudOpenAI.chat('deepseek-chat')
