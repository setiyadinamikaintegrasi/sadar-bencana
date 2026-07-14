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
const approvedPalette = new Set(['#7C8CFF', '#69B7FF', '#39D6B0', '#FFB44A', '#0B1222'])
const monoLogoPath = 'apps/web/public/brand/logo-mark-mono.svg'
const visibleShapeElement = /<(circle|ellipse|line|path|polygon|polyline|rect|text)\b([^>]*)>/gi
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex')
const expectedText = new Map([
  ['apps/web/public/brand/logo-mark.svg', []],
  ['apps/web/public/brand/logo-horizontal.svg', ['SadarBencana']],
  ['apps/web/public/brand/logo-horizontal-tagline.svg', ['SadarBencana', 'Pantau. Pahami. Siaga.']],
  ['apps/web/public/brand/logo-mark-mono.svg', []],
  ['apps/web/public/brand/og-sadarbencana.svg', ['SadarBencana', 'Pantau. Pahami. Siaga.', 'Monitoring dan kesiapsiagaan bencana']],
  ['apps/web/public/favicon.svg', []],
])

function pngSize(buffer) {
  const signature = buffer.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a') throw new Error('invalid PNG signature')
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)]
}

function validatePaintAttributes(path, source) {
  if (/<style\b/i.test(source)) throw new Error(`${path}: SVG style blocks are not allowed`)
  if (/\sstyle\s*=/i.test(source)) throw new Error(`${path}: SVG inline style attributes are not allowed`)
  if (/<\/?\s*[A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*/.test(source)) {
    throw new Error(`${path}: namespace-prefixed SVG element tags are not allowed`)
  }

  const paintAttribute = /\s(fill|stroke)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
  for (const match of source.matchAll(paintAttribute)) {
    const paint = match[2] ?? match[3] ?? match[4]
    const isApprovedHex = approvedPalette.has(paint.toUpperCase())
    const normalizedPaint = paint.toLowerCase()
    const isCurrentColor = normalizedPaint === 'currentcolor'
    if (!isApprovedHex && normalizedPaint !== 'none' && (!isCurrentColor || path !== monoLogoPath)) {
      throw new Error(`${path}: unapproved ${match[1]} paint ${paint}`)
    }
  }

  for (const match of source.matchAll(visibleShapeElement)) {
    const attributes = match[2]
    if (!/\sfill\s*=/i.test(attributes) && !/\sstroke\s*=/i.test(attributes)) {
      throw new Error(`${path}: <${match[1]}> must declare fill or stroke explicitly`)
    }
  }
}

function extractTextNodes(source) {
  const textNodes = []
  const textElement = /<text\b[^>]*(?:\/>|>([\s\S]*?)<\/text\s*>)/gi

  for (const match of source.matchAll(textElement)) {
    const value = match[1] ?? ''
    if (/[<>]/.test(value)) throw new Error('SVG text nodes must contain plain text only')
    textNodes.push(value.trim())
  }

  return textNodes
}

function icoPayloadDimensions(payload, index) {
  if (payload.length >= 8 && payload.subarray(0, 8).equals(pngSignature)) {
    if (payload.length < 24 || payload.readUInt32BE(8) !== 13 || payload.subarray(12, 16).toString('ascii') !== 'IHDR') {
      throw new Error(`favicon.ico frame ${index + 1} has a truncated PNG payload`)
    }

    return [payload.readUInt32BE(16), payload.readUInt32BE(20)]
  }

  if (payload.length < 40) throw new Error(`favicon.ico frame ${index + 1} has an unsupported payload format`)

  const headerSize = payload.readUInt32LE(0)
  if (headerSize < 40 || headerSize > payload.length) {
    throw new Error(`favicon.ico frame ${index + 1} has an invalid DIB header`)
  }

  const width = payload.readInt32LE(4)
  const storedHeight = payload.readInt32LE(8)
  if (width <= 0 || storedHeight === 0 || Math.abs(storedHeight) % 2 !== 0) {
    throw new Error(`favicon.ico frame ${index + 1} has invalid DIB dimensions`)
  }

  return [width, Math.abs(storedHeight) / 2]
}

function validateIco(ico) {
  if (ico.length < 6 || ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) {
    throw new Error('favicon.ico has an invalid ICO header')
  }

  const count = ico.readUInt16LE(4)
  if (count !== 2) throw new Error(`favicon.ico must contain exactly two icon entries, got ${count}`)
  const directoryEnd = 6 + count * 16
  if (ico.length < directoryEnd) throw new Error('favicon.ico directory is truncated')

  const frames = []
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16
    const width = ico[offset] || 256
    const height = ico[offset + 1] || 256
    const imageSize = ico.readUInt32LE(offset + 8)
    const imageOffset = ico.readUInt32LE(offset + 12)
    const imageEnd = imageOffset + imageSize

    if (imageSize === 0) throw new Error(`favicon.ico frame ${index + 1} has zero size`)
    if (imageOffset < directoryEnd) throw new Error(`favicon.ico frame ${index + 1} starts inside the directory`)
    if (imageOffset > ico.length || imageEnd > ico.length) {
      throw new Error(`favicon.ico frame ${index + 1} is outside the file`)
    }
    const payloadDimensions = icoPayloadDimensions(ico.subarray(imageOffset, imageEnd), index)
    if (payloadDimensions[0] !== width || payloadDimensions[1] !== height) {
      throw new Error(`favicon.ico frame ${index + 1} payload dimensions ${payloadDimensions.join('x')} do not match directory dimensions ${width}x${height}`)
    }
    frames.push({ imageOffset, imageEnd, width, height })
  }

  const orderedFrames = [...frames].sort((left, right) => left.imageOffset - right.imageOffset)
  for (let index = 1; index < orderedFrames.length; index += 1) {
    if (orderedFrames[index].imageOffset < orderedFrames[index - 1].imageEnd) {
      throw new Error('favicon.ico frame payload ranges overlap')
    }
  }

  const dimensions = frames.map(({ width, height }) => [width, height])
  dimensions.sort(([leftWidth, leftHeight], [rightWidth, rightHeight]) => leftWidth - rightWidth || leftHeight - rightHeight)
  if (dimensions.length !== 2 || dimensions[0][0] !== 16 || dimensions[0][1] !== 16 || dimensions[1][0] !== 32 || dimensions[1][1] !== 32) {
    throw new Error(`favicon.ico frames must be 16x16 and 32x32, got ${dimensions.map((size) => size.join('x')).join(', ')}`)
  }
}

for (const path of expectedSvg) {
  const source = await readFile(resolve(root, path), 'utf8')
  if (!source.includes('<svg')) throw new Error(`${path}: invalid SVG`)

  validatePaintAttributes(path, source)

  if (source.includes('<text') && !/font-family="Inter,\s*system-ui,\s*sans-serif"/.test(source)) {
    throw new Error(`${path}: SVG text must prefer the bundled Inter family`)
  }
  const actualText = extractTextNodes(source)
  const requiredText = expectedText.get(path)
  if (JSON.stringify(actualText) !== JSON.stringify(requiredText)) {
    throw new Error(`${path}: expected text nodes ${JSON.stringify(requiredText)}, got ${JSON.stringify(actualText)}`)
  }
}

for (const path of [
  'apps/web/public/brand/fonts/Inter-Variable.ttf',
  'apps/web/public/brand/fonts/Inter-OFL.txt',
]) await readFile(resolve(root, path))

for (const [path, expected] of expectedPng) {
  const actual = pngSize(await readFile(resolve(root, path)))
  if (actual[0] !== expected[0] || actual[1] !== expected[1]) {
    throw new Error(`${path}: expected ${expected.join('x')}, got ${actual.join('x')}`)
  }
}

const ico = await readFile(resolve(root, 'apps/web/public/favicon.ico'))
validateIco(ico)

const manifest = JSON.parse(await readFile(resolve(root, 'apps/web/public/site.webmanifest'), 'utf8'))
if (manifest.name !== 'SadarBencana' || manifest.theme_color !== '#0B1222') {
  throw new Error('site.webmanifest brand metadata is invalid')
}
for (const src of ['/icon-192.png', '/icon-512.png']) {
  if (!manifest.icons?.some((icon) => icon.src === src)) throw new Error(`manifest missing ${src}`)
}

console.log('Brand assets verified')
