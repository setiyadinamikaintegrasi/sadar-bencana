import { expect, test, type Page, type Route } from '@playwright/test'

const FIXTURE_ACCESS_TOKEN = 'fixture.eyJzdWIiOiJmaXh0dXJlLW93bmVyIiwiZXhwIjo0MTAyNDQ0ODAwfQ.signature'
const FIXTURE_BEARER_TOKEN = `Bearer ${FIXTURE_ACCESS_TOKEN}`
const AUTH_TOKEN_STORAGE_KEY = 'sadar_auth_token'
const LOCAL_ORIGIN = 'http://127.0.0.1:4173'
const FIXTURE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

const LOCAL_STYLE = {
  version: 8,
  sources: {},
  layers: [
    {
      id: 'local-background',
      type: 'background',
      paint: { 'background-color': '#d7f0ec' },
    },
  ],
}

const eventFeature = {
  type: 'Feature',
  id: 'bmkg:fixture-earthquake',
  geometry: { type: 'Point', coordinates: [106.8456, -6.2088] },
  properties: {
    id: 'bmkg:fixture-earthquake',
    layer: 'events',
    label: 'Gempa uji Jakarta',
    peril_type: 'earthquake',
    severity: 'high',
    source: 'bmkg',
    attribution: 'BMKG fixture attribution',
    source_url: 'https://www.bmkg.go.id/',
    verification_status: 'official',
    observed_at: '2026-08-02T03:00:00Z',
    data_vintage: '2026-08-02T03:00:00Z',
  },
}

const privateFeature = (layer: 'watch-zones' | 'personal-assets') => ({
  type: 'Feature',
  id: `${layer}:fixture-owner`,
  geometry: { type: 'Point', coordinates: [118, -2.5] },
  properties: {
    id: `${layer}:fixture-owner`,
    layer,
    label: layer === 'watch-zones' ? 'Zona pantau pemilik' : 'Aset pemilik',
    source: 'account',
    attribution: 'Owner-only local fixture',
    verification_status: 'user-provided',
  },
})

function collection(layer: string, features: unknown[], truncated = false) {
  return { type: 'FeatureCollection', layer, features, truncated }
}

function responseFor(pathname: string): unknown | undefined {
  if (pathname === '/api/v1/auth/me') {
    return {
      data: {
        id: 'fixture-owner',
        email: 'owner@example.test',
        role: 'user',
      },
    }
  }
  if (pathname === '/api/v1/events') {
    return {
      data: [{
        id: 'fixture-event-record',
        event_id: 'fixture-earthquake',
        source: 'bmkg',
        event_type: 'earthquake',
        magnitude: 5.6,
        latitude: -6.2088,
        longitude: 106.8456,
        place: 'Jakarta (tidak berpotensi tsunami)',
        event_time: '2026-08-02T03:00:00Z',
        url: 'https://www.bmkg.go.id/',
        severity: 'High',
        created_at: '2026-08-02T03:00:00Z',
      }],
      meta: { count: 1, limit: 100 },
    }
  }
  if (pathname === '/api/v1/meta') {
    return {
      data: {
        service: 'api', version: 'fixture', environment: 'test', risk_free_limit: 0,
        deployment_mode: 'community', personal_asset_limit: 5, endpoints: [],
      },
    }
  }
  if (pathname === '/api/v1/alerts') return { data: [], meta: { count: 0, unacknowledged: 0 } }
  if (pathname === '/api/v1/risk-scores') return { data: [], meta: { count: 0, limit: 0 } }
  if (pathname === '/api/v1/health/connectors') return { data: [] }
  if (pathname === '/api/v1/map/overlays') return { data: [] }
  if (pathname === '/api/v1/map/overlays/me') return { data: [] }
  if (pathname === '/api/v1/news') return { data: [], meta: { count: 0, limit: 0 } }
  if (pathname === '/api/v1/official-alerts') return { data: [] }
  if (pathname === '/api/v1/air-quality/observations') {
    return { data: [], meta: { count: 0, limit: 0, latest: true, source_active: true } }
  }
  if (pathname === '/api/v1/map/operations/events') return collection('events', [eventFeature])
  if (pathname === '/api/v1/map/operations/alerts') return collection('alerts', [], true)
  if (pathname === '/api/v1/map/operations/air-quality') return collection('air-quality', [])
  if (pathname === '/api/v1/me/map/watch-zones') return collection('watch-zones', [privateFeature('watch-zones')])
  if (pathname === '/api/v1/me/map/personal-assets') return collection('personal-assets', [privateFeature('personal-assets')])
  return undefined
}

type FixtureState = {
  deniedRequests: string[]
  privateAuthorizations: string[]
  rejectedPrivateRequests: string[]
  unknownApiPaths: string[]
}

async function installFixtures(page: Page): Promise<FixtureState> {
  const state: FixtureState = {
    deniedRequests: [],
    privateAuthorizations: [],
    rejectedPrivateRequests: [],
    unknownApiPaths: [],
  }

  await page.route('**/*', async (route: Route) => {
    const requestUrl = new URL(route.request().url())
    if (requestUrl.origin === LOCAL_ORIGIN) {
      if (!requestUrl.pathname.startsWith('/api/v1/')) {
        await route.continue()
        return
      }

      const response = responseFor(requestUrl.pathname)
      if (response === undefined) {
        state.unknownApiPaths.push(requestUrl.pathname)
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'unknown fixture API request' }) })
        return
      }

      if (requestUrl.pathname.startsWith('/api/v1/me/map/')) {
        const authorization = route.request().headers().authorization
        if (authorization !== FIXTURE_BEARER_TOKEN) {
          state.rejectedPrivateRequests.push(requestUrl.pathname)
          await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'fixture authentication required' }) })
          return
        }
        state.privateAuthorizations.push(authorization)
      }

      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) })
      return
    }

    if (requestUrl.href === FIXTURE_STYLE_URL) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(LOCAL_STYLE) })
      return
    }

    state.deniedRequests.push(requestUrl.href)
    await route.abort('blockedbyclient')
  })
  return state
}

function expectKnownApiRequests(state: FixtureState): void {
  expect(state.unknownApiPaths).toEqual([])
}

function ownerToken() {
  // Token JWT lokal (auth mandiri): cukup raw string di localStorage.
  return FIXTURE_ACCESS_TOKEN
}

async function openMap(page: Page): Promise<FixtureState> {
  const fixtures = await installFixtures(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Executive Risk Map' })).toBeVisible()
  await expect(page.locator('.operational-map__canvas canvas.maplibregl-canvas')).toBeVisible()
  return fixtures
}

test('loads the public operational map with visible controls on desktop and mobile', async ({ page }, testInfo) => {
  const privateRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/v1/me/map/')) privateRequests.push(request.url())
  })

  const fixtures = await openMap(page)

  await expect(page.getByRole('complementary', { name: 'Lapisan peta' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Gempa \(1\)/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Watch zone' })).toBeVisible()
  await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible()
  if (testInfo.project.name === 'mobile-chromium') {
    const controls = await page.locator('.maplibregl-ctrl-top-right').boundingBox()
    const navigation = await page.getByRole('navigation', { name: 'Navigasi mobile' }).boundingBox()
    expect(controls).not.toBeNull()
    expect(navigation).not.toBeNull()
    expect((controls?.y ?? 0) + (controls?.height ?? 0)).toBeLessThanOrEqual(navigation?.y ?? 0)
  }
  await expect(page.locator('.operational-map__canvas')).toHaveScreenshot(`${testInfo.project.name}-public-map.png`)
  expect(privateRequests).toEqual([])
  expectKnownApiRequests(fixtures)
})

test('shows selected event attribution and the visible truncation notice', async ({ page }) => {
  const fixtures = await openMap(page)

  await page.getByRole('button', { name: 'Fokuskan di peta' }).click()
  const detailSheet = page.getByRole('dialog', { name: 'Detail peta' })
  await expect(detailSheet).toBeVisible()
  await expect(detailSheet.getByText('BMKG fixture attribution')).toBeVisible()
  await expect(page.getByText('Hasil dibatasi untuk area ini.')).toBeVisible()
  expectKnownApiRequests(fixtures)
})

test('rejects private map feeds without the exact fixture bearer token', async ({ page }) => {
  const fixtures = await openMap(page)

  const status = await page.evaluate(async () => {
    const response = await fetch('/api/v1/me/map/watch-zones')
    return response.status
  })

  expect(status).toBe(401)
  expect(fixtures.rejectedPrivateRequests).toEqual(['/api/v1/me/map/watch-zones'])
  expectKnownApiRequests(fixtures)
})

test('loads owner-only layers for a logged-in owner', async ({ page }) => {
  await page.addInitScript((token) => {
    window.localStorage.setItem('sadar_auth_token', token)
  }, ownerToken())
  const ownerRequests: string[] = []
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith('/api/v1/me/map/')) ownerRequests.push(pathname)
  })

  const fixtures = await openMap(page)

  await expect.poll(() => [...new Set(ownerRequests)].sort()).toEqual([
    '/api/v1/me/map/personal-assets',
    '/api/v1/me/map/watch-zones',
  ])
  expect(fixtures.privateAuthorizations).toEqual([FIXTURE_BEARER_TOKEN, FIXTURE_BEARER_TOKEN])

  const canvas = page.locator('.operational-map__canvas canvas.maplibregl-canvas')
  await canvas.scrollIntoViewIfNeeded()
  const bounds = await canvas.boundingBox()
  expect(bounds).not.toBeNull()
  await canvas.click({
    position: { x: (bounds?.width ?? 0) / 2, y: (bounds?.height ?? 0) / 2 },
    force: true,
  })
  await expect(page.getByRole('dialog', { name: 'Detail peta' })).toContainText('Aset pemilik')
  expectKnownApiRequests(fixtures)
})

test('falls back when WebGL is unavailable and keeps mobile navigation unobscured', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (contextId: string, ...args: unknown[]) {
      if (contextId === 'webgl' || contextId === 'webgl2' || contextId === 'experimental-webgl') return null
      return getContext.call(this, contextId, ...args as [])
    }
  })
  const fixtures = await installFixtures(page)
  await page.goto('/')

  const fallback = page.getByRole('alert')
  await expect(fallback).toContainText('Peta tidak tersedia')
  if (testInfo.project.name === 'mobile-chromium') {
    await fallback.scrollIntoViewIfNeeded()
    const fallbackBounds = await fallback.boundingBox()
    const navigationBounds = await page.getByRole('navigation', { name: 'Navigasi mobile' }).boundingBox()
    expect(fallbackBounds).not.toBeNull()
    expect(navigationBounds).not.toBeNull()
    expect((fallbackBounds?.y ?? 0) + (fallbackBounds?.height ?? 0)).toBeLessThanOrEqual((navigationBounds?.y ?? 0) - 8)
    await expect(fallback).toHaveScreenshot('mobile-webgl-fallback.png')
  }
  expectKnownApiRequests(fixtures)
})
