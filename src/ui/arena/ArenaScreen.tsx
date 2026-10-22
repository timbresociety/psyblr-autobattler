import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { armyModifiers } from '../../charter/synergy'
import { attachControls } from '../../arena/client/controls'
import { createEffects } from '../../arena/client/effects/player'
import { ControlHud, MatchHud } from './MatchHud'
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
  const [locked, setLocked] = useState(false)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    if (!host.current) return
    let cancelled = false
    let live: ArenaController | undefined
    let detach: (() => void) | undefined
    const setup = matchSetup(staged)
    startArena(host.current, setup, (done, total) => !cancelled && setProgress({ done, total }))
      .then((c) => {
        live = c
        if (cancelled) return c.stop()
        const effects = createEffects(c, setup.packages)
        c.hooks.events = effects.events
        c.hooks.timeScale = effects.timeScale
        // shake rides on top of wherever the cameras put the view this frame
        c.hooks.frame = (dt) => {
          effects.frame(dt)
          c.camera.position.add(effects.shake())
        }
        c.hooks.released = () => c.cameras.set('free')
        detach = attachControls(c, host.current!, (on) => {
          setLocked(on)
          if (on) setStarted(true)
        })
        setController(c)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
      detach?.()
      live?.stop()
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
        <Live controller={controller} staged={staged} locked={locked} started={started} onLeave={onBack} />
      )}
    </div>
  )
}

function Live({ controller, staged, locked, started, onLeave }: { controller: ArenaController; staged: StagingResult; locked: boolean; started: boolean; onLeave: () => void }) {
  const state: HudState = useSyncExternalStore(controller.store.subscribe, controller.store.get)
  const builds = staged.formation[staged.side].map((p) => staged.loadout[p.hero].build)
  const controlled = state.controlled !== undefined ? state.heroes[state.controlled] : undefined
  return (
    <>
      <MatchHud state={state} side={staged.side} builds={builds} />
      {controlled && <ControlHud hero={controlled} />}
      {state.winner !== undefined && (
        <p className="arena-result">
          {state.winner === 'draw' ? 'Draw' : state.winner === staged.side ? 'Your side wins' : 'Enemy side wins'} · {state.reason === 'wipe' ? 'wipe' : 'time out'}
        </p>
      )}
      {!locked && state.winner === undefined && (
        <div className="arena-hint" role="status">
          {started ? (
            <>
              <p>Mouse released.</p>
              <p className="row">
                <button className="primary" onClick={() => document.querySelector<HTMLCanvasElement>('.arena-canvas canvas')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))}>
                  Resume
                </button>
                <button onClick={onLeave}>Leave match</button>
              </p>
            </>
          ) : (
            <p>Click the arena to look around. Keys 1-0 take your heroes; Tab hands back.</p>
          )}
        </div>
      )}
    </>
  )
}
