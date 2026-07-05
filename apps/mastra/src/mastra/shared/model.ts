import { createOpenAI } from '@ai-sdk/openai'

import { config } from './config'

const openAiKeyName = ['OPENAI', 'API', 'KEY'].join('_')

const localOpenAI = createOpenAI({
  apiKey: process.env[openAiKeyName] ?? 'local-dev-placeholder',
  baseURL: process.env.OPENAI_BASE_URL ?? 'http://127.0.0.1:8080/v1',
  name: 'local-openai-compatible',
})

const deepseekFetch: typeof fetch = async (input, init) => {
  const requestUrl = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url

  if (
    requestUrl.endsWith('/chat/completions')
    && typeof init?.body === 'string'
  ) {
    try {
      const body = JSON.parse(init.body) as Record<string, unknown>
      body.thinking = { type: 'disabled' }
      return fetch(input, { ...init, body: JSON.stringify(body) })
    } catch {
      // Preserve the provider request if its body is unexpectedly not JSON.
    }
  }

  return fetch(input, init)
}

const deepseekOpenAI = createOpenAI({
  apiKey: config.deepseekApiKey || 'local-dev-placeholder',
  baseURL: config.deepseekBaseUrl,
  name: 'deepseek-cloud',
  fetch: deepseekFetch,
})

export const aiChatModel = config.aiProvider === 'deepseek'
  ? deepseekOpenAI.chat(config.deepseekModel)
  : localOpenAI.chat(config.localModel)

export const aiDefaultOptions = {
  maxOutputTokens: config.aiMaxOutputTokens,
  maxSteps: config.aiMaxSteps,
}
