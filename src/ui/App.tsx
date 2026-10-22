import { useState } from 'react'
import { CreatorScreen } from './creator/CreatorScreen'
import { ForgeScreen } from './forge/ForgeScreen'

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
      {tab === 'forge' ? <ForgeScreen /> : <CreatorScreen />}
    </>
  )
}
