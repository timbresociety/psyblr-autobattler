import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { followSheen } from './ui/brand/sheen'

followSheen()

// `?cast=` names generated heroes for this tab's matches (arena/client/heroes.ts localCast)
const cast = new URLSearchParams(location.search).get('cast')
try {
  if (cast !== null) sessionStorage.setItem('local-cast', cast)
} catch {
  // no storage: no cast
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
