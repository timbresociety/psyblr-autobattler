import { useCallback, useEffect, useState } from 'react'
import type { Build } from '../../charter/build'
import { SIZES } from '../../charter/sizes'
import type { RoleId } from '../../charter/types'
import { DEMO_HEROES, FACTION_NAME, demoBuild } from '../../arena/demo/roster'
import { liveDeps, type BuildRecord, type HeroResult, type LoadoutDeps } from '../api'
import { heroHue } from '../common/hero-look'
import { HeroPortrait } from '../common/portrait'
import { RoleBadge } from '../common/RoleIcon'
import './loadout.css'

export const SEARCH_DEBOUNCE_MS = 250

const GATE_LABEL: Record<Build['gate']['state'], string> = { draft: 'Needs a balance check', checking: 'Checking', ready: 'Ready', blocked: 'Blocked' }

/** The 20 heroes every loadout starts with, the same ones staging's row shows (src/arena/demo/roster.ts). */
const STARTERS = DEMO_HEROES.map((hero) => ({ hero, build: demoBuild(hero) }))

interface Props {
  deps?: LoadoutDeps
  /** Open one of your heroes in the Forge. */
  onEdit: (record: BuildRecord) => void
  /** Start a new hero in the Forge from a copy of this one. */
  onRemix: (build: Build) => void
  /** Go and make a hero. */
  onForge: () => void
}

/**
 * The Loadout (R18): the heroes this device has made or added, and the global loadout to search and add from. Nobody
 * loads the thousands of heroes everyone has made, only the ones they chose; adding one is free.
 */
export function LoadoutScreen({ deps = liveDeps, onEdit, onRemix, onForge }: Props) {
  const [mine, setMine] = useState<BuildRecord[]>()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<HeroResult[]>([])
  const [searched, setSearched] = useState('')
  const [popular, setPopular] = useState<HeroResult[]>([])
  const [failed, setFailed] = useState(false)
  const [acting, setActing] = useState<string>()
  const [confirming, setConfirming] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const refresh = useCallback(() => deps.listBuilds().then(setMine, () => setMine([])), [deps])
  useEffect(() => {
    refresh()
    deps.popular().then(setPopular, () => setPopular([]))
  }, [deps, refresh])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearched('')
      setFailed(false)
      return
    }
    let live = true
    const timer = setTimeout(
      () =>
        deps.search(q).then(
          (heroes) => live && (setResults(heroes), setSearched(q), setFailed(false)),
          () => live && (setResults([]), setSearched(q), setFailed(true)),
        ),
      SEARCH_DEBOUNCE_MS,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, deps])

  const owned = new Set((mine ?? []).map((r) => r.heroId))

  async function add(hero: HeroResult) {
    setActing(hero.id)
    try {
      await deps.addHero(hero.id)
      setNotice(`${hero.name} joined your loadout. Place them in the Arena, or open them in the Forge to tune their build.`)
      await refresh()
    } catch {
      setNotice(`Couldn't add ${hero.name} right now. Try again in a moment.`)
    } finally {
      setActing(undefined)
    }
  }

  async function remove(record: BuildRecord) {
    setActing(record.id)
    try {
      await deps.removeBuild(record.id)
      setConfirming(undefined)
      setNotice(`${record.build.heroName} left your loadout. They stay in the global loadout, so you can add them back any time.`)
      await refresh()
    } catch {
      setNotice(`Couldn't remove ${record.build.heroName} right now. Try again in a moment.`)
    } finally {
      setActing(undefined)
    }
  }

  const list = query.trim().length >= 2 ? results : popular

  return (
    <main className="loadout">
      <header className="loadout-head">
        <div>
          <h1 className="title">Loadout</h1>
          <p className="lead">The heroes you fight with. Make new ones in the Forge, or add anyone from the global loadout for free.</p>
        </div>
        <button className="btn primary" onClick={onForge}>
          Forge a hero
        </button>
      </header>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <section className="panel mine" aria-label="Your heroes">
        <h2 className="section-title">
          Your heroes <span className="count">{(mine?.length ?? 0) + STARTERS.length}</span>
        </h2>
        {!mine ? (
          <p className="muted">Loading your heroes…</p>
        ) : mine.length === 0 ? (
          <p className="muted empty">
            You haven't made a hero of your own yet. <button className="link-btn" onClick={onForge}>Forge one</button>, or add one from the global loadout below.
          </p>
        ) : (
          <ul className="cards">
            {mine.map((record) => {
              const { heroName, roleId, sizeClass, gate } = record.build
              return (
                <li key={record.id} className={`card role-${roleId}`}>
                  <HeroPortrait hero={{ key: `build:${record.id}`, heroName, roleId, hue: heroHue(heroName), build: record.build }} photo={record.photo} />
                  <div className="card-who">
                    <strong>{heroName}</strong>
                    <span className="card-meta">
                      <RoleBadge role={roleId} />
                      <small>{SIZES[sizeClass ?? 'medium'].label}</small>
                    </span>
                    <small className={`gate-chip ${gate.state}`}>{GATE_LABEL[gate.state]}</small>
                  </div>
                  {confirming === record.id ? (
                    <div className="card-actions" role="group" aria-label={`Remove ${heroName}?`}>
                      <span className="confirm-text">Remove {heroName}?</span>
                      <button className="btn sm danger" disabled={acting === record.id} onClick={() => remove(record)}>
                        Remove
                      </button>
                      <button className="btn sm ghost" onClick={() => setConfirming(undefined)}>
                        Keep
                      </button>
                    </div>
                  ) : (
                    <div className="card-actions">
                      <button className="btn sm primary" onClick={() => onEdit(record)}>
                        Edit in Forge
                      </button>
                      <button className="btn sm ghost" onClick={() => onRemix(record.build)}>
                        Remix
                      </button>
                      <button className="btn sm quiet" aria-label={`Remove ${heroName}`} onClick={() => setConfirming(record.id)}>
                        Remove
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <h3 className="field-label starters-head">Starter heroes · {STARTERS.length}</h3>
        <ul className="cards starters" aria-label="Starter heroes">
          {STARTERS.map(({ hero, build }) => (
            <li key={hero.heroName} className={`card role-${build.roleId}`}>
              <HeroPortrait hero={{ key: `demo:${hero.heroName}`, heroName: build.heroName, roleId: build.roleId, hue: hero.hue, build }} />
              <div className="card-who">
                <strong>{build.heroName}</strong>
                <span className="card-meta">
                  <RoleBadge role={build.roleId} />
                  <small>{SIZES[build.sizeClass ?? 'medium'].label}</small>
                </span>
                <small className="gate-chip starter">Starter · {FACTION_NAME[hero.faction]}</small>
              </div>
              <div className="card-actions">
                <button className="btn sm ghost" onClick={() => onRemix(build)}>
                  Remix in Forge
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel global" aria-label="Global loadout">
        <div className="global-head">
          <h2 className="section-title">Global loadout</h2>
          <label className="field search-field">
            <span className="sr-only">Search the global loadout</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name: Goku, Jensen, Luffy…" />
          </label>
        </div>
        {failed && <p className="inline-error">Couldn't reach the global loadout. Try again in a moment.</p>}
        <p className="field-label">{query.trim().length >= 2 ? (searched && !results.length && !failed ? `No hero called “${searched}” yet. Forge one.` : 'Matches') : 'Most used'}</p>
        {list.length > 0 && (
          <ul className="results">
            {list.map((hero) => (
              <li key={hero.id} className="result">
                <HeroPortrait hero={{ key: `hero:${hero.id}`, heroName: hero.name, roleId: hero.roleId as RoleId }} photo={hero.photo} />
                <span className="result-who">
                  <strong>{hero.name}</strong>
                  <span className="card-meta">
                    <RoleBadge role={hero.roleId as RoleId} />
                    <small>used {hero.useCount}×</small>
                  </span>
                </span>
                {owned.has(hero.id) ? (
                  <span className="owned">In your loadout</span>
                ) : (
                  <button className="btn sm primary" disabled={acting === hero.id} onClick={() => add(hero)}>
                    Add free
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!list.length && query.trim().length < 2 && <p className="muted">Nobody has made a hero yet. Yours could be the first.</p>}
      </section>
    </main>
  )
}
