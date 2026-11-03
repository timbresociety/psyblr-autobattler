import * as THREE from 'three'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Build } from '../../charter/build'
import { armyModifiers } from '../../charter/traits'
import { attachControls } from '../../arena/client/controls'
import { createEffects } from '../../arena/client/effects/player'
import { atLeast } from '../../arena/client/quality'
import { ControlHud, MatchHud } from './MatchHud'
import { canRender, startArena, type ArenaController, type HudState, type MatchSetup } from '../../arena/client/match-view'
import { Staging, type StagingResult } from './staging/Staging'
import { arenaStaging, tryItStaging } from './staging/try-it'
import { POVS, TAKES, takeCommand } from '../forge/reel/takes'
import { ENGINE, ticks } from '../../arena/engine/calibration'
import { DEFAULT_AI_LEVEL } from '../../arena/ai/calibration'
import { noControl, type HeroState } from '../../arena/engine/state'
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

/**
 * Start the arena a moment after the screen mounts. StrictMode (development) mounts every screen twice, the first
 * time only to unmount it again at once; starting on the next task means that discarded mount aborts before it has
 * built a renderer or fetched a hero, instead of loading a whole second match alongside the real one.
 */
function startDeferred(host: HTMLElement, setup: MatchSetup, onProgress: (done: number, total: number) => void, signal: AbortSignal): Promise<ArenaController> {
  return new Promise<void>((go, stop) => {
    const t = window.setTimeout(go, 0)
    signal.addEventListener('abort', () => (window.clearTimeout(t), stop(signal.reason)), { once: true })
  }).then(() => startArena(host, setup, onProgress, signal))
}

/** A training dummy's health against an ordinary tank's: enough to try every skill on it more than once. */
const DUMMY_HEALTH = 5

/** A dev-only fixed seed (`window.__seed`), so a probe can replay the same match frame for frame; never in production. */
const devSeed = (): number | undefined => (import.meta.env.DEV && typeof window !== 'undefined' ? (window as unknown as { __seed?: number }).__seed : undefined)

/** Turn a staged formation into the engine's teams, formations and per-hero packages. */
export function matchSetup(staged: StagingResult): MatchSetup {
  const side = (s: 0 | 1) => staged.formation[s].map((p) => staged.loadout[p.hero])
  const teams = ([0, 1] as const).map((s) => armyModifiers(side(s).map((e) => e.build))) as MatchSetup['teams']
  const formations = ([0, 1] as const).map((s) => staged.formation[s].map((p) => ({ x: p.x, y: p.y ?? 0, z: p.z }))) as MatchSetup['formations']
  const setup: MatchSetup = { teams, formations, packages: [...side(0), ...side(1)].map((e) => e.pkg), seed: devSeed() ?? Date.now() % 100_000, side: staged.side, aiLevels: staged.aiLevels ?? [DEFAULT_AI_LEVEL, DEFAULT_AI_LEVEL] }
  if (!staged.dummy) return setup
  teams[1] = teams[1].map((c) => ({ ...c, mods: { ...c.mods, mul: { ...c.mods?.mul, maxHealth: DUMMY_HEALTH - 1 } } }))
  return { ...setup, idle: teams[1].map((_, j) => teams[0].length + j) }
}

/**
 * The Forge's Try it: the hero as it stands, in the real arena, against a training dummy that never fights back. The
 * AI plays the hero until the player takes control; leaving goes back to the Forge.
 */
export function TryIt({ build, onClose, against = 'dummy', back = 'Back to the Forge' }: { build: Build; onClose: () => void; against?: 'dummy' | 'arena'; back?: string }) {
  const [round, setRound] = useState(0)
  const staged = useMemo(() => (against === 'arena' ? arenaStaging(build) : tryItStaging(build)), [build, against])
  if (!canRender()) return <Unsupported />
  return <Fight key={round} staged={staged} onBack={onClose} onRestart={() => setRound((r) => r + 1)} back={back} />
}

/**
 * The Forge's kit reel: the hero plays each of its moves on a training dummy in the arena (reel/takes.ts), take after
 * take, watched over its shoulder, side on or from behind the dummy. Each take starts afresh: the two stood the
 * take's distance apart, whole, with every skill ready.
 */
/** Headings a kit reel's take may run along, the lane's own first. */
const HEADINGS = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 4, (-3 * Math.PI) / 4, Math.PI]

export function KitReel({ build, onClose, start }: { build: Build; onClose: () => void; start?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [controller, setController] = useState<ArenaController>()
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState<string>()
  // the take the Forge's kit row asked for, else the first
  const [take, setTake] = useState(() => Math.max(0, TAKES.findIndex((t) => t.key === start)))
  const now = useRef({ take: TAKES[0], start: -1 })
  now.current.take = TAKES[take]
  const staged = useMemo(() => tryItStaging(build), [build])

  useEffect(() => {
    if (!host.current) return
    let cancelled = false
    const abort = new AbortController()
    let live: ArenaController | undefined
    const setup = matchSetup(staged)
    startDeferred(host.current, setup, (done, total) => !cancelled && setProgress({ done, total }), abort.signal)
      .then((c) => {
        live = c
        if (cancelled) return c.stop()
        const m = c.arena.match
        const [me, dummy] = m.heroes
        // the hero's own spot in the open lane, the dummy the take's distance ahead of it
        const spot = { x: me.position.x, y: me.position.y, z: me.position.z }
        const fresh = (h: HeroState, position: typeof spot, yaw: number) => {
          Object.assign(h, { position: { ...position }, velocity: { x: 0, y: 0, z: 0 }, yaw, hp: h.maxHp, alive: true, airborne: false, stunnedUntil: 0, cc: noControl(), slows: [], debuffs: [], dots: [] })
          for (const key of ['action', 'launch', 'knockback', 'slide', 'queued'] as const) h[key] = undefined
        }
        let tick = 0
        c.take(0)
        c.hooks.human = () => {
          const at = now.current
          if (at.start < 0 || tick - at.start >= ticks(at.take.seconds)) {
            // the first heading from the hero's spot with a clear line to the dummy and room behind it for the camera
            const reach = at.take.gap + 4
            const from = new THREE.Vector3(spot.x, spot.y + 1.2, spot.z)
            const heading = HEADINGS.find((h) => {
              const way = new THREE.Vector3(Math.sin(h), 0, Math.cos(h))
              const hit = new THREE.Vector3()
              const ray = new THREE.Ray(from, way)
              return !c.map.proxies.some((box) => ray.intersectBox(box, hit) && hit.distanceTo(from) < reach)
            }) ?? 0
            fresh(me, spot, heading)
            fresh(dummy, { ...spot, x: spot.x + Math.sin(heading) * at.take.gap, z: spot.z + Math.cos(heading) * at.take.gap }, heading + Math.PI)
            for (const slot of Object.keys(me.cooldowns) as (keyof typeof me.cooldowns)[]) me.cooldowns[slot] = 0
            Object.assign(me, { stamina: ENGINE.move.stamina.max, combo: { step: 0, until: 0 }, basicSince: -1, buttonsHeld: 0, nextAttackAt: m.tick, blocking: false })
            m.projectiles = []
            m.fields = []
            // a wall the last take raised comes down now
            for (const w of m.walls ?? []) w.until = m.tick
            at.start = tick
          }
          const t = (tick++ - at.start) / ENGINE.tickHz
          return takeCommand(at.take, t, Math.atan2(dummy.position.x - me.position.x, dummy.position.z - me.position.z))
        }
        const effects = createEffects(c, setup.packages)
        const eye = new THREE.Vector3()
        const mid = new THREE.Vector3()
        const hit = new THREE.Vector3()
        const ray = new THREE.Ray()
        // all three points of view at once (GAME.md §11): over the shoulder fills the screen, side on and the dummy's
        // view sit in the corners
        const side = new THREE.PerspectiveCamera(50, 1, 0.1, 400)
        const facing = new THREE.PerspectiveCamera(50, 1, 0.1, 400)
        c.insets([
          { camera: side, rect: [0.66, 0.08, 0.32, 0.3] },
          { camera: facing, rect: [0.66, 0.4, 0.32, 0.3] },
        ])
        /** Put a camera where a point of view watches the take from, looking at the action. */
        const place = (pov: 'side' | 'facing', cam: THREE.PerspectiveCamera) => {
          const a = me.position
          const b = dummy.position
          const dx = b.x - a.x
          const dz = b.z - a.z
          const d = Math.hypot(dx, dz) || 1
          if (pov === 'side') {
            // side on from whichever side the map leaves open
            const far = Math.max(6, d * 0.8 + 3)
            mid.set((a.x + b.x) / 2, Math.max(a.y, b.y) + 1.4, (a.z + b.z) / 2)
            const clear = (sign: number) => {
              eye.set(mid.x + sign * (dz / d) * far, mid.y + 0.4, mid.z - sign * (dx / d) * far)
              ray.set(mid, eye.clone().sub(mid).normalize())
              return !c.map.proxies.some((box) => (ray.intersectBox(box, hit) ? hit.distanceTo(mid) < far : false))
            }
            if (!clear(1) && !clear(-1)) clear(1)
            mid.set((a.x + b.x) / 2, a.y + 1.1, (a.z + b.z) / 2)
          } else {
            // behind the dummy and over its shoulder, so its own head never hides the hero
            eye.set(b.x + (dx / d) * 3.4 - (dz / d) * 1.3, b.y + 2.1, b.z + (dz / d) * 3.4 + (dx / d) * 1.3)
            mid.set(a.x, a.y + 1.1, a.z)
          }
          cam.position.copy(eye)
          cam.lookAt(mid)
        }
        c.hooks.on('frame', () => {
          const a = me.position
          const b = dummy.position
          c.cameras.set('hero')
          c.cameras.yaw = Math.atan2(b.x - a.x, b.z - a.z)
          c.cameras.pitch = -0.12
          place('side', side)
          place('facing', facing)
        })
        c.hooks.on('events', effects.events)
        c.hooks.timeScale = effects.timeScale
        c.hooks.on('frame', (dt) => {
          effects.frame(dt)
          c.camera.position.add(effects.shake())
          c.screen(effects.screen())
        })
        setController(c)
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
      abort.abort()
      live?.stop()
    }
  }, [staged])

  const pick = (k: number) => {
    setTake(k)
    now.current.start = -1
  }
  const shown = TAKES[take]
  return (
    <div className="arena kit-reel">
      <div ref={host} className="arena-canvas" />
      {error ? (
        <div className="arena-overlay hud-screen" role="alert">
          <p>The arena failed to start: {error}</p>
          <button className="hud-btn primary big" onClick={onClose}>
            Back to the Forge
          </button>
        </div>
      ) : !controller ? (
        <Loading {...progress} label="Setting up the kit reel" />
      ) : (
        <div className="reel-hud">
          <nav className="reel-takes" aria-label="Moves">
            {TAKES.map((t, k) => (
              <button key={t.key} type="button" className={`hud-btn${k === take ? ' on' : ''}`} aria-pressed={k === take} onClick={() => pick(k)}>
                <b>{t.label}</b>
                <kbd>{t.keys}</kbd>
              </button>
            ))}
          </nav>
          <ul className="reel-povs" aria-label="Points of view">
            {POVS.map((p, i) => (
              <li key={p.key} className={`reel-pov reel-pov-${i}`}>
                {p.label}
              </li>
            ))}
          </ul>
          <p className="reel-caption" role="status">
            {shown.label}: <kbd>{shown.keys}</kbd>
          </p>
          <div className="reel-close">
            <button type="button" className="hud-btn primary" onClick={onClose}>
              Back to the Forge
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function Fight({ staged, onBack, onRestart, back = 'Back to staging' }: { staged: StagingResult; onBack: () => void; onRestart: () => void; back?: string }) {
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
    const abort = new AbortController()
    let live: ArenaController | undefined
    let detach: (() => void) | undefined
    const setup = matchSetup(staged)
    startDeferred(host.current, setup, (done, total) => !cancelled && setProgress({ done, total }), abort.signal)
      .then((c) => {
        live = c
        if (cancelled) return c.stop()
        // nothing ticks until the countdown ends (R39)
        c.pause()
        const effects = createEffects(c, setup.packages)
        // a dev-only handle, like `__arena`: a script can play effects by hand to check how they look (never in production)
        // (the live arena sets `__arena` again: under StrictMode a discarded first load can take the handle and clear it)
        if (import.meta.env.DEV) Object.assign(window, { __fx: effects, __arena: c })
        c.hooks.on('events', effects.events)
        c.hooks.timeScale = effects.timeScale
        // shake rides on top of wherever the cameras put the view this frame
        c.hooks.on('frame', (dt) => {
          effects.frame(dt)
          c.camera.position.add(effects.shake())
          c.screen(effects.screen())
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
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
      abort.abort()
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
            {back}
          </button>
        </div>
      ) : !controller ? (
        <Loading {...progress} />
      ) : (
        <>
          <Live controller={controller} staged={staged} locked={locked} help={help} onHelp={setHelp} paused={menu || counting} onLeave={onBack} onRematch={onRestart} back={back} />
          {splash && <Countdown onDone={countdownDone} onFinished={splashDone} />}
          {menu && <PauseMenu onResume={resume} onRestart={onRestart} onBack={onBack} back={back} />}
        </>
      )}
    </div>
  )
}

export function Live({ controller, staged, locked, help, onHelp, paused, onLeave, onRematch, back }: { controller: ArenaController; staged: StagingResult; locked: boolean; help: boolean; onHelp: (on: boolean) => void; paused: boolean; onLeave: () => void; onRematch: () => void; back: string }) {
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
      {over && <Result state={state} side={staged.side} heroes={heroes} onRematch={onRematch} onBack={onLeave} back={back} />}
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
