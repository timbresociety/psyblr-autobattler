import { lazy, Suspense, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { Build } from '../charter/build'
import type { BuildRecord } from './api'
import { ForgeScreen } from './forge/ForgeScreen'
import { LoadoutScreen } from './loadout/LoadoutScreen'
import './theme.css'

// the arena bench (U1) opens on its own with `?bench` and loads three's WebGPU build only there
const BenchScreen = lazy(() => import('./arena/BenchScreen').then((m) => ({ default: m.BenchScreen })))
// the Arena loads three's WebGPU build, the engine and the AI only when its tab opens
const ArenaScreen = lazy(() => import('./arena/ArenaScreen').then((m) => ({ default: m.ArenaScreen })))

type Tab = 'arena' | 'forge' | 'loadout'

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
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <span>P</span>
          </span>
          <span className="brand-word">
            <b>psyblr</b>
            <small>autobattler</small>
          </span>
        </div>
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
