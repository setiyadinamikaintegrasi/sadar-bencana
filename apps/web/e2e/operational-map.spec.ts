import { expect, test, type Page, type Route } from '@playwright/test'

const FIXTURE_ACCESS_TOKEN = 'fixture.eyJzdWIiOiJmaXh0dXJlLW93bmVyIiwiZXhwIjo0MTAyNDQ0ODAwfQ.signature'
const FIXTURE_BEARER_TOKEN = `Bearer ${FIXTURE_ACCESS_TOKEN}`
const FIXTURE_SUPABASE_STORAGE_KEY = 'sb-fixture-auth-token'
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
  if (pathname === '/api/v1/map/operations/shakemaps') return collection('shakemaps', [])
  if (pathname === '/api/v1/map/operations/flood-areas') return collection('flood-areas', [])
  if (pathname === '/api/v1/spatial/population-summary') {
    return {
      data: {
        population: 1234,
        cells: 4,
        dataset: { dataset: 'worldpop_population', vintage: '2020', resolution_m: 1000, attribution: 'WorldPop (CC BY 4.0)', ingested_at: '2026-08-20T00:00:00Z', feature_count: 2270281 },
      },
    }
  }
  if (pathname === '/api/v1/spatial/impact-score') {
    return { data: { event_id: 'x', peril_type: 'earthquake', magnitude: 5.6, radius_km: 30, score: 61.8, score_label: 'major', formula_version: 'risk-v2', components: { hazard_intensity: 0.52, exposure: 0.9 }, weights: {}, spatial: {}, fallbacks: {} } }
  }
  if (pathname === '/api/v1/spatial/elevation-summary') {
    return { data: { min_m: 2, max_m: 45, mean_m: 12.5, roughness_m: 8, steep_percent: 0, water_percent: 0, samples: 100, land_samples: 100 } }
  }
  if (pathname === '/api/v1/spatial/landcover-summary') {
    return { data: { total_samples: 10, classes: [{ class_code: 50, class: 'built_up', sample_count: 6, fraction: 0.6 }, { class_code: 10, class: 'tree_cover', sample_count: 4, fraction: 0.4 }] } }
  }
  if (pathname === '/api/v1/spatial/critical-facilities') {
    return { data: { origin: { latitude: 0, longitude: 0 }, radius_km: 30, counts: { rumah_sakit: 2 }, total: 2, truncated: false, facilities: [], attribution: 'OpenStreetMap contributors' } }
  }
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

function ownerSession() {
  return {
    access_token: FIXTURE_ACCESS_TOKEN,
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

async function openMap(page: Page): Promise<FixtureState> {
  const fixtures = await installFixtures(page)
  // Denyut severity (blink JS di OperationalMap) dinonaktifkan agar snapshot
  // visual deterministik; produk tetap menghormati prefers-reduced-motion.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  // Bekukan jam: label timeline replay (menit saat ini) membuat snapshot
  // berubah tiap menit — deterministik dengan clock tetap.
  await page.addInitScript(() => {
    const FIXED = 1787000000000
    const RealDate = Date
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...args: ConstructorParameters<typeof RealDate>) {
        if (args.length === 0) {
          super(FIXED)
        } else {
          super(...args)
        }
      }
      static now() {
        return FIXED
      }
    }
  })
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

test('shows selected event attribution and the visible truncation notice', async ({ page }, testInfo) => {
  const fixtures = await openMap(page)

  await page.getByRole('button', { name: 'Fokuskan di peta' }).click()
  const detailSheet = page.getByRole('dialog', { name: 'Detail peta' })
  await expect(detailSheet).toBeVisible()
  await expect(detailSheet.getByText('BMKG fixture attribution')).toBeVisible()
  await expect(page.getByText('Hasil dibatasi untuk area ini.')).toBeVisible()

  // Popup detail ringkas di desktop: lebar <= 280px dan <= 30% area peta.
  // (Mobile memakai bottom-sheet selebar layar — hanya cek porsi tinggi.)
  const sheetBounds = await detailSheet.boundingBox()
  const mapBounds = await page.locator('.operational-map__canvas').boundingBox()
  expect(sheetBounds).not.toBeNull()
  expect(mapBounds).not.toBeNull()
  if (testInfo.project.name === 'desktop-chromium') {
    expect(sheetBounds!.width).toBeLessThanOrEqual(280)
    expect((sheetBounds!.width * sheetBounds!.height) / (mapBounds!.width * mapBounds!.height)).toBeLessThanOrEqual(0.3)
  } else {
    // Bottom-sheet mobile: selebar layar, tinggi dibatasi ~32% peta.
    expect((sheetBounds!.width * sheetBounds!.height) / (mapBounds!.width * mapBounds!.height)).toBeLessThanOrEqual(0.35)
  }

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

test('downloads the current map view as a PNG snapshot with attribution footer', async ({ page }) => {
  await openMap(page)

  // Tombol unduh ada di panel legenda (di luar <details> agar tetap terlihat
  // saat legenda diringkas di layar kecil).
  const button = page.getByRole('button', { name: 'Unduh peta (PNG)' })
  await expect(button).toBeVisible()

  // Ukuran kanvas sebelum unduhan — untuk membuktikan footer ikut terbakar.
  const metrics = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.maplibregl-canvas') as HTMLCanvasElement | null
    if (!canvas) return null
    return { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth }
  })
  expect(metrics).not.toBeNull()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    button.click(),
  ])

  // Nama file: sadar-bencana-peta-YYYY-MM-DD-HHMM.png (jam lokal runner).
  expect(download.suggestedFilename()).toMatch(/^sadar-bencana-peta-\d{4}-\d{2}-\d{2}-\d{4}\.png$/)

  // File terunduh adalah PNG valid: magic byte + dimensi persis
  // (kanvas peta + footer atribusi 44px CSS × rasio perangkat).
  const { readFile } = await import('node:fs/promises')
  const bytes = await readFile(await download.path()!)
  expect(bytes.byteLength).toBeGreaterThan(1_000)
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  const footerHeight = Math.round(44 * metrics!.width / metrics!.clientWidth)
  expect(width).toBe(metrics!.width)
  expect(height).toBe(metrics!.height + footerHeight)
})

test('shows an impact summary panel with population and facilities for a selected event', async ({ page }) => {
  await openMap(page)

  // Buka detail event pertama (event fixture di Jakarta).
  await page.getByRole('button', { name: 'Fokuskan di peta' }).click()
  const sheet = page.getByRole('dialog', { name: 'Detail peta' })
  await expect(sheet).toBeVisible()

  // Panel dampak S1+S2: populasi + fasilitas kritis radius 30 km.
  const panel = page.locator('.operational-map__impact-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Estimasi dampak · area 30 km')
  await expect(panel).toContainText('62')
  await expect(panel).toContainText('Skor dampak · Besar')
  await expect(panel).toContainText('1.234 jiwa')
  await expect(panel).toContainText('Rumah sakit: 2')
  await expect(panel).toContainText('Kawasan terbangun: 60%')
  await expect(panel).toContainText('Medan')
  await expect(panel).toContainText('2–45 m · datar')
  await expect(panel).toContainText('WorldPop · OSM · ESA WorldCover · SRTM')
})

test('loads owner-only layers for a logged-in owner', async ({ page }) => {
  await page.addInitScript((session) => {
    window.localStorage.setItem('sb-fixture-auth-token', JSON.stringify(session))
  }, ownerSession())
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
  // Snapshot deterministik: tanpa animasi CSS/JS severity.
  await page.emulateMedia({ reducedMotion: 'reduce' })
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
