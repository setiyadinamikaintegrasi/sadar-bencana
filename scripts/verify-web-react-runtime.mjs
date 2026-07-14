import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const webPackage = JSON.parse(await readFile(resolve(root, 'apps/web/package.json'), 'utf8'))
const lockfile = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'))

function declaredMajor(name) {
  const range = webPackage.dependencies?.[name] ?? ''
  const match = range.match(/\d+/)
  if (!match) throw new Error(`apps/web/package.json: missing ${name} major version`)
  return Number(match[0])
}

function installedVersions(name) {
  const suffix = `node_modules/${name}`
  return new Set(Object.entries(lockfile.packages)
    .filter(([path]) => path === suffix || path.endsWith(`/${suffix}`))
    .map(([, metadata]) => metadata.version))
}

const reactMajor = declaredMajor('react')
const reactDomMajor = declaredMajor('react-dom')
if (reactMajor !== reactDomMajor) {
  throw new Error(`React runtime mismatch: react major ${reactMajor}, react-dom major ${reactDomMajor}`)
}

const reactVersions = installedVersions('react')
const reactDomVersions = installedVersions('react-dom')
if (reactVersions.size !== 1 || reactDomVersions.size !== 1) {
  throw new Error(`React runtime must resolve once; react=${[...reactVersions]}, react-dom=${[...reactDomVersions]}`)
}

const [reactVersion] = reactVersions
const [reactDomVersion] = reactDomVersions
if (reactVersion !== reactDomVersion) {
  throw new Error(`React runtime versions differ: react=${reactVersion}, react-dom=${reactDomVersion}`)
}

console.log(`React runtime verified: ${reactVersion}`)
