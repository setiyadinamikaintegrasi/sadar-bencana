import { Resvg } from '@resvg/resvg-js'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'

const root = resolve(import.meta.dirname, '..')
const execFile = promisify(execFileCallback)
const iconSourcePath = 'apps/web/public/.icon-source-512.png'
const fontPath = resolve(root, 'apps/web/public/brand/fonts/Inter-Variable.ttf')

async function render(sourcePath, outputPath, width) {
  const source = await readFile(resolve(root, sourcePath), 'utf8')
  const rendered = new Resvg(source, {
    fitTo: { mode: 'width', value: width },
    font: {
      fontFiles: [fontPath],
      loadSystemFonts: false,
      defaultFontFamily: 'Inter',
    },
  }).render().asPng()
  const output = resolve(root, outputPath)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, rendered)
}

async function magick(args) {
  await execFile('magick', args, { cwd: root })
}

async function assertImageMagick7() {
  let stdout
  try {
    ;({ stdout } = await execFile('magick', ['-version'], { cwd: root }))
  } catch (error) {
    throw new Error('ImageMagick 7 is required to generate brand assets. Install ImageMagick 7 and ensure `magick` is on PATH.', { cause: error })
  }

  const version = stdout.match(/ImageMagick\s+(\d+)(?:\.\d+)*/)
  if (!version || Number(version[1]) !== 7) {
    const reported = stdout.split('\n', 1)[0] || 'unknown version'
    throw new Error(`ImageMagick 7 is required to generate brand assets. Found: ${reported}`)
  }
}

await assertImageMagick7()

try {
  await render('apps/web/public/favicon.svg', 'apps/web/public/favicon-16x16.png', 16)
  await render('apps/web/public/favicon.svg', 'apps/web/public/favicon-32x32.png', 32)
  await render('apps/web/public/favicon.svg', iconSourcePath, 512)
  await render('apps/web/public/brand/og-sadarbencana.svg', 'apps/web/public/og-sadarbencana.png', 1200)

  await magick([iconSourcePath, '-resize', '144x144', '-gravity', 'center', '-background', '#0B1222', '-extent', '180x180', '-strip', 'apps/web/public/apple-touch-icon.png'])
  await magick([iconSourcePath, '-resize', '154x154', '-gravity', 'center', '-background', '#0B1222', '-extent', '192x192', '-strip', 'apps/web/public/icon-192.png'])
  await magick([iconSourcePath, '-resize', '410x410', '-gravity', 'center', '-background', '#0B1222', '-extent', '512x512', '-strip', 'apps/web/public/icon-512.png'])
  await magick(['apps/web/public/favicon-16x16.png', 'apps/web/public/favicon-32x32.png', '-strip', 'apps/web/public/favicon.ico'])
} finally {
  await rm(resolve(root, iconSourcePath), { force: true })
}
