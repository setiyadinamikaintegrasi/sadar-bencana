const deploymentMode = (process.env.API_ENV ?? 'local').trim().toLowerCase()
const isHostedMode = ['hosted', 'production'].includes(deploymentMode)
const defaultProvider = isHostedMode ? 'deepseek' : 'local'
const aiProvider = (process.env.MASTRA_AI_PROVIDER ?? defaultProvider).trim().toLowerCase()
const deepseekApiKey = (process.env.DEEPSEEK_API_KEY ?? '').trim()
const deepseekBaseUrl = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1')
  .trim()
  .replace(/\/+$/, '')
const deepseekModel = (process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash').trim()

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = (process.env[name] ?? '').trim()
  const value = raw === '' ? fallback : Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

const aiMaxOutputTokens = boundedInteger('MASTRA_AI_MAX_OUTPUT_TOKENS', 2048, 256, 8192)
const aiMaxSteps = boundedInteger('MASTRA_AI_MAX_STEPS', 6, 1, 10)

if (!['deepseek', 'local'].includes(aiProvider)) {
  throw new Error('MASTRA_AI_PROVIDER must be either "deepseek" or "local"')
}

if (aiProvider === 'deepseek' && isHostedMode) {
  if (!deepseekApiKey.startsWith('sk-') || deepseekApiKey.length < 20) {
    throw new Error('DEEPSEEK_API_KEY must contain a valid sk- API key in hosted mode')
  }
  if (!['deepseek-v4-flash', 'deepseek-v4-pro'].includes(deepseekModel)) {
    throw new Error('DEEPSEEK_MODEL must be deepseek-v4-flash or deepseek-v4-pro')
  }

  const deepseekUrl = new URL(deepseekBaseUrl)
  if (deepseekUrl.protocol !== 'https:' || deepseekUrl.hostname !== 'api.deepseek.com') {
    throw new Error('DEEPSEEK_BASE_URL must use the official https://api.deepseek.com endpoint')
  }
}

export const config = {
  deploymentMode,
  aiProvider,
  apiBaseUrl: process.env.SADAR_API_BASE_URL ?? 'http://127.0.0.1:8001/api/v1',
  workerBaseUrl: process.env.SADAR_WORKER_BASE_URL ?? 'http://127.0.0.1:8002/api/v1/worker',
  localModel:
    process.env.MASTRA_MODEL ?? 'Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf',
  deepseekApiKey,
  deepseekBaseUrl,
  deepseekModel,
  aiMaxOutputTokens,
  aiMaxSteps,
}
