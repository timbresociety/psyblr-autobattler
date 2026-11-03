import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router'
import { remixBuild, type Build } from '../charter/build'
import { liveDeps, type BuildRecord } from './api'
import { BrandMark } from './brand/BrandMark'
import './theme.css'

// every route loads only when it opens (GAME.md §11); the 3D ones bring three's WebGPU build, the engine and the AI
const HomeScreen = lazy(() => import('./home/HomeScreen').then((m) => ({ default: m.HomeScreen })))
const LobbyScreen = lazy(() => import('./arena/routes').then((m) => ({ default: m.LobbyScreen })))
const MatchScreen = lazy(() => import('./arena/routes').then((m) => ({ default: m.MatchScreen })))
const RangeScreen = lazy(() => import('./arena/routes').then((m) => ({ default: m.RangeScreen })))
const CreditsScreen = lazy(() => import('./credits/CreditsScreen').then((m) => ({ default: m.CreditsScreen })))
const ForgeScreen = lazy(() => import('./forge/ForgeScreen').then((m) => ({ default: m.ForgeScreen })))
const GachaReveal = lazy(() => import('./create/GachaReveal').then((m) => ({ default: m.GachaReveal })))
const DevRoutes = lazy(() => import('./dev/DevRoutes').then((m) => ({ default: m.DevRoutes })))

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

const TABS: readonly { id: string; label: string; hint: string; icon: ReactNode }[] = [
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

const NAV: readonly { to: string; label: string; hint: string; icon: ReactNode; match: (path: string) => boolean }[] = [
  { to: '/', label: 'Heroes', hint: 'Your heroes', icon: TABS[2].icon, match: (p) => p === '/' },
  { to: '/create', label: 'Forge', hint: 'Make a hero', icon: TABS[1].icon, match: (p) => p.startsWith('/create') || p.startsWith('/forge') },
  { to: '/lobby', label: 'Arena', hint: 'Stage a battle', icon: TABS[0].icon, match: (p) => p.startsWith('/lobby') || p.startsWith('/match') },
  {
    to: '/range',
    label: 'Range',
    hint: 'Train a hero',
    icon: (
      <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="12" cy="12" r="0.8" fill="currentColor" />
      </g>
    ),
    match: (p) => p.startsWith('/range'),
  },
]

const loading = (what: string) => <p className="screen-loading">Loading {what}…</p>

/** The routes of GAME.md §11. */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/dev/*"
          element={
            <Suspense fallback={loading('the dev tools')}>
              <DevRoutes />
            </Suspense>
          }
        />
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="create" element={null} />
          <Route path="forge" element={<Navigate to="/create" replace />} />
          {/* the Layout keeps the Forge itself mounted, so these two routes draw nothing of their own */}
          <Route path="forge/:heroId" element={null} />
          <Route path="lobby" element={<Suspense fallback={loading('the lobby')}>{<LobbyScreen />}</Suspense>} />
          <Route path="match/:id" element={<Suspense fallback={loading('the match')}>{<MatchScreen />}</Suspense>} />
          <Route path="range" element={<Suspense fallback={loading('the range')}>{<RangeScreen />}</Suspense>} />
          <Route path="credits" element={<Suspense fallback={loading('the credits')}>{<CreditsScreen />}</Suspense>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

/**
 * The old addresses were query flags on one page (`?arena`, `?loadout`, `?bench`, `?soak`, `?wardrobe`, `?physique`);
 * they still work, by sending the visitor to the route that replaced them with the rest of the query kept.
 */
export function legacyRoute(search: string): string | undefined {
  const q = new URLSearchParams(search)
  const moves: [string, string][] = [
    ['arena', '/lobby'],
    ['loadout', '/'],
    ['bench', '/dev/bench'],
    ['soak', '/dev/soak'],
    // the wardrobe went with the outfits (2026-11-04)
    ['wardrobe', '/dev'],
    ['physique', '/dev/physique'],
  ]
  for (const [flag, to] of moves) {
    if (!q.has(flag)) continue
    q.delete(flag)
    const rest = q.toString().replace(/=(?=&|$)/g, '')
    return rest ? `${to}?${rest}` : to
  }
  return undefined
}

function Home() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const legacy = legacyRoute(params.toString() ? `?${params}` : '')
  if (legacy && legacy !== '/') return <Navigate to={legacy} replace />
  return (
    <Suspense fallback={loading('your heroes')}>
      <HomeScreen onEdit={(record) => navigate(`/forge/${record.id}`, { state: { record } })} onRemix={(build) => navigate('/create', { state: { initial: remixBuild(build) } })} onForge={() => navigate('/create', { state: { fresh: true } })} />
    </Suspense>
  )
}

/** What the Forge has open: a saved hero, a copy to remix, or a blank slate. A new key starts it over. */
interface ForgeOpen {
  key: number
  mode: 'create' | 'edit'
  record?: BuildRecord
  initial?: Build
}

/**
 * The page around every route: the bar along the top and the Forge, which stays mounted once opened, so leaving it for
 * the lobby or the range never loses an unsaved hero.
 */
function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [theme, toggleTheme] = useTheme()
  const path = location.pathname
  const inForge = path === '/create' || path.startsWith('/forge/')
  const [forge, setForge] = useState<ForgeOpen>()
  const [missing, setMissing] = useState<string>()
  const [reveal, setReveal] = useState<{ buildId: string; build: Build }>()
  const keys = useRef(0)
  const state = location.state as { initial?: Build; record?: BuildRecord; fresh?: boolean } | null
  const heroId = path.startsWith('/forge/') ? decodeURIComponent(path.slice('/forge/'.length)) : undefined

  // keep the Forge in step with the address: a new hero on /create, the saved one on /forge/:heroId
  useEffect(() => {
    if (path === '/create') {
      if (state?.initial || state?.fresh || forge?.mode !== 'create') setForge({ key: ++keys.current, mode: 'create', initial: state?.initial })
      if (state?.initial || state?.fresh) navigate('/create', { replace: true, state: null })
      return
    }
    if (!heroId || forge?.record?.id === heroId) return
    if (state?.record?.id === heroId) {
      setForge({ key: ++keys.current, mode: 'edit', record: state.record })
      return
    }
    // a hero opened from its address: fetched from this device's heroes
    let gone = false
    setMissing(undefined)
    liveDeps
      .listBuilds()
      .then((all) => {
        if (gone) return
        const record = all.find((r) => r.id === heroId)
        if (record) setForge({ key: ++keys.current, mode: 'edit', record })
        else setMissing(heroId)
      })
      .catch(() => !gone && setMissing(heroId))
    return () => {
      gone = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, heroId, state])

  return (
    <>
      <header className="topbar">
        <BrandMark label="autobattler" paused={path.startsWith('/match') || path.startsWith('/range')} />
        <nav className="tabs" aria-label="Screens">
          {NAV.map((t) => (
            <Link key={t.to} to={t.to} className="tab" aria-current={t.match(path) ? 'page' : undefined} state={t.to === '/create' && forge?.mode !== 'create' ? { fresh: true } : undefined}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                {t.icon}
              </svg>
              <span className="tab-text">
                <span className="tab-label">{t.label}</span>
                <span className="tab-hint" aria-hidden="true">
                  {t.hint}
                </span>
              </span>
            </Link>
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
      <main id="screen" className="screen">
        {!inForge && <Outlet />}
        {inForge && heroId && missing === heroId && (
          <div className="screen-loading">
            <p>That hero isn&apos;t on this device.</p>
            <Link to="/">Back to your heroes</Link>
          </div>
        )}
        {inForge && heroId && missing !== heroId && forge?.record?.id !== heroId && loading('your hero')}
        {forge && (
          <div className="kept" hidden={!inForge || (heroId !== undefined && forge.record?.id !== heroId)}>
            <Suspense fallback={loading('the Forge')}>
              <ForgeScreen
                key={forge.key}
                record={forge.record}
                initial={forge.initial}
                onCreated={(created) => {
                  setReveal({ buildId: created.buildId, build: created.build })
                }}
              />
            </Suspense>
          </div>
        )}
        {reveal && (
          <Suspense fallback={null}>
            <GachaReveal
              build={reveal.build}
              onDone={() => {
                const id = reveal.buildId
                setReveal(undefined)
                // the new hero is now a saved one: the Forge carries on with it at its own address
                setForge((f) => (f ? { ...f, mode: 'edit', record: { id, heroId: '', build: reveal.build } } : f))
                navigate(`/forge/${encodeURIComponent(id)}`, { replace: true })
              }}
            />
          </Suspense>
        )}
      </main>
    </>
  )
}

