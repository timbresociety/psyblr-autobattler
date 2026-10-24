import { lazy, Suspense, useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { Build } from '../charter/build'
import type { BuildRecord } from './api'
import { BrandMark } from './brand/BrandMark'
import { ForgeScreen } from './forge/ForgeScreen'
import { LoadoutScreen } from './loadout/LoadoutScreen'
import './theme.css'

// the arena bench (U1) opens on its own with `?bench` and loads three's WebGPU build only there
const BenchScreen = lazy(() => import('./arena/BenchScreen').then((m) => ({ default: m.BenchScreen })))
const WardrobeScreen = import.meta.env.DEV ? lazy(() => import('./dev/WardrobeScreen').then((m) => ({ default: m.WardrobeScreen }))) : undefined
// the Arena loads three's WebGPU build, the engine and the AI only when its tab opens
const ArenaScreen = lazy(() => import('./arena/ArenaScreen').then((m) => ({ default: m.ArenaScreen })))

type Tab = 'arena' | 'forge' | 'loadout'
type Theme = 'light' | 'dark'

const THEME_KEY = 'psyblr.theme'

/** The mode index.html chose before the first paint: the visitor's own choice, or else their system's. */
const currentTheme = (): Theme => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')

/** Light or dark: a choice made here sticks on this browser; until then the system's setting decides, live. */
function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(currentTheme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  useEffect(() => {
    const system = window.matchMedia?.('(prefers-color-scheme: light)')
    if (!system) return
    const follow = (e: MediaQueryListEvent) => {
      let chosen: string | null = null
      try {
        chosen = localStorage.getItem(THEME_KEY)
      } catch {
        // storage can be blocked; the system setting still decides
      }
      if (!chosen) setTheme(e.matches ? 'light' : 'dark')
    }
    system.addEventListener('change', follow)
    return () => system.removeEventListener('change', follow)
  }, [])
  const toggle = () =>
    setTheme((t) => {
      const next = t === 'light' ? 'dark' : 'light'
      try {
        localStorage.setItem(THEME_KEY, next)
      } catch {
        // the choice lasts for this visit when storage is blocked
      }
      return next
    })
  return [theme, toggle]
}

const TABS: readonly { id: Tab; label: string; hint: string; icon: ReactNode }[] = [
  {
    id: 'arena',
    label: 'Arena',
    hint: 'Stage a battle',
    icon: (
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4l11 11M13 17l4-4M15.5 15.5l4 4" />
        <path d="M20 4L9 15M7 13l4 4M8.5 15.5l-4 4" />
      </g>
    ),
  },
  {
    id: 'forge',
    label: 'Forge',
    hint: 'Make a hero',
    icon: (
      <>
        <path fill="currentColor" d="M2 9h14.6c2.6 0 4.6.8 5.4 1.8-1.3.6-3.1 1-5.4 1.3v.4c0 1.6-1.5 2.7-3.6 3V17h2.2c.9 0 1.5.6 1.5 1.5V20H5v-1.5c0-.9.6-1.5 1.5-1.5h2.2v-1.5C5.6 15.1 3.3 13.4 2 11z" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M9 2.5v3M5.2 3.8l1.6 2.4M12.8 3.8l-1.6 2.4" />
      </>
    ),
  },
  {
    id: 'loadout',
    label: 'Loadout',
    hint: 'Your heroes',
    icon: (
      <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
        <rect x="3" y="5" width="7" height="14" rx="1.5" />
        <rect x="14" y="5" width="7" height="14" rx="1.5" />
        <path d="M5.5 15h2M16.5 15h2" strokeLinecap="round" />
        <circle cx="6.5" cy="10" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="17.5" cy="10" r="1.6" fill="currentColor" stroke="none" />
      </g>
    ),
  },
]

export function App() {
  if (WardrobeScreen && new URLSearchParams(window.location.search).has('wardrobe')) {
    return (
      <Suspense fallback={<p className="screen-loading">Loading the wardrobe…</p>}>
        <WardrobeScreen />
      </Suspense>
    )
  }
  if (new URLSearchParams(window.location.search).has('bench')) {
    return (
      <Suspense fallback={<p className="screen-loading">Loading the bench…</p>}>
        <BenchScreen />
      </Suspense>
    )
  }
  return <Screens />
}

function initialTab(): Tab {
  const q = new URLSearchParams(window.location.search)
  return q.has('arena') ? 'arena' : q.has('loadout') ? 'loadout' : 'forge'
}

/** The tab lives in the address bar, so a reload comes back to the same screen. */
function rememberTab(tab: Tab) {
  const q = new URLSearchParams(window.location.search)
  for (const t of TABS) q.delete(t.id)
  if (tab !== 'forge') q.set(tab, '')
  const search = q.toString().replace(/=(?=&|$)/g, '')
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`)
}

/** What the Forge opens with: a hero from the Loadout, a copy to remix, or a blank slate. A new key starts it over. */
interface ForgeOpen {
  key: number
  record?: BuildRecord
  initial?: Build
}

function Screens() {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [theme, toggleTheme] = useTheme()
  const [forge, setForge] = useState<ForgeOpen>({ key: 0 })
  // the Forge stays mounted once opened, so leaving it for the Arena or the Loadout never loses an unsaved hero
  const [forgeKept, setForgeKept] = useState(tab === 'forge')
  const open = (next: Tab) => {
    setTab(next)
    rememberTab(next)
    if (next === 'forge') setForgeKept(true)
  }
  const openInForge = (next: Omit<ForgeOpen, 'key'>) => {
    setForge((f) => ({ key: f.key + 1, ...next }))
    open('forge')
  }
  // arrow keys move along the tabs (the ARIA tabs pattern); Home and End jump to either end
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const i = TABS.findIndex((t) => t.id === tab)
    const to = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1
    if (to < 0) return
    e.preventDefault()
    open(TABS[to].id)
    document.getElementById(`tab-${TABS[to].id}`)?.focus()
  }
  return (
    <>
      <header className="topbar">
        <BrandMark label="autobattler" paused={tab === 'arena'} />
        <nav className="tabs" role="tablist" aria-label="Screens" onKeyDown={onKeyDown}>
          {TABS.map((t) => (
            <button key={t.id} id={`tab-${t.id}`} className="tab" role="tab" aria-selected={tab === t.id} aria-controls="screen" tabIndex={tab === t.id ? 0 : -1} onClick={() => open(t.id)}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                {t.icon}
              </svg>
              <span className="tab-text">
                <span className="tab-label">{t.label}</span>
                <span className="tab-hint" aria-hidden="true">
                  {t.hint}
                </span>
              </span>
            </button>
          ))}
        </nav>
        <div className="topbar-end">
          <button className="theme-toggle" onClick={toggleTheme} aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'} title={theme === 'light' ? 'Dark mode' : 'Light mode'}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {theme === 'light' ? (
                <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z" fill="currentColor" />
              ) : (
                <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                  <circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none" />
                  <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
                </g>
              )}
            </svg>
          </button>
        </div>
      </header>
      <div id="screen" className="screen" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'arena' && (
          <Suspense fallback={<p className="screen-loading">Loading the Arena…</p>}>
            <ArenaScreen />
          </Suspense>
        )}
        {tab === 'loadout' && <LoadoutScreen onEdit={(record) => openInForge({ record })} onRemix={(build) => openInForge({ initial: remixOf(build) })} onForge={() => openInForge({})} />}
        {forgeKept && (
          <div className="kept" hidden={tab !== 'forge'}>
            <ForgeScreen key={forge.key} record={forge.record} initial={forge.initial} />
          </div>
        )}
      </div>
    </>
  )
}

/** A remix starts a new hero: the same kit and stats, its own name, and no tie to the original. */
function remixOf(build: Build): Build {
  const { heroId: _original, ...rest } = build
  return { ...rest, heroName: `${build.heroName} Remix`.slice(0, 60), gate: { state: 'draft' } }
}
