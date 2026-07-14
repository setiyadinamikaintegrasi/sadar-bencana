import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const webPackage = JSON.parse(await readFile(resolve(root, 'apps/web/package.json'), 'utf8'))
const lockfile = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'))

function declaredMajor(name, section = 'dependencies') {
  const range = webPackage[section]?.[name] ?? ''
  const match = range.match(/\d+/)
  if (!match) throw new Error(`apps/web/package.json: missing ${name} major version`)
  return Number(match[0])
}

function versionMajor(version, label) {
  const match = version?.match(/^\d+/)
  if (!match) throw new Error(`${label}: missing installed major version`)
  return Number(match[0])
}

function installations(name) {
  const suffix = `node_modules/${name}`
  return Object.entries(lockfile.packages)
    .filter(([path]) => path === suffix || path.endsWith(`/${suffix}`))
    .map(([path, metadata]) => ({ path, ...metadata }))
}

function singleInstallation(name) {
  const installed = installations(name)
  if (installed.length !== 1) {
    throw new Error(`${name} must have one physical installation, got ${installed.map(({ path, version }) => `${path}@${version}`).join(', ')}`)
  }
  return installed[0]
}

function requireMajor(name, actualMajor, section = 'dependencies') {
  const expectedMajor = declaredMajor(name, section)
  if (actualMajor !== expectedMajor) {
    throw new Error(`${name} major mismatch: declared ${expectedMajor}, installed ${actualMajor}`)
  }
}

function requirePeerMajor(packageName, metadata, dependency, expectedMajor) {
  const range = metadata.peerDependencies?.[dependency] ?? ''
  const match = range.match(/\d+/)
  if (!match || Number(match[0]) !== expectedMajor) {
    throw new Error(`${packageName} requires incompatible ${dependency} peer ${range || '(missing)'}`)
  }
}

const reactMajor = declaredMajor('react')
const reactDomMajor = declaredMajor('react-dom')
if (reactMajor !== reactDomMajor) {
  throw new Error(`React runtime mismatch: react major ${reactMajor}, react-dom major ${reactDomMajor}`)
}

const react = singleInstallation('react')
const reactDom = singleInstallation('react-dom')
requireMajor('react', versionMajor(react.version, 'react'))
requireMajor('react-dom', versionMajor(reactDom.version, 'react-dom'))
if (react.version !== reactDom.version) {
  throw new Error(`React runtime versions differ: react=${react.version}, react-dom=${reactDom.version}`)
}

for (const packageName of ['react-leaflet', '@react-leaflet/core']) {
  const metadata = singleInstallation(packageName)
  requirePeerMajor(packageName, metadata, 'react', reactMajor)
  requirePeerMajor(packageName, metadata, 'react-dom', reactMajor)
}

for (const packageName of ['@types/react', '@types/react-dom']) {
  const expectedMajor = declaredMajor(packageName, 'devDependencies')
  if (expectedMajor !== reactMajor) {
    throw new Error(`${packageName} declared major ${expectedMajor} does not match React ${reactMajor}`)
  }
  const installed = installations(packageName)
  if (installed.length === 0) throw new Error(`${packageName} is not installed`)
  for (const metadata of installed) requireMajor(packageName, versionMajor(metadata.version, packageName), 'devDependencies')
}

console.log(`React runtime verified: ${react.version}`)
