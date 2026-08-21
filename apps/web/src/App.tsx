// apps/web/src/App.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { GitFork, Menu as MenuIcon, X } from 'lucide-react'
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
import AdminUsersPage from './features/settings/AdminUsersPage'
import EvacuationPage from './features/evacuation/EvacuationPage'
import EvacuationAdminPage from './features/evacuation/EvacuationAdminPage'
import LearningPage from './features/learning/LearningPage'
import TechnologyAttributionPage from './features/about/TechnologyAttributionPage'
import LoginGate from './features/ews/LoginGate'
import BrandLogo from './components/BrandLogo'
import TopNav from './components/TopNav'
import type { OverlayFocusRequest } from './components/RiskMap'
import { useAuth } from './lib/auth/AuthProvider'
import {
  GITHUB_REPOSITORY_URL,
  PRIMARY_NAV_ITEMS,
  SECONDARY_NAV_GROUPS,
  type Section,
} from './navigation'

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
}

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

function App() {
  const [activeSection, setActiveSection] = useState<Section>('Executive Overview')
  const [moreOpen, setMoreOpen] = useState(false)
  const [officialAlertFocus, setOfficialAlertFocus] = useState<OverlayFocusRequest | null>(null)
  const officialAlertFocusNonce = useRef(0)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const mobileMenuDialogRef = useRef<HTMLDivElement>(null)
  const shouldRestoreMenuFocus = useRef(false)

  const navigate = (section: Section) => {
    if (moreOpen) {
      shouldRestoreMenuFocus.current = true
    }
    setActiveSection(section)
    setMoreOpen(false)
  }

  const isSecondaryActive = SECONDARY_NAV_GROUPS.some((group) =>
    group.items.some((item) => item.section === activeSection),
  )

  const dismissMoreMenu = useCallback(() => {
    shouldRestoreMenuFocus.current = true
    setMoreOpen(false)
  }, [])

  useEffect(() => {
    if (!moreOpen) {
      if (shouldRestoreMenuFocus.current) {
        menuTriggerRef.current?.focus()
        shouldRestoreMenuFocus.current = false
      }
      return
    }

    getFocusableElements(mobileMenuDialogRef.current ?? document.body)[0]?.focus()

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissMoreMenu()
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [dismissMoreMenu, moreOpen])

  const trapMenuFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !mobileMenuDialogRef.current) return

    const focusableElements = getFocusableElements(mobileMenuDialogRef.current)
    const first = focusableElements[0]
    const last = focusableElements[focusableElements.length - 1]
    if (!first || !last) return

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const showOfficialAlertOnMap = (id: string) => {
    officialAlertFocusNonce.current += 1
    setOfficialAlertFocus({ id, nonce: officialAlertFocusNonce.current })
    navigate('Executive Overview')
  }

  const clearOfficialAlertFocus = useCallback(() => {
    setOfficialAlertFocus(null)
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div aria-hidden={moreOpen ? 'true' : undefined}>
        {/* Desktop top nav — hidden on mobile */}
        <TopNav activeSection={activeSection} onNavigate={navigate} />

        {/* Main content */}
        <div className="flex min-h-screen flex-col md:pt-14">
          {/* Mobile-only header */}
          <header className="flex min-h-14 items-center gap-3 border-b border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur md:hidden">
          <BrandLogo variant="mark" decorative className="h-7 w-7 shrink-0" />
          <h2 className="min-w-0 text-lg font-semibold text-slate-50">{activeSection}</h2>
          <a
            href={GITHUB_REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub Open Source"
            className="ml-auto flex h-9 shrink-0 items-center gap-1.5 px-2 text-slate-400 transition hover:text-slate-100"
          >
            <GitFork aria-hidden="true" className="h-5 w-5" />
            <span className="text-xs font-medium">GitHub</span>
          </a>
          </header>

          <main aria-hidden={moreOpen ? 'true' : undefined} className="flex-1 px-4 py-4 pb-24 md:px-8 md:py-8 md:pb-8">
          {activeSection === 'Executive Overview' ? (
            <ExecutiveOverview
              initialOfficialAlertFocus={officialAlertFocus}
              onOfficialAlertFocusCleared={clearOfficialAlertFocus}
            />
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
          ) : activeSection === 'Admin Pengguna' ? (
            <AdminUsersPage />
          ) : activeSection === 'Teknologi & Lisensi' ? (
            <TechnologyAttributionPage />
          ) : (
            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl shadow-slate-950/40">
              <p className="text-lg font-medium text-slate-100">{activeSection} — coming soon</p>
            </section>
          )}
          </main>
        </div>
      </div>

      <nav aria-hidden={moreOpen ? 'true' : undefined} aria-label="Navigasi mobile" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-slate-800 bg-slate-900 md:hidden">
        {PRIMARY_NAV_ITEMS.map(({ section, mobileLabel, icon: Icon }) => {
          const isActive = section === activeSection
          return (
            <button
              key={section}
              type="button"
              onClick={() => navigate(section)}
              aria-current={isActive ? 'page' : undefined}
              className={`grid min-h-16 w-full grid-rows-[20px_24px] place-items-center py-2 text-xs font-medium transition ${
                isActive ? 'text-indigo-300' : 'text-slate-500'
              }`}
            >
              <Icon aria-hidden="true" className="h-5 w-5" />
              <span>{mobileLabel}</span>
            </button>
          )
        })}
        <button
          ref={menuTriggerRef}
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
          aria-controls="mobile-secondary-navigation"
          className={`grid min-h-16 w-full grid-rows-[20px_24px] place-items-center py-2 text-xs font-medium transition ${
            isSecondaryActive || moreOpen ? 'text-indigo-300' : 'text-slate-500'
          }`}
        >
          <MenuIcon aria-hidden="true" className="h-5 w-5" />
          <span>Menu</span>
        </button>
      </nav>

      {moreOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/60 md:hidden"
            onClick={dismissMoreMenu}
          />
          <div
            ref={mobileMenuDialogRef}
            id="mobile-secondary-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Menu navigasi"
            onKeyDown={trapMenuFocus}
            className="fixed inset-x-0 bottom-0 z-40 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-slate-800 bg-slate-900 p-6 md:hidden"
          >
            <div className="space-y-4">
              {SECONDARY_NAV_GROUPS.map(({ label, items }) => (
                <section key={label} aria-labelledby={`mobile-secondary-${label}`}>
                  <h2 id={`mobile-secondary-${label}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {label}
                  </h2>
                  <div className="space-y-1">
                    {items.map(({ section, mobileLabel, icon: Icon }) => (
                      <button
                        key={section}
                        type="button"
                        onClick={() => navigate(section)}
                        aria-current={activeSection === section ? 'page' : undefined}
                        className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition ${
                          activeSection === section
                            ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-inset ring-indigo-400/40'
                            : 'text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <Icon aria-hidden="true" className="h-4 w-4 text-slate-500" />
                        <span>{mobileLabel}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <button
              type="button"
              onClick={dismissMoreMenu}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 py-3 text-sm font-medium text-slate-300 transition hover:border-slate-600"
            >
              <X aria-hidden="true" className="h-4 w-4" />
              Tutup
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default App
