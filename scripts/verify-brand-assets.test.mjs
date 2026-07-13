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

test('rejects incorrect ICO frame dimensions', async () => {
  const result = await withFixture(async (root) => {
    const path = join(root, publicPath, 'favicon.ico')
    const ico = await readFile(path)
    ico[22] = 48
    await writeFile(path, ico)
  })
  expectRejected(result, 'an incorrect ICO frame dimension')
})
