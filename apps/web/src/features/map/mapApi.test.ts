import { afterEach, describe, expect, it, vi } from 'vitest'

const apiClient = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('../../lib/api/client', () => apiClient)

import { fetchPrivateMapLayer, fetchPublicMapLayer } from './mapApi'

const collection = (overrides: Record<string, unknown> = {}) => ({
  type: 'FeatureCollection',
  layer: 'events',
  truncated: false,
  features: [{
    type: 'Feature',
    id: 'bmkg:event-1',
    geometry: { type: 'Point', coordinates: [106.8, -6.2] },
    properties: {
      id: 'bmkg:event-1',
      layer: 'events',
      label: 'Jakarta',
      peril_type: 'earthquake',
      source: 'bmkg',
      attribution: 'BMKG',
      verification_status: 'source-reported',
      observed_at: '2026-08-02T00:00:00.000Z',
    },
  }],
  ...overrides,
})

const viewport = {
  bbox: [106.7, -6.4, 107.1, -6.0] as const,
  zoom: 8,
  mapTime: '2026-08-02T01:00:00.000Z',
  perils: ['earthquake', 'flood', 'earthquake'],
}

afterEach(() => {
  apiClient.request.mockReset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('fetchPrivateMapLayer', () => {
  it('uses the authenticated API transport for the fixed owner-only endpoint', async () => {
    const body = collection({
      layer: 'watch-zones',
      features: [{
        ...collection().features[0],
        id: 'zone-1',
        properties: {
          ...collection().features[0].properties,
          id: 'zone-1',
          layer: 'watch-zones',
          source: 'account',
          attribution: 'Private account data',
          verification_status: 'user-provided',
        },
      }],
    })
    apiClient.request.mockResolvedValue(body)
    const publicFetch = vi.spyOn(globalThis, 'fetch')

    await expect(fetchPrivateMapLayer('watch-zones', viewport)).resolves.toMatchObject({
      layer: 'watch-zones',
      state: 'ready',
      collection: body,
    })

    expect(apiClient.request).toHaveBeenCalledWith(
      '/me/map/watch-zones?bbox=106.7%2C-6.4%2C107.1%2C-6',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(publicFetch).not.toHaveBeenCalled()
  })

  it('does not request malformed viewports and rejects mismatched private collections', async () => {
    await expect(fetchPrivateMapLayer('personal-assets', {
      ...viewport,
      bbox: [107.1, -6.4, 106.7, -6],
    })).resolves.toEqual({ layer: 'personal-assets', state: 'unavailable' })
    expect(apiClient.request).not.toHaveBeenCalled()

    apiClient.request.mockResolvedValue(collection({ layer: 'events' }))
    await expect(fetchPrivateMapLayer('personal-assets', viewport)).resolves.toEqual({
      layer: 'personal-assets',
      state: 'unavailable',
    })
  })
})

describe('fetchPublicMapLayer', () => {
  it('uses the fixed public events endpoint with encoded, validated viewport filters and no bearer token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(collection()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await fetchPublicMapLayer('events', viewport)

    expect(result.state).toBe('ready')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/map/operations/events?bbox=106.7%2C-6.4%2C107.1%2C-6&zoom=8&from=2026-07-30T01%3A00%3A00.000Z&to=2026-08-02T01%3A00%3A00.000Z&perils=earthquake%2Cflood',
      expect.objectContaining({ method: 'GET' }),
    )
    const [, init] = fetchMock.mock.calls[0]
    expect(new Headers(init?.headers).get('Authorization')).toBeNull()
    expect(apiClient.request).not.toHaveBeenCalled()
  })

  it('maps the official-alert UI layer to the public alerts endpoint and sends an as-of time', async () => {
    const alerts = collection({
      layer: 'alerts',
      features: [{
        ...collection().features[0],
        properties: { ...collection().features[0].properties, layer: 'alerts' },
      }],
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(alerts), { status: 200 }))

    await fetchPublicMapLayer('official-alerts', viewport)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/map/operations/alerts?bbox=106.7%2C-6.4%2C107.1%2C-6&zoom=8&at=2026-08-02T01%3A00%3A00.000Z',
      expect.anything(),
    )
  })

  it('returns unavailable without requesting the network for an invalid viewport', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    const result = await fetchPublicMapLayer('events', {
      ...viewport,
      bbox: [107.1, -6.4, 106.7, -6.0],
      zoom: 19,
    })

    expect(result).toEqual({ layer: 'events', state: 'unavailable' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns unavailable for non-success responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"unavailable"}', { status: 503 }))

    await expect(fetchPublicMapLayer('evacuations', viewport)).resolves.toEqual({
      layer: 'evacuations',
      state: 'unavailable',
    })
  })

  it('returns empty for a valid empty collection', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(collection({ features: [] })), { status: 200 }))

    await expect(fetchPublicMapLayer('events', viewport)).resolves.toMatchObject({
      layer: 'events',
      state: 'empty',
      collection: expect.objectContaining({ features: [] }),
    })
  })

  it('marks a collection stale when its data vintage exceeds the public freshness window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-02T12:00:00.000Z')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(collection({
      layer: 'air-quality',
      features: [{
        ...collection().features[0],
        properties: {
          ...collection().features[0].properties,
          layer: 'air-quality',
          data_vintage: '2026-08-02T09:00:00.000Z',
        },
      }],
    })), { status: 200 }))

    await expect(fetchPublicMapLayer('air-quality', viewport)).resolves.toMatchObject({
      layer: 'air-quality',
      state: 'stale',
    })
  })

  it.each([
    ['malformed geometry', collection({ features: [{ ...collection().features[0], geometry: 'not-geojson' }] })],
    ['out-of-range geometry', collection({ features: [{ ...collection().features[0], geometry: { type: 'Point', coordinates: [190, -6.2] } }] })],
    ['wrong optional property type', collection({ features: [{ ...collection().features[0], properties: { ...collection().features[0].properties, category: { label: 'Sedang' } } }] })],
    ['impossible timestamp', collection({ features: [{ ...collection().features[0], properties: { ...collection().features[0].properties, observed_at: '2026-02-30T00:00:00Z' } }] })],
    ['wrong optional boolean', collection({ features: [{ ...collection().features[0], properties: { ...collection().features[0].properties, stale: 'false' } }] })],
  ])('returns unavailable for a 200 response with %s', async (_name, body) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))

    await expect(fetchPublicMapLayer('events', viewport)).resolves.toEqual({
      layer: 'events',
      state: 'unavailable',
    })
  })

  it.each([
    ['invalid JSON', () => new Response('{', { status: 200 })],
    ['an aborted request', () => new DOMException('Aborted', 'AbortError')],
  ])('returns unavailable for %s', async (_name, response) => {
    const value = response()
    if (value instanceof Response) vi.spyOn(globalThis, 'fetch').mockResolvedValue(value)
    else vi.spyOn(globalThis, 'fetch').mockRejectedValue(value)

    await expect(fetchPublicMapLayer('events', viewport)).resolves.toEqual({ layer: 'events', state: 'unavailable' })
  })

  it.each([
    ['volcano', 'volcano', '2026-05-04T12%3A00%3A00.000Z'],
    ['flood', 'flood', '2025-08-02T12%3A00%3A00.000Z'],
  ])('requests a wider historical window for %s events without a map time', async (_name, peril, fromEncoded) => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-02T12:00:00.000Z')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(collection()), { status: 200 }))

    await fetchPublicMapLayer('events', { bbox: viewport.bbox, zoom: 8, perils: [peril] })

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/map/operations/events?bbox=106.7%2C-6.4%2C107.1%2C-6&zoom=8&from=${fromEncoded}&to=2026-08-02T12%3A00%3A00.000Z&perils=${peril}`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('keeps the default 72-hour window for active perils without a map time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-02T12:00:00.000Z')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(collection()), { status: 200 }))

    await fetchPublicMapLayer('events', { bbox: viewport.bbox, zoom: 8, perils: ['earthquake'] })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/map/operations/events?bbox=106.7%2C-6.4%2C107.1%2C-6&zoom=8&perils=earthquake',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('requests the widest window when a combined filter includes flood', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-02T12:00:00.000Z')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(collection()), { status: 200 }))

    await fetchPublicMapLayer('events', { bbox: viewport.bbox, zoom: 8, perils: ['flood', 'volcano'] })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/map/operations/events?bbox=106.7%2C-6.4%2C107.1%2C-6&zoom=8&from=2025-08-02T12%3A00%3A00.000Z&to=2026-08-02T12%3A00%3A00.000Z&perils=flood%2Cvolcano',
      expect.objectContaining({ method: 'GET' }),
    )
  })
})
