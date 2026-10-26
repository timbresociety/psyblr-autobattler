import { lazy, Suspense, useState, type KeyboardEvent, type ReactNode } from 'react'
import { CreatorScreen } from './creator/CreatorScreen'
import './theme.css'

// the Forge (and the sim it prices sizes with) loads only when its tab opens
const ForgeScreen = lazy(() => import('./forge/ForgeScreen').then((m) => ({ default: m.ForgeScreen })))

// the arena bench (U1) opens on its own with `?bench` and loads three's WebGPU build only there
const BenchScreen = lazy(() => import('./arena/BenchScreen').then((m) => ({ default: m.BenchScreen })))
// the Arena loads three's WebGPU build, the engine and the AI only when its tab opens
const ArenaScreen = lazy(() => import('./arena/ArenaScreen').then((m) => ({ default: m.ArenaScreen })))

type Tab = 'forge' | 'creator' | 'arena'

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
    hint: 'Generate a hero',
    icon: (
      <>
        <path fill="currentColor" d="M2 9h14.6c2.6 0 4.6.8 5.4 1.8-1.3.6-3.1 1-5.4 1.3v.4c0 1.6-1.5 2.7-3.6 3V17h2.2c.9 0 1.5.6 1.5 1.5V20H5v-1.5c0-.9.6-1.5 1.5-1.5h2.2v-1.5C5.6 15.1 3.3 13.4 2 11z" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M9 2.5v3M5.2 3.8l1.6 2.4M12.8 3.8l-1.6 2.4" />
      </>
    ),
  },
  {
    id: 'creator',
    label: 'Creator',
    hint: 'Tune a hero’s kit',
    icon: (
      <>
        <path fill="currentColor" d="M10 2l2.1 6.1L18 10l-5.9 2L10 18l-2.1-6L2 10l5.9-1.9z" />
        <path fill="currentColor" opacity=".7" d="M18.5 13.5l1 2.6 2.5 1-2.5 1-1 2.6-1-2.6-2.5-1 2.5-1z" />
      </>
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
  // a sign-in link, or coming back from buying credits, always opens the Forge: only forging needs an account
  const q = new URLSearchParams(window.location.search)
  return q.has('signin') || q.has('purchase') || q.has('forge') ? 'forge' : q.has('arena') ? 'arena' : 'creator'
}

/** The tab lives in the address bar, so a reload comes back to the same screen. */
function rememberTab(tab: Tab) {
  const q = new URLSearchParams(window.location.search)
  q.delete('arena')
  q.delete('forge')
  if (tab !== 'creator') q.set(tab, '')
  const search = q.toString().replace(/=(?=&|$)/g, '')
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`)
}

function Screens() {
  const [tab, setTab] = useState<Tab>(initialTab)
  const open = (next: Tab) => {
    setTab(next)
    rememberTab(next)
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
      <div id="screen" key={tab} className="screen" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'arena' ? (
          <Suspense fallback={<p className="screen-loading">Loading the Arena…</p>}>
            <ArenaScreen />
          </Suspense>
        ) : tab === 'forge' ? (
          <Suspense fallback={<p className="screen-loading">Loading the Forge…</p>}>
            <ForgeScreen />
          </Suspense>
        ) : (
          <CreatorScreen />
        )}
      </div>
    </>
  )
}
