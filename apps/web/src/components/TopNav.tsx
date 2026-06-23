// apps/web/src/components/TopNav.tsx
import { useState } from 'react'

const PRIMARY_TABS = [
  { label: 'Executive Overview', icon: '◼' },
  { label: 'Map', icon: '◉' },
  { label: 'Events', icon: '●' },
  { label: 'Alerts', icon: '◆' },
] as const

const OVERFLOW_TABS = [
  { label: 'Exposures', icon: '▲' },
  { label: 'Claims', icon: '■' },
  { label: 'Briefing', icon: '◇' },
  { label: 'AI Copilot', icon: '✦' },
  { label: 'Source Health', icon: '◈' },
] as const

interface TopNavProps {
  activeSection: string
  onNavigate: (section: string) => void
}

export default function TopNav({ activeSection, onNavigate }: TopNavProps) {
  const [overflowOpen, setOverflowOpen] = useState(false)
  const isOverflowActive = OVERFLOW_TABS.some((t) => t.label === activeSection)

  return (
    <header className="fixed inset-x-0 top-0 z-10 hidden border-b border-slate-800 bg-slate-900 md:flex md:h-14 md:items-center md:gap-0 md:px-6">
      {/* Logo */}
      <div className="flex flex-col border-r border-slate-800 py-3 pr-6 mr-2">
        <p className="text-[10px] font-semibold text-indigo-400">PT Tugure</p>
        <p className="text-sm font-semibold text-slate-50">Risk Monitor</p>
      </div>

      {/* Primary tabs */}
      <nav className="flex flex-1 items-stretch h-14">
        {PRIMARY_TABS.map((tab) => {
          const isActive = tab.label === activeSection
          return (
            <button
              key={tab.label}
              type="button"
              onClick={() => onNavigate(tab.label)}
              className={`flex items-center gap-2 border-b-2 px-4 text-sm font-medium transition ${
                isActive
                  ? 'border-indigo-400 text-indigo-300'
                  : 'border-transparent text-slate-400 hover:text-slate-100'
              }`}
            >
              <span className="text-xs">{tab.icon}</span>
              {tab.label}
            </button>
          )
        })}
      </nav>

      {/* Overflow dropdown */}
      <div className="relative h-14 flex items-stretch">
        <button
          type="button"
          onClick={() => setOverflowOpen((v) => !v)}
          className={`flex items-center gap-1 border-b-2 px-4 text-sm font-medium transition ${
            isOverflowActive || overflowOpen
              ? 'border-indigo-400 text-indigo-300'
              : 'border-transparent text-slate-400 hover:text-slate-100'
          }`}
        >
          ···
          <span className="text-[10px] ml-0.5">▾</span>
        </button>

        {overflowOpen && (
          <>
            <div
              className="fixed inset-0 z-[15]"
              onClick={() => setOverflowOpen(false)}
            />
            <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border border-slate-700 bg-slate-900 py-2 shadow-2xl shadow-slate-950/60">
              {OVERFLOW_TABS.map((tab) => (
                <button
                  key={tab.label}
                  type="button"
                  onClick={() => {
                    onNavigate(tab.label)
                    setOverflowOpen(false)
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium transition ${
                    tab.label === activeSection
                      ? 'text-indigo-300'
                      : 'text-slate-300 hover:text-slate-100'
                  }`}
                >
                  <span className="text-xs text-slate-500">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </header>
  )
}
