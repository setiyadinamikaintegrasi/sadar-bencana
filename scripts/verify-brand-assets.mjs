import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const expectedPng = new Map([
  ['apps/web/public/favicon-16x16.png', [16, 16]],
  ['apps/web/public/favicon-32x32.png', [32, 32]],
  ['apps/web/public/apple-touch-icon.png', [180, 180]],
  ['apps/web/public/icon-192.png', [192, 192]],
  ['apps/web/public/icon-512.png', [512, 512]],
  ['apps/web/public/og-sadarbencana.png', [1200, 630]],
])
const expectedSvg = [
  'apps/web/public/brand/logo-mark.svg',
  'apps/web/public/brand/logo-horizontal.svg',
  'apps/web/public/brand/logo-horizontal-tagline.svg',
  'apps/web/public/brand/logo-mark-mono.svg',
  'apps/web/public/brand/og-sadarbencana.svg',
  'apps/web/public/favicon.svg',
]

function pngSize(buffer) {
  const signature = buffer.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a') throw new Error('invalid PNG signature')
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)]
}

for (const path of expectedSvg) {
  const source = await readFile(resolve(root, path), 'utf8')
  if (!source.includes('<svg') || source.includes('#FF0000')) {
    throw new Error(`${path}: invalid SVG or forbidden red`)
  }
}

for (const [path, expected] of expectedPng) {
  const actual = pngSize(await readFile(resolve(root, path)))
  if (actual[0] !== expected[0] || actual[1] !== expected[1]) {
    throw new Error(`${path}: expected ${expected.join('x')}, got ${actual.join('x')}`)
  }
}

const ico = await readFile(resolve(root, 'apps/web/public/favicon.ico'))
if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1 || ico.readUInt16LE(4) < 2) {
  throw new Error('favicon.ico must contain at least two icon entries')
}

const manifest = JSON.parse(await readFile(resolve(root, 'apps/web/public/site.webmanifest'), 'utf8'))
if (manifest.name !== 'SadarBencana' || manifest.theme_color !== '#0B1222') {
  throw new Error('site.webmanifest brand metadata is invalid')
}
for (const src of ['/icon-192.png', '/icon-512.png']) {
  if (!manifest.icons?.some((icon) => icon.src === src)) throw new Error(`manifest missing ${src}`)
}

console.log('Brand assets verified')
