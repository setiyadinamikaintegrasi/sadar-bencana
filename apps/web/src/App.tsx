// apps/web/src/App.tsx
import { useState } from 'react'
import AlertsPage from './features/alerts/AlertsPage'
import BriefingPage from './features/briefing/BriefingPage'
import CopilotPage from './features/copilot/CopilotPage'
import EventsPage from './features/events/EventsPage'
import ExecutiveOverview from './features/executive/ExecutiveOverview'
import RiskRegistryPage from './features/contracts/RiskRegistryPage'
import SourceHealthPage from './features/health/SourceHealthPage'
import EwsPage from './features/ews/EwsPage'
import RegionalHistoryPage from './features/history/RegionalHistoryPage'
import OfficialSourcesSettingsPage from './features/settings/OfficialSourcesSettingsPage'
import EwsAdminSettingsPage from './features/settings/EwsAdminSettingsPage'
import EvacuationPage from './features/evacuation/EvacuationPage'
import EvacuationAdminPage from './features/evacuation/EvacuationAdminPage'
import LearningPage from './features/learning/LearningPage'
import LoginGate from './features/ews/LoginGate'
import BrandLogo from './components/BrandLogo'
import TopNav from './components/TopNav'
import {
  nextOverlayFocusRequest,
  type OverlayFocusRequest,
} from './components/RiskMap'
import { useAuth } from './lib/auth/AuthProvider'

const sections = [
  { label: 'Executive Overview', icon: '◼' },
  { label: 'Events', icon: '●' },
  { label: 'Daftar Risiko', icon: '▲' },
  { label: 'Alerts', icon: '◆' },
  { label: 'Briefing', icon: '◇' },
  { label: 'AI Copilot', icon: '✦' },
  { label: 'Early Warning', icon: '◔' },
  { label: 'Lokasi Evakuasi', icon: '⛑' },
  { label: 'Belajar Siaga', icon: '◉' },
  { label: 'Source Health', icon: '◈' },
  { label: 'Riwayat Wilayah', icon: '▦' },
  { label: 'Sumber Resmi', icon: '⚙' },
  { label: 'Admin EWS', icon: '⚙' },
  { label: 'Admin Evakuasi', icon: '⚙' },
] as const

type Section = (typeof sections)[number]['label']

function AIProtected({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) {
    return <p className="py-12 text-center text-sm text-slate-400">Memeriksa sesi…</p>
  }
  if (!session) {
    return (
      <LoginGate
        title="Fitur AI"
        subtitleIn="Masuk untuk menggunakan Executive Briefing dan Analyst Copilot."
        subtitleUp="Daftar dan konfirmasi email untuk mengakses fitur AI."
      />
    )
  }
  return <>{children}</>
}

const bottomTabs = [
  { label: 'Overview', section: 'Executive Overview' as Section, icon: '◼' },
  { label: 'Events', section: 'Events' as Section, icon: '●' },
  { label: 'Alerts', section: 'Alerts' as Section, icon: '◆' },
] as const

const moreSections: { label: string; section: Section; icon: string }[] = [
  { label: 'Daftar Risiko', section: 'Daftar Risiko', icon: '▲' },
  { label: 'Briefing', section: 'Briefing', icon: '◇' },
  { label: 'AI Copilot', section: 'AI Copilot', icon: '✦' },
  { label: 'Early Warning', section: 'Early Warning', icon: '◔' },
  { label: 'Lokasi Evakuasi', section: 'Lokasi Evakuasi', icon: '⛑' },
  { label: 'Belajar Siaga', section: 'Belajar Siaga', icon: '◉' },
  { label: 'Source Health', section: 'Source Health', icon: '◈' },
  { label: 'Riwayat Wilayah', section: 'Riwayat Wilayah', icon: '▦' },
  { label: 'Sumber Resmi', section: 'Sumber Resmi', icon: '⚙' },
  { label: 'Admin EWS', section: 'Admin EWS', icon: '⚙' },
  { label: 'Admin Evakuasi', section: 'Admin Evakuasi', icon: '⚙' },
]

function App() {
  const [activeSection, setActiveSection] = useState<Section>('Executive Overview')
  const [moreOpen, setMoreOpen] = useState(false)
  const [officialAlertFocus, setOfficialAlertFocus] = useState<OverlayFocusRequest | null>(null)

  const navigate = (section: string) => {
    setActiveSection(section as Section)
    setMoreOpen(false)
  }

  const showOfficialAlertOnMap = (id: string) => {
    setOfficialAlertFocus((current) => nextOverlayFocusRequest(current, id))
    navigate('Executive Overview')
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Desktop top nav — hidden on mobile */}
      <TopNav activeSection={activeSection} onNavigate={navigate} />

      {/* Main content */}
      <div className="flex min-h-screen flex-col md:pt-14">
        {/* Mobile-only header */}
        <header className="flex min-h-14 items-center gap-3 border-b border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur md:hidden">
          <BrandLogo variant="mark" decorative className="h-7 w-7 shrink-0" />
          <h2 className="min-w-0 text-lg font-semibold text-slate-50">{activeSection}</h2>
        </header>

        <main className="flex-1 px-4 py-4 pb-24 md:px-8 md:py-8 md:pb-8">
          {activeSection === 'Executive Overview' ? (
            <ExecutiveOverview initialOfficialAlertFocus={officialAlertFocus} />
          ) : activeSection === 'Events' ? (
            <EventsPage />
          ) : activeSection === 'Daftar Risiko' ? (
            <RiskRegistryPage />
          ) : activeSection === 'Alerts' ? (
            <AlertsPage />
          ) : activeSection === 'Briefing' ? (
            <BriefingPage />
          ) : activeSection === 'AI Copilot' ? (
            <AIProtected><CopilotPage /></AIProtected>
          ) : activeSection === 'Source Health' ? (
            <SourceHealthPage />
          ) : activeSection === 'Early Warning' ? (
            <EwsPage onViewOnMap={showOfficialAlertOnMap} />
          ) : activeSection === 'Lokasi Evakuasi' ? (
            <EvacuationPage />
          ) : activeSection === 'Belajar Siaga' ? (
            <LearningPage />
          ) : activeSection === 'Riwayat Wilayah' ? (
            <RegionalHistoryPage />
          ) : activeSection === 'Sumber Resmi' ? (
            <OfficialSourcesSettingsPage />
          ) : activeSection === 'Admin EWS' ? (
            <EwsAdminSettingsPage />
          ) : activeSection === 'Admin Evakuasi' ? (
            <EvacuationAdminPage />
          ) : (
            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl shadow-slate-950/40">
              <p className="text-lg font-medium text-slate-100">{activeSection} — coming soon</p>
            </section>
          )}
        </main>
      </div>

      {/* Mobile bottom tab bar — unchanged */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-800 bg-slate-900 md:hidden">
        {bottomTabs.map((tab) => {
          const isActive = tab.section === activeSection
          return (
            <button
              key={tab.section}
              type="button"
              onClick={() => navigate(tab.section)}
              className={`flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition ${
                isActive ? 'text-indigo-300' : 'text-slate-500'
              }`}
            >
              <span className="text-base leading-none">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={`flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition ${
            moreSections.some((s) => s.section === activeSection) ? 'text-indigo-300' : 'text-slate-500'
          }`}
        >
          <span className="text-base leading-none">···</span>
          <span>More</span>
        </button>
      </nav>

      {/* More sheet */}
      {moreOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/60 md:hidden"
            onClick={() => setMoreOpen(false)}
          />
          <div className="fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-slate-800 bg-slate-900 p-6 md:hidden">
            <div className="space-y-2">
              {moreSections.map((item) => (
                <button
                  key={item.section}
                  type="button"
                  onClick={() => navigate(item.section)}
                  className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition ${
                    activeSection === item.section
                      ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-inset ring-indigo-400/40'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <span className="text-xs text-slate-500">{item.icon}</span>
                  <span>{item.section}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setMoreOpen(false)}
              className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-800 py-3 text-sm font-medium text-slate-300 transition hover:border-slate-600"
            >
              Tutup
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default App
