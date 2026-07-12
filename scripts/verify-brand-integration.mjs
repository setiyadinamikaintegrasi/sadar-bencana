import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

async function source(path) {
  return readFile(resolve(root, path), 'utf8')
}

function requireText(path, text, content) {
  if (!content.includes(text)) throw new Error(`${path}: missing ${text}`)
}

const componentPath = 'apps/web/src/components/BrandLogo.tsx'
const component = await source(componentPath)
requireText(componentPath, "variant?: 'mark' | 'horizontal'", component)
requireText(componentPath, "alt={decorative ? '' : 'SadarBencana'}", component)
requireText(componentPath, "'/brand/logo-mark.svg'", component)
requireText(componentPath, "'/brand/logo-horizontal.svg'", component)

const topNavPath = 'apps/web/src/components/TopNav.tsx'
const topNav = await source(topNavPath)
requireText(topNavPath, '<BrandLogo className="h-8 w-auto" />', topNav)
requireText(topNavPath, "onNavigate('Executive Overview')", topNav)

const appPath = 'apps/web/src/App.tsx'
const app = await source(appPath)
requireText(appPath, 'variant="mark"', app)
requireText(appPath, 'decorative', app)

console.log('Brand integration verified')
