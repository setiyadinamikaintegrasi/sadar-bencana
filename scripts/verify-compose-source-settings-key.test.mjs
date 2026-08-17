import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

function serviceEnvironment(compose, serviceName) {
  const lines = compose.split(/\r?\n/)
  const serviceStart = lines.findIndex((line) => line === `  ${serviceName}:`)
  assert.notEqual(serviceStart, -1, `missing ${serviceName} service`)

  const serviceEnd = lines.findIndex(
    (line, index) => index > serviceStart && /^  [a-zA-Z0-9_-]+:$/.test(line),
  )
  const serviceLines = lines.slice(
    serviceStart + 1,
    serviceEnd === -1 ? lines.length : serviceEnd,
  )
  const environmentStart = serviceLines.findIndex((line) => line === '    environment:')
  assert.notEqual(environmentStart, -1, `missing ${serviceName} environment`)

  const environment = new Map()
  for (const line of serviceLines.slice(environmentStart + 1)) {
    if (/^    \S/.test(line)) break
    const match = line.match(/^      ([A-Z0-9_]+):\s*(.*)$/)
    if (match) environment.set(match[1], match[2])
  }
  return environment
}

test('API and worker receive the same safely defaulted source-settings key', async () => {
  const compose = await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8')
  const apiKey = serviceEnvironment(compose, 'api').get('OFFICIAL_SOURCE_SETTINGS_KEY')
  const workerKey = serviceEnvironment(compose, 'worker').get('OFFICIAL_SOURCE_SETTINGS_KEY')

  assert.equal(apiKey, '${OFFICIAL_SOURCE_SETTINGS_KEY:-}')
  assert.equal(workerKey, apiKey)
})
