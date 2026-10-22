import { useEffect, useState } from 'react'
import type { HeroResult } from '../api'

export const SEARCH_DEBOUNCE_MS = 250

interface Props {
  query: string
  search: (q: string) => Promise<HeroResult[]>
  onAdd: (hero: HeroResult) => void
  /** True while an add is in flight; the buttons are disabled so one click adds once. */
  adding?: boolean
}

/** While the player types a name, heroes already in the global loadout appear; adding one is free (R18, F2). */
export function LoadoutSearch({ query, search, onAdd, adding = false }: Props) {
  const [results, setResults] = useState<HeroResult[]>([])
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [dismissed, setDismissed] = useState('')

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setFailed(false)
      return
    }
    let live = true
    const timer = setTimeout(() => {
      search(q).then(
        (heroes) => live && (setResults(heroes), setFailed(false)),
        () => live && (setResults([]), setFailed(true)),
      )
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, search, attempt])

  if (query.trim().length < 2 || dismissed === query) return null
  return (
    <div className="loadout-search" aria-label="Global loadout">
      {failed && (
        <p className="inline-error">
          Couldn't reach the global loadout. <button className="ghost" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
        </p>
      )}
      {results.length > 0 && (
        <ul>
          {results.map((hero) => (
            <li key={hero.id}>
              {hero.photo ? <img src={hero.photo} alt="" /> : <span className="dot">{hero.name.slice(0, 1)}</span>}
              <span className="who">
                <strong>{hero.name}</strong>
                <small>
                  {hero.roleId} · used {hero.useCount}×
                </small>
              </span>
              <button onClick={() => onAdd(hero)} disabled={adding}>
                Add free
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="ghost" onClick={() => setDismissed(query)}>
        Build my own
      </button>
    </div>
  )
}
