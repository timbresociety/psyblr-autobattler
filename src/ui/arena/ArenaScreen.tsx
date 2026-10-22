import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { armyModifiers } from '../../charter/synergy'
import { canRender, startArena, type ArenaController, type HudState } from '../../arena/client/match-view'
import { DEMO_HEROES, demoBuild } from '../../arena/demo/roster'
import { Loading, Unsupported } from './Loading'
import './arena.css'

/** The Arena (U13): a staged fight between two armies, played by the AI and drawn live. */
export function ArenaScreen() {
  const host = useRef<HTMLDivElement>(null)
  const [controller, setController] = useState<ArenaController>()
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState<string>()
  const supported = canRender()

  useEffect(() => {
    if (!supported || !host.current) return
    let cancelled = false
    let started: ArenaController | undefined
    const moguls = DEMO_HEROES.filter((h) => h.faction === 'mogul').map(demoBuild)
    const leaders = DEMO_HEROES.filter((h) => h.faction === 'leader').map(demoBuild)
    startArena(host.current, { teams: [armyModifiers(moguls), armyModifiers(leaders)], seed: 1, side: 0 }, (done, total) => !cancelled && setProgress({ done, total }))
      .then((c) => {
        started = c
        if (cancelled) c.stop()
        else setController(c)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
      started?.stop()
    }
  }, [supported])

  if (!supported) return <Unsupported />
  return (
    <div className="arena">
      <div ref={host} className="arena-canvas" />
      {error ? <div className="arena-overlay" role="alert"><p>The arena failed to start: {error}</p></div> : !controller ? <Loading {...progress} /> : <MatchStatus controller={controller} />}
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
