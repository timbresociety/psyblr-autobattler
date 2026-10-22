import { lazy, Suspense, useState } from 'react'
import { CreatorScreen } from './creator/CreatorScreen'

// the Forge (and the sim it prices sizes with) loads only when its tab opens
const ForgeScreen = lazy(() => import('./forge/ForgeScreen').then((m) => ({ default: m.ForgeScreen })))

// the arena bench (U1) opens on its own with `?bench` and loads three's WebGPU build only there
const BenchScreen = lazy(() => import('./arena/BenchScreen').then((m) => ({ default: m.BenchScreen })))

type Tab = 'forge' | 'creator'

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
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(window.location.search).has('signin') ? 'forge' : 'creator'))
  return (
    <>
      <nav className="tabs" role="tablist" aria-label="Screens">
        {(['forge', 'creator'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === 'forge' ? 'Forge' : 'Creator'}
          </button>
        ))}
      </nav>
      {tab === 'forge' ? (
        <Suspense fallback={<p className="muted">Loading the Forge…</p>}>
          <ForgeScreen />
        </Suspense>
      ) : (
        <CreatorScreen />
      )}
    </>
  )
}
