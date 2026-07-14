import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const repoRoot = resolve(import.meta.dirname, '..')
const verifierPath = 'scripts/verify-brand-assets.mjs'
const publicPath = 'apps/web/public'
const svgMasters = [
  ['brand/logo-mark.svg', 'fill="#0B1222"'],
  ['brand/logo-horizontal.svg', 'fill="#0B1222"'],
  ['brand/logo-horizontal-tagline.svg', 'fill="#0B1222"'],
  ['brand/logo-mark-mono.svg', 'fill="currentColor"'],
  ['brand/og-sadarbencana.svg', 'fill="#0B1222"'],
  ['favicon.svg', 'fill="#0B1222"'],
]

async function withFixture(mutate) {
  const fixture = await mkdtemp(join(tmpdir(), 'verify-brand-assets-'))
  const fixtureRoot = join(fixture, 'repo')

  try {
    await cp(join(repoRoot, verifierPath), join(fixtureRoot, verifierPath))
    await cp(join(repoRoot, publicPath), join(fixtureRoot, publicPath), { recursive: true })
    await mutate(fixtureRoot)

    return spawnSync(process.execPath, [join(fixtureRoot, verifierPath)], {
      encoding: 'utf8',
    })
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
}

async function replaceInFixture(root, relativePath, from, to) {
  const path = join(root, publicPath, relativePath)
  const source = await readFile(path, 'utf8')
  assert.ok(source.includes(from), `${relativePath} did not contain ${from}`)
  await writeFile(path, source.replace(from, to))
}

function expectRejected(result, message) {
  assert.notEqual(result.status, 0, `validator accepted ${message}`)
}

function buildDibIco(frameDimensions) {
  const directoryEnd = 6 + frameDimensions.length * 16
  const payloadSize = 40
  const ico = Buffer.alloc(directoryEnd + frameDimensions.length * payloadSize)

  ico.writeUInt16LE(0, 0)
  ico.writeUInt16LE(1, 2)
  ico.writeUInt16LE(frameDimensions.length, 4)

  for (const [index, [width, height]] of frameDimensions.entries()) {
    const directoryOffset = 6 + index * 16
    const payloadOffset = directoryEnd + index * payloadSize

    ico[directoryOffset] = width
    ico[directoryOffset + 1] = height
    ico.writeUInt16LE(1, directoryOffset + 4)
    ico.writeUInt16LE(32, directoryOffset + 6)
    ico.writeUInt32LE(payloadSize, directoryOffset + 8)
    ico.writeUInt32LE(payloadOffset, directoryOffset + 12)

    ico.writeUInt32LE(40, payloadOffset)
    ico.writeInt32LE(width, payloadOffset + 4)
    ico.writeInt32LE(height * 2, payloadOffset + 8)
    ico.writeUInt16LE(1, payloadOffset + 12)
    ico.writeUInt16LE(32, payloadOffset + 14)
  }

  return ico
}

function buildPngIco(directoryDimensions, payloadDimensions = directoryDimensions) {
  const directoryEnd = 6 + directoryDimensions.length * 16
  const payloadSize = 24
  const ico = Buffer.alloc(directoryEnd + directoryDimensions.length * payloadSize)

  ico.writeUInt16LE(0, 0)
  ico.writeUInt16LE(1, 2)
  ico.writeUInt16LE(directoryDimensions.length, 4)

  for (const [index, [width, height]] of directoryDimensions.entries()) {
    const directoryOffset = 6 + index * 16
    const payloadOffset = directoryEnd + index * payloadSize
    const [payloadWidth, payloadHeight] = payloadDimensions[index]

    ico[directoryOffset] = width
    ico[directoryOffset + 1] = height
    ico.writeUInt16LE(1, directoryOffset + 4)
    ico.writeUInt16LE(32, directoryOffset + 6)
    ico.writeUInt32LE(payloadSize, directoryOffset + 8)
    ico.writeUInt32LE(payloadOffset, directoryOffset + 12)

    ico.write('89504e470d0a1a0a', payloadOffset, 'hex')
    ico.writeUInt32BE(13, payloadOffset + 8)
    ico.write('IHDR', payloadOffset + 12)
    ico.writeUInt32BE(payloadWidth, payloadOffset + 16)
    ico.writeUInt32BE(payloadHeight, payloadOffset + 20)
  }

  return ico
}

test('accepts the checked-in brand assets', async () => {
  const result = await withFixture(async () => {})
  assert.equal(result.status, 0, result.stderr)
})

for (const [svgPath, paintAttribute] of svgMasters) {
  test(`rejects shorthand paint in ${svgPath}`, async () => {
    const result = await withFixture((root) => replaceInFixture(root, svgPath, paintAttribute, 'fill="#f11"'))
    expectRejected(result, `#f11 in ${svgPath}`)
  })
}

for (const paint of [
  '#ff112233',
  'rgb(1, 2, 3)',
  'rgba(1, 2, 3, 0.5)',
  'hsl(1, 2%, 3%)',
  'hsla(1, 2%, 3%, 0.5)',
  'red',
  'var(--brand)',
  'url(#paint)',
]) {
  test(`rejects disallowed fill paint ${paint}`, async () => {
    const result = await withFixture((root) => replaceInFixture(root, 'brand/logo-mark.svg', 'fill="#0B1222"', `fill="${paint}"`))
    expectRejected(result, paint)
  })
}

test('rejects inline SVG styles and style blocks', async () => {
  const inlineStyle = await withFixture((root) => replaceInFixture(root, 'brand/logo-mark.svg', '<circle ', '<circle style="fill: #f11" '))
  expectRejected(inlineStyle, 'an inline style attribute')

  const styleBlock = await withFixture((root) => replaceInFixture(root, 'brand/logo-mark.svg', '>\n  <title', '><style>.x { fill: #f11; }</style>\n  <title'))
  expectRejected(styleBlock, 'a style block')
})

test('rejects extra SVG text nodes', async () => {
  const result = await withFixture((root) => replaceInFixture(
    root,
    'brand/logo-horizontal.svg',
    '</svg>',
    '<text x="0" y="0">Unexpected</text></svg>',
  ))
  expectRejected(result, 'an extra text node')
})

test('rejects currentColor in a full-color SVG master', async () => {
  const result = await withFixture((root) => replaceInFixture(
    root,
    'brand/logo-mark.svg',
    'fill="#0B1222"',
    'fill="currentColor"',
  ))
  expectRejected(result, 'currentColor in a full-color SVG master')
})

test('rejects visible SVG shapes without explicit paint', async () => {
  const result = await withFixture((root) => replaceInFixture(
    root,
    'brand/logo-mark.svg',
    '<circle cx="32" cy="32" r="23" fill="#0B1222" stroke="#7C8CFF" stroke-width="4"/>',
    '<circle cx="32" cy="32" r="23" stroke-width="4"/>',
  ))
  expectRejected(result, 'a visible SVG shape without fill or stroke')
})

test('rejects namespace-prefixed SVG text elements', async () => {
  const result = await withFixture((root) => replaceInFixture(
    root,
    'brand/logo-horizontal.svg',
    '</svg>',
    '<svg:text x="0" y="0">Unexpected</svg:text></svg>',
  ))
  expectRejected(result, 'a namespace-prefixed SVG text element')
})

test('rejects incorrect ICO frame dimensions', async () => {
  const result = await withFixture(async (root) => {
    const path = join(root, publicPath, 'favicon.ico')
    const ico = await readFile(path)
    ico[22] = 48
    await writeFile(path, ico)
  })
  expectRejected(result, 'an incorrect ICO frame dimension')
})

test('rejects zero-sized ICO frames', async () => {
  const result = await withFixture(async (root) => {
    const path = join(root, publicPath, 'favicon.ico')
    const ico = await readFile(path)
    ico.writeUInt32LE(0, 14)
    await writeFile(path, ico)
  })
  expectRejected(result, 'a zero-sized ICO frame')
})

test('rejects ICO frame offsets inside the directory', async () => {
  const result = await withFixture(async (root) => {
    const path = join(root, publicPath, 'favicon.ico')
    const ico = await readFile(path)
    ico.writeUInt32LE(6, 18)
    await writeFile(path, ico)
  })
  expectRejected(result, 'an ICO frame offset inside the directory')
})

test('rejects overlapping ICO frame payload ranges', async () => {
  const result = await withFixture(async (root) => {
    const path = join(root, publicPath, 'favicon.ico')
    const ico = await readFile(path)
    const firstPayloadOffset = ico.readUInt32LE(18)
    const secondPayloadOffset = ico.readUInt32LE(34)
    ico.writeUInt32LE(secondPayloadOffset - firstPayloadOffset + 1, 14)
    await writeFile(path, ico)
  })
  expectRejected(result, 'overlapping ICO frame payload ranges')
})

test('rejects ICO payload dimensions that differ from the directory', async () => {
  const result = await withFixture(async (root) => {
    await writeFile(join(root, publicPath, 'favicon.ico'), buildPngIco(
      [[16, 16], [32, 32]],
      [[17, 16], [32, 32]],
    ))
  })
  expectRejected(result, 'ICO payload dimensions that differ from the directory')
})

test('accepts matching PNG ICO payload dimensions', async () => {
  const result = await withFixture(async (root) => {
    await writeFile(join(root, publicPath, 'favicon.ico'), buildPngIco([[16, 16], [32, 32]]))
  })
  assert.equal(result.status, 0, result.stderr)
})

test('accepts matching DIB ICO payload dimensions', async () => {
  const result = await withFixture(async (root) => {
    await writeFile(join(root, publicPath, 'favicon.ico'), buildDibIco([[16, 16], [32, 32]]))
  })
  assert.equal(result.status, 0, result.stderr)
})

test('rejects DIB ICO payload dimensions that differ from the directory', async () => {
  const result = await withFixture(async (root) => {
    const ico = buildDibIco([[16, 16], [32, 32]])
    ico.writeInt32LE(18, 42)
    await writeFile(join(root, publicPath, 'favicon.ico'), ico)
  })
  expectRejected(result, 'DIB ICO payload dimensions that differ from the directory')
})
