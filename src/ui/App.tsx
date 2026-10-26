import { lazy, Suspense, useState } from 'react'
import { CreatorScreen } from './creator/CreatorScreen'

// the Forge (and the sim it prices sizes with) loads only when its tab opens
const ForgeScreen = lazy(() => import('./forge/ForgeScreen').then((m) => ({ default: m.ForgeScreen })))

type Tab = 'forge' | 'creator'

export function App() {
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
