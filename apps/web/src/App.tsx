import { useState } from 'react'
import AlertsPage from './features/alerts/AlertsPage'
import BriefingPage from './features/briefing/BriefingPage'
import EventsPage from './features/events/EventsPage'
import ExecutiveOverview from './features/executive/ExecutiveOverview'
import ExposuresPage from './features/exposures/ExposuresPage'
import MapPage from './features/map/MapPage'
import SourceHealthPage from './features/health/SourceHealthPage'

const sections = [
  { label: 'Executive Overview', icon: '◼' },
  { label: 'Map', icon: '◉' },
  { label: 'Events', icon: '●' },
  { label: 'Exposures', icon: '▲' },
  { label: 'Alerts', icon: '◆' },
  { label: 'Claims', icon: '■' },
  { label: 'Briefing', icon: '◇' },
  { label: 'Source Health', icon: '◈' },
] as const

type Section = (typeof sections)[number]['label']

const bottomTabs = [
  { label: 'Overview', section: 'Executive Overview' as Section, icon: '◼' },
  { label: 'Map', section: 'Map' as Section, icon: '◉' },
  { label: 'Events', section: 'Events' as Section, icon: '●' },
  { label: 'Alerts', section: 'Alerts' as Section, icon: '◆' },
] as const

const moreSections: { label: string; section: Section; icon: string }[] = [
  { label: 'Exposures', section: 'Exposures', icon: '▲' },
  { label: 'Claims', section: 'Claims', icon: '■' },
  { label: 'Briefing', section: 'Briefing', icon: '◇' },
  { label: 'Source Health', section: 'Source Health', icon: '◈' },
]

function App() {
  const [activeSection, setActiveSection] = useState<Section>('Executive Overview')
  const [moreOpen, setMoreOpen] = useState(false)

  const navigate = (section: Section) => {
    setActiveSection(section)
    setMoreOpen(false)
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Desktop sidebar — hidden on mobile */}
      <aside className="fixed inset-y-0 left-0 z-10 hidden w-64 flex-col border-r border-slate-800 bg-slate-900 md:flex">
        <div className="border-b border-slate-800 px-6 py-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-400">PT Tugure</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-50">Risk Monitor</h1>
        </div>

        <nav className="flex-1 px-4 py-6">
          <ul className="space-y-2">
            {sections.map((section) => {
              const isActive = section.label === activeSection
              return (
                <li key={section.label}>
                  <button
                    type="button"
                    onClick={() => setActiveSection(section.label)}
                    className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition ${
                      isActive
                        ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-inset ring-indigo-400/40'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
                    }`}
                  >
                    <span className={`text-xs ${isActive ? 'text-indigo-300' : 'text-slate-500'}`}>{section.icon}</span>
                    <span>{section.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex min-h-screen flex-col md:ml-64">
        <header className="border-b border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur md:px-8 md:py-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-400">
            PT Tugure · Reinsurance Intelligence
          </p>
          <h2 className="mt-1 text-xl font-semibold text-slate-50 md:mt-2 md:text-3xl">
            <span className="md:hidden">{activeSection}</span>
            <span className="hidden md:inline">Reinsurance Risk Monitor</span>
          </h2>
        </header>

        <main className="flex-1 px-4 py-4 pb-24 md:px-8 md:py-8 md:pb-8">
          {activeSection === 'Executive Overview' ? (
            <ExecutiveOverview />
          ) : activeSection === 'Map' ? (
            <MapPage />
          ) : activeSection === 'Events' ? (
            <EventsPage />
          ) : activeSection === 'Exposures' ? (
            <ExposuresPage />
          ) : activeSection === 'Alerts' ? (
            <AlertsPage />
          ) : activeSection === 'Briefing' ? (
            <BriefingPage />
          ) : activeSection === 'Source Health' ? (
            <SourceHealthPage />
          ) : (
            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl shadow-slate-950/40">
              <p className="text-lg font-medium text-slate-100">{activeSection} — coming soon</p>
            </section>
          )}
        </main>
      </div>

      {/* Mobile bottom tab bar */}
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
