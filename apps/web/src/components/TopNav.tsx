import { useEffect, useState } from 'react'
import { ChevronDown, GitFork, Menu as MenuIcon, X } from 'lucide-react'
import BrandLogo from './BrandLogo'
import {
  GITHUB_REPOSITORY_URL,
  PRIMARY_NAV_ITEMS,
  SECONDARY_NAV_GROUPS,
  type Section,
} from '../navigation'

interface TopNavProps {
  activeSection: Section
  onNavigate: (section: Section) => void
}

export default function TopNav({ activeSection, onNavigate }: TopNavProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const isSecondaryActive = SECONDARY_NAV_GROUPS.some((group) =>
    group.items.some((item) => item.section === activeSection),
  )

  useEffect(() => {
    if (!menuOpen) return

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  const navigate = (section: Section) => {
    onNavigate(section)
    setMenuOpen(false)
  }

  return (
    <header className="fixed inset-x-0 top-0 z-10 hidden border-b border-slate-800 bg-slate-900 md:flex md:h-14 md:items-center md:gap-0 md:px-3 lg:px-6">
      <button
        type="button"
        onClick={() => onNavigate('Executive Overview')}
        className="mr-1 flex h-14 shrink-0 items-center border-r border-slate-800 pr-3 lg:mr-2 lg:pr-5"
        aria-label="Buka Executive Overview"
      >
        <span className="md:block lg:hidden">
          <BrandLogo variant="mark" decorative className="h-7 w-7 shrink-0" />
        </span>
        <span className="hidden lg:block">
          <BrandLogo className="h-8 w-auto" />
        </span>
      </button>

      <nav aria-label="Navigasi utama" className="flex h-14 flex-1 items-stretch">
        {PRIMARY_NAV_ITEMS.map(({ section, desktopLabel, icon: Icon }) => {
          const isActive = section === activeSection

          return (
            <button
              key={section}
              type="button"
              onClick={() => navigate(section)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center border-b-2 text-sm font-medium transition md:gap-1 md:px-2 lg:gap-2 lg:px-4 ${
                isActive
                  ? 'border-indigo-400 text-indigo-300'
                  : 'border-transparent text-slate-400 hover:text-slate-100'
              }`}
            >
              <Icon aria-hidden="true" className="h-4 w-4" />
              {desktopLabel}
            </button>
          )
        })}

        <div className="relative flex h-14 items-stretch">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="secondary-navigation"
            className={`flex items-center border-b-2 text-sm font-medium transition md:gap-1 md:px-2 lg:gap-2 lg:px-4 ${
              isSecondaryActive || menuOpen
                ? 'border-indigo-400 text-indigo-300'
                : 'border-transparent text-slate-400 hover:text-slate-100'
            }`}
          >
            {menuOpen ? <X aria-hidden="true" className="h-4 w-4" /> : <MenuIcon aria-hidden="true" className="h-4 w-4" />}
            Menu
            <ChevronDown aria-hidden="true" className="h-4 w-4" />
          </button>

          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-[15]"
                onClick={() => setMenuOpen(false)}
                aria-hidden="true"
              />
              <div
                id="secondary-navigation"
                className="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-slate-700 bg-slate-900 py-2 shadow-2xl shadow-slate-950/60"
              >
                {SECONDARY_NAV_GROUPS.map(({ label, items }) => (
                  <section key={label} aria-labelledby={`secondary-${label}`} className="px-2 py-1">
                    <h2 id={`secondary-${label}`} className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {label}
                    </h2>
                    {items.map(({ section, desktopLabel, icon: Icon }) => (
                      <button
                        key={section}
                        type="button"
                        onClick={() => navigate(section)}
                        aria-current={section === activeSection ? 'page' : undefined}
                        className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm font-medium transition ${
                          section === activeSection
                            ? 'text-indigo-300'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
                        }`}
                      >
                        <Icon aria-hidden="true" className="h-4 w-4 text-slate-500" />
                        {desktopLabel}
                      </button>
                    ))}
                  </section>
                ))}
              </div>
            </>
          )}
        </div>
      </nav>

      <a
        href={GITHUB_REPOSITORY_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="GitHub Open Source"
        className="ml-2 flex shrink-0 items-center gap-1.5 text-sm font-medium text-slate-400 transition hover:text-slate-100 lg:ml-4"
      >
        <GitFork aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span>GitHub</span>
        <span className="hidden xl:inline">· Open Source</span>
      </a>
    </header>
  )
}
