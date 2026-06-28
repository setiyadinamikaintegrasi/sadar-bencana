export const config = {
  apiBaseUrl: process.env.SADAR_API_BASE_URL ?? 'http://127.0.0.1:8001/api/v1',
  workerBaseUrl: process.env.SADAR_WORKER_BASE_URL ?? 'http://127.0.0.1:8002/api/v1/worker',
  model:
    process.env.MASTRA_MODEL ?? 'Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf',
}
