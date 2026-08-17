import { describe, expect, it } from 'vitest'
import {
  GITHUB_REPOSITORY_URL,
  PRIMARY_NAV_ITEMS,
  SECONDARY_NAV_GROUPS,
  findNavigationItem,
} from './navigation'

describe('navigation model', () => {
  it('prioritizes public safety workflows without dropping secondary sections', () => {
    expect(PRIMARY_NAV_ITEMS.map((item) => item.desktopLabel)).toEqual([
      'Overview', 'Early Warning', 'Evakuasi', 'Belajar Siaga',
    ])
    expect(SECONDARY_NAV_GROUPS.map((group) => group.label)).toEqual([
      'Pemantauan', 'Analisis', 'Administrasi',
    ])
    expect(SECONDARY_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.section)))
      .toEqual(expect.arrayContaining(['Events', 'Alerts', 'Daftar Risiko', 'Sumber Resmi']))
  })

  it('uses the official open-source repository URL', () => {
    expect(GITHUB_REPOSITORY_URL).toBe(
      'https://github.com/setiyadinamikaintegrasi/sadar-bencana',
    )
  })

  it('finds primary and secondary navigation items by section', () => {
    expect(findNavigationItem('Early Warning')?.desktopLabel).toBe('Early Warning')
    expect(findNavigationItem('AI Copilot')?.mobileLabel).toBe('AI Copilot')
    expect(findNavigationItem('Admin Evakuasi')?.section).toBe('Admin Evakuasi')
  })
})
