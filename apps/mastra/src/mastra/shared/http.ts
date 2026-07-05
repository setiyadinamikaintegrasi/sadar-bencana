export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  // Attach internal bearer token for worker calls
  const workerToken = process.env.WORKER_API_TOKEN
  if (workerToken) {
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
