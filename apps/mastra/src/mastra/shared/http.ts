export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  // Never forward the Worker secret to the Go API or any other destination.
  const workerBaseUrl = (
    process.env.SADAR_WORKER_BASE_URL
    ?? 'http://127.0.0.1:8002/api/v1/worker'
  ).replace(/\/+$/, '')
  const isWorkerRequest = url === workerBaseUrl || url.startsWith(`${workerBaseUrl}/`)
  const workerToken = process.env.WORKER_API_TOKEN
  if (isWorkerRequest && workerToken) {
    headers['Authorization'] = `Bearer ${workerToken}`
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`HTTP ${response.status} ${response.statusText} :: ${body}`)
  }

  return (await response.json()) as T
}
