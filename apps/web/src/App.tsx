import { useState } from 'react'
import AlertsPage from './features/alerts/AlertsPage'
import BriefingPage from './features/briefing/BriefingPage'
import EventsPage from './features/events/EventsPage'
import ExecutiveOverview from './features/executive/ExecutiveOverview'
import ExposuresPage from './features/exposures/ExposuresPage'
import MapPage from './features/map/MapPage'

const sections = [
  { label: 'Executive Overview', icon: '◼' },
  { label: 'Map', icon: '◉' },
  { label: 'Events', icon: '●' },
  { label: 'Exposures', icon: '▲' },
  { label: 'Alerts', icon: '◆' },
  { label: 'Claims', icon: '■' },
  { label: 'Briefing', icon: '◇' },
] as const

type Section = (typeof sections)[number]['label']

function App() {
  const [activeSection, setActiveSection] = useState<Section>('Executive Overview')

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <aside className="fixed inset-y-0 left-0 z-10 flex w-64 flex-col border-r border-slate-800 bg-slate-900">
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

      <div className="ml-64 flex min-h-screen flex-col">
        <header className="border-b border-slate-800 bg-slate-900/80 px-8 py-6 backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-400">
            PT Tugure · Reinsurance Intelligence
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-50">Reinsurance Risk Monitor</h2>
        </header>

        <main className="flex-1 px-8 py-8">
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
          ) : (
            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl shadow-slate-950/40">
              <p className="text-lg font-medium text-slate-100">{activeSection} — coming soon</p>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
