import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import type { Build } from '../../charter/build'
import { canRender } from '../../arena/client/match-view'
import { STARTERS, starterBuild } from '../../arena/starters'
import { liveDeps, type BuildRecord } from '../api'
import { Fight, KitReel, TryIt } from './ArenaScreen'
import { Unsupported } from './Loading'
import { Staging, type StagingResult } from './staging/Staging'
import { courseStaging } from './staging/try-it'
import './arena.css'

/**
 * The matches staged this visit, by the id in their address (`/match/:id`). They live only in this tab: a reload of
 * a match's address goes back to the lobby, where the last staging is waiting.
 */
const staged = new Map<string, StagingResult>()
let lastStaged: StagingResult | undefined
let nextMatch = 1

/** `/lobby`: squads, sides and AI levels (GAME.md §11); Start drops into `/match/:id`. */
export function LobbyScreen() {
  const navigate = useNavigate()
  if (!canRender()) return <Unsupported />
  return (
    <Staging
      initial={lastStaged}
      onStart={(result) => {
        const id = `${Date.now().toString(36)}-${nextMatch++}`
        staged.set(id, result)
        lastStaged = result
        navigate(`/match/${id}`)
      }}
    />
  )
}

/** `/match/:id`: the fight; leaving goes back to the lobby with the staging kept for a rematch. */
export function MatchScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [round, setRound] = useState(0)
  const match = staged.get(id)
  if (!match) return <Navigate to="/lobby" replace />
  if (!canRender()) return <Unsupported />
  return <Fight key={round} staged={match} onBack={() => navigate('/lobby')} onRestart={() => setRound((r) => r + 1)} back="Back to the lobby" />
}

type Drill = 'dummy' | 'reel' | 'course'
const DRILLS: readonly { id: Drill; label: string; hint: string }[] = [
  { id: 'dummy', label: 'Dummy', hint: 'Every button on a training dummy that never fights back' },
  { id: 'reel', label: 'Kit reel', hint: 'Each move played in turn, from the shoulder, the side and the front' },
  { id: 'course', label: 'Traversal course', hint: 'Cross the whole House of Instinct to the dummy at the far muster' },
]

/** A hero the range can take: one of yours, or a starter. */
interface Pick {
  key: string
  name: string
  build: Build
}

/** `/range`: the training range (GAME.md §11): a dummy, the kit reel and the traversal course, for any hero. */
export function RangeScreen() {
  const [params, setParams] = useSearchParams()
  const [mine, setMine] = useState<BuildRecord[]>()
  const [running, setRunning] = useState<Drill>()
  const [round, setRound] = useState(0)
  useEffect(() => {
    let gone = false
    liveDeps
      .listBuilds()
      .then((all) => !gone && setMine(all))
      .catch(() => !gone && setMine([]))
    return () => {
      gone = true
    }
  }, [])
  const picks: Pick[] = [...(mine ?? []).map((r) => ({ key: r.id, name: r.build.heroName, build: r.build })), ...STARTERS.map((s) => ({ key: `starter:${s.id}`, name: s.build.heroName, build: starterBuild(s) }))]
  const chosen = picks.find((p) => p.key === params.get('hero')) ?? picks[0]
  const drill = (DRILLS.find((d) => d.id === params.get('drill')) ?? DRILLS[0]).id
  if (!canRender()) return <Unsupported />
  if (running && chosen) {
    const close = () => setRunning(undefined)
    if (running === 'dummy') return <TryIt build={chosen.build} onClose={close} back="Back to the range" />
    if (running === 'reel') return <KitReel build={chosen.build} onClose={close} />
    return <Fight key={round} staged={courseStaging(chosen.build)} onBack={close} onRestart={() => setRound((r) => r + 1)} back="Back to the range" />
  }
  const set = (key: string, value: string) => setParams((p) => (p.set(key, value), p), { replace: true })
  return (
    <section className="range">
      <header className="range-head">
        <h1>Training range</h1>
        <p>Pick a hero and a drill. Nothing here counts; the dummy never fights back.</p>
      </header>
      <div className="range-body">
        <fieldset className="range-heroes">
          <legend>Hero</legend>
          {mine === undefined && <p className="muted">Looking for your heroes…</p>}
          <ul>
            {picks.map((p) => (
              <li key={p.key}>
                <label className={p.key === chosen?.key ? 'chosen' : undefined}>
                  <input type="radio" name="hero" checked={p.key === chosen?.key} onChange={() => set('hero', p.key)} />
                  {p.name}
                  {p.key.startsWith('starter:') ? <span className="muted"> · starter</span> : null}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <fieldset className="range-drills">
          <legend>Drill</legend>
          {DRILLS.map((d) => (
            <label key={d.id} className={d.id === drill ? 'chosen' : undefined}>
              <input type="radio" name="drill" checked={d.id === drill} onChange={() => set('drill', d.id)} />
              <strong>{d.label}</strong>
              <span>{d.hint}</span>
            </label>
          ))}
          <button className="btn primary big" disabled={!chosen} onClick={() => setRunning(drill)}>
            Start {chosen ? `with ${chosen.name}` : ''}
          </button>
          <p className="muted">
            Or <Link to="/create">forge a new hero</Link> first.
          </p>
        </fieldset>
      </div>
    </section>
  )
}
