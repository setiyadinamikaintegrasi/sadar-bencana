import {
  Activity,
  Bell,
  FileText,
  GraduationCap,
  History,
  Info,
  LayoutDashboard,
  MapPinned,
  Radio,
  ShieldAlert,
  Siren,
  Sparkles,
  Settings,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type Section =
  | 'Executive Overview'
  | 'Events'
  | 'Alerts'
  | 'Daftar Risiko'
  | 'Briefing'
  | 'AI Copilot'
  | 'Early Warning'
  | 'Lokasi Evakuasi'
  | 'Belajar Siaga'
  | 'Source Health'
  | 'Riwayat Wilayah'
  | 'Sumber Resmi'
  | 'Admin EWS'
  | 'Admin Evakuasi'
  | 'Teknologi & Lisensi'

export type NavigationItem = {
  section: Section
  desktopLabel: string
  mobileLabel: string
  icon: LucideIcon
}

export type NavigationGroup = {
  label: string
  items: readonly NavigationItem[]
}

export const GITHUB_REPOSITORY_URL =
  'https://github.com/setiyadinamikaintegrasi/sadar-bencana'

export const PRIMARY_NAV_ITEMS = [
  { section: 'Executive Overview', desktopLabel: 'Overview', mobileLabel: 'Overview', icon: LayoutDashboard },
  { section: 'Early Warning', desktopLabel: 'Early Warning', mobileLabel: 'Early Warning', icon: Siren },
  { section: 'Lokasi Evakuasi', desktopLabel: 'Evakuasi', mobileLabel: 'Evakuasi', icon: MapPinned },
  { section: 'Belajar Siaga', desktopLabel: 'Belajar Siaga', mobileLabel: 'Belajar', icon: GraduationCap },
] as const satisfies readonly NavigationItem[]

export const SECONDARY_NAV_GROUPS = [
  {
    label: 'Pemantauan',
    items: [
      { section: 'Events', desktopLabel: 'Events', mobileLabel: 'Events', icon: Activity },
      { section: 'Alerts', desktopLabel: 'Alerts', mobileLabel: 'Alerts', icon: Bell },
      { section: 'Source Health', desktopLabel: 'Source Health', mobileLabel: 'Source Health', icon: ShieldAlert },
      { section: 'Riwayat Wilayah', desktopLabel: 'Riwayat Wilayah', mobileLabel: 'Riwayat Wilayah', icon: History },
    ],
  },
  {
    label: 'Analisis',
    items: [
      { section: 'Daftar Risiko', desktopLabel: 'Daftar Risiko', mobileLabel: 'Daftar Risiko', icon: FileText },
      { section: 'Briefing', desktopLabel: 'Briefing', mobileLabel: 'Briefing', icon: Radio },
      { section: 'AI Copilot', desktopLabel: 'AI Copilot', mobileLabel: 'AI Copilot', icon: Sparkles },
    ],
  },
  {
    label: 'Administrasi',
    items: [
      { section: 'Sumber Resmi', desktopLabel: 'Sumber Resmi', mobileLabel: 'Sumber Resmi', icon: Settings },
      { section: 'Admin EWS', desktopLabel: 'Admin EWS', mobileLabel: 'Admin EWS', icon: Radio },
      { section: 'Admin Evakuasi', desktopLabel: 'Admin Evakuasi', mobileLabel: 'Admin Evakuasi', icon: MapPinned },
      { section: 'Teknologi & Lisensi', desktopLabel: 'Teknologi & Lisensi', mobileLabel: 'Teknologi & Lisensi', icon: Info },
    ],
  },
] as const satisfies readonly NavigationGroup[]

export function findNavigationItem(section: Section): NavigationItem | undefined {
  const allNavigationItems: readonly NavigationItem[] = [
    ...PRIMARY_NAV_ITEMS,
    ...SECONDARY_NAV_GROUPS.flatMap((group) => group.items as readonly NavigationItem[]),
  ]
  return allNavigationItems.find((item) => item.section === section)
}
