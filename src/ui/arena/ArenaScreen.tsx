import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { armyModifiers } from '../../charter/synergy'
import { createEffects } from '../../arena/client/effects/player'
import { canRender, startArena, type ArenaController, type HudState, type MatchSetup } from '../../arena/client/match-view'
import { Staging, type StagingResult } from './staging/Staging'
import { Loading, Unsupported } from './Loading'
import './arena.css'

/** The Arena: stage two armies (U16), then watch the AI fight it out live (U13). */
export function ArenaScreen() {
  const [staged, setStaged] = useState<StagingResult>()
  if (!canRender()) return <Unsupported />
  return staged ? <Fight staged={staged} key={JSON.stringify(staged.formation)} onBack={() => setStaged(undefined)} /> : <Staging onStart={setStaged} />
}

/** Turn a staged formation into the engine's teams, formations and per-hero packages. */
function matchSetup(staged: StagingResult): MatchSetup {
  const side = (s: 0 | 1) => staged.formation[s].map((p) => staged.loadout[p.hero])
  const teams = ([0, 1] as const).map((s) => armyModifiers(side(s).map((e) => e.build))) as MatchSetup['teams']
  const formations = ([0, 1] as const).map((s) => staged.formation[s].map((p) => ({ x: p.x, y: 0, z: p.z }))) as MatchSetup['formations']
  return { teams, formations, packages: [...side(0), ...side(1)].map((e) => e.pkg), seed: Date.now() % 100_000, side: staged.side }
}

function Fight({ staged, onBack }: { staged: StagingResult; onBack: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [controller, setController] = useState<ArenaController>()
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!host.current) return
    let cancelled = false
    let started: ArenaController | undefined
    const setup = matchSetup(staged)
    startArena(host.current, setup, (done, total) => !cancelled && setProgress({ done, total }))
      .then((c) => {
        started = c
        if (cancelled) return c.stop()
        const effects = createEffects(c, setup.packages)
        const base = c.camera.position.clone()
        c.hooks.events = effects.events
        c.hooks.timeScale = effects.timeScale
        c.hooks.frame = (dt) => {
          effects.frame(dt)
          c.camera.position.copy(base).add(effects.shake())
        }
        setController(c)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
      started?.stop()
    }
  }, [staged])

  return (
    <div className="arena">
      <div ref={host} className="arena-canvas" />
      {error ? (
        <div className="arena-overlay" role="alert">
          <p>The arena failed to start: {error}</p>
          <button onClick={onBack}>Back to staging</button>
        </div>
      ) : !controller ? (
        <Loading {...progress} />
      ) : (
        <MatchStatus controller={controller} />
      )}
    </div>
  )
}

function MatchStatus({ controller }: { controller: ArenaController }) {
  const state: HudState = useSyncExternalStore(controller.store.subscribe, controller.store.get)
  const left = Math.max(0, state.timerSeconds - state.seconds)
  const alive = (team: 0 | 1) => state.heroes.filter((h) => h.team === team && h.alive).length
  return (
    <div className="arena-top" aria-live="polite">
      <span className="team-a">{alive(0)} alive</span>
      <span className="timer">
        {Math.floor(left / 60)}:{String(Math.floor(left % 60)).padStart(2, '0')}
      </span>
      <span className="team-b">{alive(1)} alive</span>
      {state.winner !== undefined && (
        <p className="arena-result">
          {state.winner === 'draw' ? 'Draw' : state.winner === 0 ? 'Left side wins' : 'Right side wins'} · {state.reason === 'wipe' ? 'wipe' : 'time out'}
        </p>
      )}
    </div>
  )
}
