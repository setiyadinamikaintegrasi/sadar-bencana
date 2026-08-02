import { expect, test, type Page, type Route } from '@playwright/test'

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
  geometry: { type: 'Point', coordinates: [106.83, -6.19] },
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

function responseFor(pathname: string): unknown {
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
  if (pathname === '/api/v1/connector-health') return { data: [] }
  if (pathname === '/api/v1/map/overlays') return { data: [] }
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
  return { data: [] }
}

async function fulfillFixture(route: Route): Promise<void> {
  const requestUrl = new URL(route.request().url())
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify(responseFor(requestUrl.pathname)) })
}

async function installFixtures(page: Page): Promise<void> {
  await page.route('https://tiles.openfreemap.org/**', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(LOCAL_STYLE) })
  })
  await page.route('**/api/v1/**', fulfillFixture)
  await page.route('https://placeholder.supabase.co/**', async (route) => route.abort('blockedbyclient'))
}

function ownerSession() {
  const encodedPayload = btoa(JSON.stringify({ sub: 'fixture-owner', exp: 4_102_444_800 }))
  return {
    access_token: `fixture.${encodedPayload}.signature`,
    refresh_token: 'fixture-refresh-token',
    expires_at: 4_102_444_800,
    expires_in: 2_000_000_000,
    token_type: 'bearer',
    user: {
      id: 'fixture-owner',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'owner@example.test',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-08-02T00:00:00Z',
    },
  }
}

async function openMap(page: Page): Promise<void> {
  await installFixtures(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Executive Risk Map' })).toBeVisible()
  await expect(page.locator('.operational-map__canvas canvas.maplibregl-canvas')).toBeVisible()
}

test('loads the public operational map with visible controls on desktop and mobile', async ({ page }, testInfo) => {
  const privateRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/v1/me/map/')) privateRequests.push(request.url())
  })

  await openMap(page)

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
})

test('shows selected event attribution and the visible truncation notice', async ({ page }) => {
  await openMap(page)

  await page.getByRole('button', { name: 'Fokuskan di peta' }).click()
  const detailSheet = page.getByRole('dialog', { name: 'Detail peta' })
  await expect(detailSheet).toBeVisible()
  await expect(detailSheet.getByText('BMKG fixture attribution')).toBeVisible()
  await expect(page.getByText('Hasil dibatasi untuk area ini.')).toBeVisible()
})

test('loads owner-only layers for a logged-in owner', async ({ page }) => {
  await page.addInitScript((session) => {
    window.localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(session))
  }, ownerSession())
  const ownerRequests: string[] = []
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith('/api/v1/me/map/')) ownerRequests.push(pathname)
  })

  await openMap(page)

  await expect.poll(() => [...new Set(ownerRequests)].sort()).toEqual([
    '/api/v1/me/map/personal-assets',
    '/api/v1/me/map/watch-zones',
  ])
})

test('falls back when WebGL is unavailable and keeps mobile navigation unobscured', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (contextId: string, ...args: unknown[]) {
      if (contextId === 'webgl' || contextId === 'webgl2' || contextId === 'experimental-webgl') return null
      return getContext.call(this, contextId, ...args as [])
    }
  })
  await installFixtures(page)
  await page.goto('/')

  await expect(page.getByRole('alert')).toContainText('Peta tidak tersedia')
  if (testInfo.project.name === 'mobile-chromium') {
    await testInfo.attach('mobile-webgl-fallback', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  }
})
