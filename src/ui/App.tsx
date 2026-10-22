import { lazy, Suspense, useState } from 'react'
import { CreatorScreen } from './creator/CreatorScreen'

// the Forge (and the sim it prices sizes with) loads only when its tab opens
const ForgeScreen = lazy(() => import('./forge/ForgeScreen').then((m) => ({ default: m.ForgeScreen })))

// the arena bench (U1) opens on its own with `?bench` and loads three's WebGPU build only there
const BenchScreen = lazy(() => import('./arena/BenchScreen').then((m) => ({ default: m.BenchScreen })))
// the Arena loads three's WebGPU build, the engine and the AI only when its tab opens
const ArenaScreen = lazy(() => import('./arena/ArenaScreen').then((m) => ({ default: m.ArenaScreen })))

type Tab = 'forge' | 'creator' | 'arena'

export function App() {
  if (new URLSearchParams(window.location.search).has('bench')) {
    return (
      <Suspense fallback={<p className="muted">Loading the bench…</p>}>
        <BenchScreen />
      </Suspense>
    )
  }
  return <Screens />
}

function Screens() {
  // a sign-in link always opens the Forge, since only forging needs an account
  const [tab, setTab] = useState<Tab>(() => {
    const q = new URLSearchParams(window.location.search)
    return q.has('signin') ? 'forge' : q.has('arena') ? 'arena' : 'creator'
  })
  return (
    <>
      <nav className="tabs" role="tablist" aria-label="Screens">
        {(['arena', 'forge', 'creator'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === 'arena' ? 'Arena' : t === 'forge' ? 'Forge' : 'Creator'}
          </button>
        ))}
      </nav>
      {tab === 'arena' ? (
        <Suspense fallback={<p className="muted">Loading the Arena…</p>}>
          <ArenaScreen />
        </Suspense>
      ) : tab === 'forge' ? (
        <Suspense fallback={<p className="muted">Loading the Forge…</p>}>
          <ForgeScreen />
        </Suspense>
      ) : (
        <CreatorScreen />
      )}
    </>
  )
}
