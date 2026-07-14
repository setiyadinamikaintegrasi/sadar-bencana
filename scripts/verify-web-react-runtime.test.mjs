import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const repoRoot = resolve(import.meta.dirname, '..')

async function withFixture(mutate) {
  const fixture = await mkdtemp(join(tmpdir(), 'verify-web-react-runtime-'))

  try {
    await mkdir(join(fixture, 'scripts'), { recursive: true })
    await mkdir(join(fixture, 'apps/web'), { recursive: true })
    await cp(join(repoRoot, 'scripts/verify-web-react-runtime.mjs'), join(fixture, 'scripts/verify-web-react-runtime.mjs'))
    await cp(join(repoRoot, 'apps/web/package.json'), join(fixture, 'apps/web/package.json'))
    await cp(join(repoRoot, 'package-lock.json'), join(fixture, 'package-lock.json'))
    await mutate(fixture)
    return spawnSync(process.execPath, [join(fixture, 'scripts/verify-web-react-runtime.mjs')], { encoding: 'utf8' })
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
}

async function mutateJson(root, path, mutate) {
  const absolutePath = join(root, path)
  const value = JSON.parse(await readFile(absolutePath, 'utf8'))
  mutate(value)
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`)
}

function expectRejected(result, message) {
  assert.notEqual(result.status, 0, `validator accepted ${message}`)
}

function packageEntries(lockfile, name) {
  const suffix = `node_modules/${name}`
  return Object.entries(lockfile.packages)
    .filter(([path]) => path === suffix || path.endsWith(`/${suffix}`))
}

test('rejects duplicate physical React runtimes even at the same version', async () => {
  const result = await withFixture((root) => mutateJson(root, 'package-lock.json', (lockfile) => {
    const [[reactPath, react], [reactDomPath, reactDom]] = [
      packageEntries(lockfile, 'react'),
      packageEntries(lockfile, 'react-dom'),
    ].map((entries) => entries[0])
    lockfile.packages[reactPath === 'node_modules/react' ? 'apps/web/node_modules/react' : 'node_modules/react'] = { ...react }
    lockfile.packages[reactDomPath === 'node_modules/react-dom' ? 'apps/web/node_modules/react-dom' : 'node_modules/react-dom'] = { ...reactDom }
  }))
  expectRejected(result, 'duplicate same-version React runtimes')
})

test('rejects installed React major that differs from the manifest', async () => {
  const result = await withFixture((root) => mutateJson(root, 'package-lock.json', (lockfile) => {
    for (const [, metadata] of packageEntries(lockfile, 'react')) metadata.version = '19.2.7'
    for (const [, metadata] of packageEntries(lockfile, 'react-dom')) metadata.version = '19.2.7'
  }))
  expectRejected(result, 'an installed React major different from the manifest')
})

test('rejects incompatible React Leaflet peer majors', async () => {
  const result = await withFixture((root) => mutateJson(root, 'package-lock.json', (lockfile) => {
    packageEntries(lockfile, 'react-leaflet')[0][1].peerDependencies.react = '^19.0.0'
  }))
  expectRejected(result, 'an incompatible React Leaflet peer major')
})

test('rejects React type definitions from another major', async () => {
  const result = await withFixture((root) => mutateJson(root, 'package-lock.json', (lockfile) => {
    lockfile.packages['apps/web/node_modules/@types/react'] = {
      ...lockfile.packages['node_modules/@types/react'],
      version: '19.2.17',
    }
  }))
  expectRejected(result, 'React type definitions from another major')
})
