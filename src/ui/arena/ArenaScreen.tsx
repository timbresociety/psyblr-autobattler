import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { armyModifiers } from '../../charter/synergy'
import { attachControls } from '../../arena/client/controls'
import { createEffects } from '../../arena/client/effects/player'
import { atLeast } from '../../arena/client/quality'
import { ControlHud, MatchHud } from './MatchHud'
import { canRender, startArena, type ArenaController, type HudState, type MatchSetup } from '../../arena/client/match-view'
import { Staging, type StagingResult } from './staging/Staging'
import { Loading, Unsupported } from './Loading'
import { Countdown } from './Countdown'
import { PauseMenu } from './PauseMenu'
import { Result } from './Result'
import { hudHeroes } from './hud/model'
import { stagedPortraits } from './hud/portraits'
import { WorldHud } from './hud/WorldHud'
import './arena.css'

/** The Arena: stage two armies (U16), then watch the AI fight it out live (U13); rematches keep the staging (U18). */
export function ArenaScreen() {
  const [staged, setStaged] = useState<StagingResult>()
  const [last, setLast] = useState<StagingResult>()
  const [round, setRound] = useState(0)
  if (!canRender()) return <Unsupported />
  return staged ? (
    <Fight key={round} staged={staged} onBack={() => (setLast(staged), setStaged(undefined))} onRestart={() => setRound((r) => r + 1)} />
  ) : (
    <Staging initial={last} onStart={setStaged} />
  )
}

/** Turn a staged formation into the engine's teams, formations and per-hero packages. */
function matchSetup(staged: StagingResult): MatchSetup {
  const side = (s: 0 | 1) => staged.formation[s].map((p) => staged.loadout[p.hero])
  const teams = ([0, 1] as const).map((s) => armyModifiers(side(s).map((e) => e.build))) as MatchSetup['teams']
  const formations = ([0, 1] as const).map((s) => staged.formation[s].map((p) => ({ x: p.x, y: 0, z: p.z }))) as MatchSetup['formations']
  return { teams, formations, packages: [...side(0), ...side(1)].map((e) => e.pkg), seed: Date.now() % 100_000, side: staged.side }
}

function Fight({ staged, onBack, onRestart }: { staged: StagingResult; onBack: () => void; onRestart: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [controller, setController] = useState<ArenaController>()
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState<string>()
  const [locked, setLocked] = useState(false)
  // the camera help shows at the start of a match and whenever H is pressed
  const [help, setHelp] = useState(true)
  const [counting, setCounting] = useState(true)
  // FIGHT! stays up a moment after the countdown hands the match to the engine
  const [splash, setSplash] = useState(true)
  const [menu, setMenu] = useState(false)
  const toggleMenu = useRef(() => {})

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
        // nothing ticks until the countdown ends (R39)
        c.pause()
        const effects = createEffects(c, setup.packages)
        c.hooks.on('events', effects.events)
        c.hooks.timeScale = effects.timeScale
        // shake rides on top of wherever the cameras put the view this frame
        c.hooks.on('frame', (dt) => {
          effects.frame(dt)
          c.camera.position.add(effects.shake())
        })
        detach = attachControls(
          c,
          host.current!,
          (on) => {
            setLocked(on)
          },
          (code) => {
            if (code === 'KeyP') toggleMenu.current()
            if (code === 'KeyH') setHelp((on) => !on)
          },
        )
        setController(c)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
      detach?.()
      live?.stop()
    }
  }, [staged])

  const pause = useCallback(() => {
    if (!controller || counting || controller.arena.match.winner !== undefined) return
    controller.pause()
    if (document.pointerLockElement) document.exitPointerLock()
    setMenu(true)
  }, [controller, counting])
  const resume = useCallback(() => {
    controller?.resume()
    // resuming leaves the mouse free; a hero nobody can steer goes back to the AI
    if (controller?.arena.match.human !== undefined && !document.pointerLockElement) controller.handBack()
    setMenu(false)
  }, [controller])
  toggleMenu.current = () => (menu ? resume() : pause())

  const countdownDone = useCallback(() => {
    setCounting(false)
    controller?.resume()
  }, [controller])
  const splashDone = useCallback(() => setSplash(false), [])

  return (
    <div className="arena">
      <div ref={host} className="arena-canvas" />
      {error ? (
        <div className="arena-overlay hud-screen" role="alert">
          <p>The arena failed to start: {error}</p>
          <button className="hud-btn primary big" onClick={onBack}>
            Back to staging
          </button>
        </div>
      ) : !controller ? (
        <Loading {...progress} />
      ) : (
        <>
          <Live controller={controller} staged={staged} locked={locked} help={help} onHelp={setHelp} paused={menu || counting} onLeave={onBack} onRematch={onRestart} />
          {splash && <Countdown onDone={countdownDone} onFinished={splashDone} />}
          {menu && <PauseMenu onResume={resume} onRestart={onRestart} onBack={onBack} />}
        </>
      )}
    </div>
  )
}

function Live({ controller, staged, locked, help, onHelp, paused, onLeave, onRematch }: { controller: ArenaController; staged: StagingResult; locked: boolean; help: boolean; onHelp: (on: boolean) => void; paused: boolean; onLeave: () => void; onRematch: () => void }) {
  const state: HudState = useSyncExternalStore(controller.store.subscribe, controller.store.get)
  const builds = useMemo(() => staged.formation[staged.side].map((p) => staged.loadout[p.hero].build), [staged])
  // names, portraits and each skill's icon never change during a match: built once, not at 10 Hz
  const heroes = useMemo(() => hudHeroes(controller.arena.setups, controller.arena.match.heroes.map((h) => h.team), stagedPortraits(staged)), [controller, staged])
  const controlled = state.controlled !== undefined ? state.heroes[state.controlled] : undefined
  const over = state.winner !== undefined
  const toggleHelp = useCallback(() => onHelp(!help), [help, onHelp])
  useEffect(() => {
    if (over && document.pointerLockElement) document.exitPointerLock()
  }, [over])
  // under load the glass stops blurring the scene behind it, the same moment the stage thins its particles
  const lite = atLeast(state.quality, 'fewer-particles')
  return (
    <div className={`hud${lite ? ' hud-lite' : ''}`}>
      <WorldHud controller={controller} heroes={heroes} />
      <MatchHud state={state} side={staged.side} builds={builds} heroes={heroes} controller={controller} />
      {controlled && <ControlHud hero={controlled} info={heroes[controlled.id]} controller={controller} state={state} heroes={heroes} />}
      {over && <Result state={state} side={staged.side} heroes={heroes} onRematch={onRematch} onBack={onLeave} />}
      {!locked && !over && !paused && !controlled && <CameraHelp open={help} onToggle={toggleHelp} />}
    </div>
  )
}

/**
 * How to watch and how to play, in one line along the bottom: it shows at the start and whenever H or its button is
 * pressed, and folds to a small button the rest of the time.
 */
function CameraHelp({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  // it folds itself away once it has been read
  useEffect(() => {
    if (!open) return
    const fold = setTimeout(onToggle, 14_000)
    return () => clearTimeout(fold)
  }, [open, onToggle])
  return (
    <div className={`arena-hint camera-help${open ? ' open' : ''}`} role="status">
      {open && (
        <span className="arena-hint-text">
          <b>Drag</b> turn · <b>Right drag</b> slide · <b>Wheel</b> zoom · <kbd>WASD</kbd> move · <b>Click a hero</b> follow · <b>Double click</b> or <kbd>1</kbd>–<kbd>0</kbd> play it · <kbd>P</kbd> pause
        </span>
      )}
      <button className="hud-btn camera-help-btn" onClick={onToggle} aria-expanded={open} aria-label={open ? 'Hide camera help' : 'Show camera help'}>
        {open ? 'Got it' : '? Controls'}
      </button>
    </div>
  )
}
