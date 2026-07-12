import { Resvg } from '@resvg/resvg-js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

async function render(sourcePath, outputPath, width) {
  const source = await readFile(resolve(root, sourcePath), 'utf8')
  const rendered = new Resvg(source, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true },
  }).render().asPng()
  const output = resolve(root, outputPath)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, rendered)
}

await render('apps/web/public/favicon.svg', 'apps/web/public/favicon-16x16.png', 16)
await render('apps/web/public/favicon.svg', 'apps/web/public/favicon-32x32.png', 32)
await render('apps/web/public/favicon.svg', 'apps/web/public/.icon-source-512.png', 512)
await render('apps/web/public/brand/og-sadarbencana.svg', 'apps/web/public/og-sadarbencana.png', 1200)
