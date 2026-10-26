import { useEffect, useState } from 'react'
import type { RoleId } from '../../charter/types'
import type { HeroResult } from '../api'
import { HeroPortrait } from '../common/portrait'
import { RoleBadge } from '../common/RoleIcon'

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
          Couldn't reach the global loadout.{' '}
          <button className="link-btn" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </p>
      )}
      {results.length > 0 && (
        <>
          <p className="field-label">Already in the global loadout</p>
          <ul>
            {results.map((hero) => (
              <li key={hero.id} className="match">
                <HeroPortrait hero={{ key: `hero:${hero.id}`, heroName: hero.name, roleId: hero.roleId as RoleId }} photo={hero.photo} />
                <span className="who">
                  <strong>{hero.name}</strong>
                  <span className="match-meta">
                    <RoleBadge role={hero.roleId as RoleId} />
                    <small>used {hero.useCount}×</small>
                  </span>
                </span>
                <button className="btn sm primary" onClick={() => onAdd(hero)} disabled={adding}>
                  Add free
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button className="btn sm ghost own" onClick={() => setDismissed(query)}>
        Build my own
      </button>
    </div>
  )
}
