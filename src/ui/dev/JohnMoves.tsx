import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { SIZES } from '../../charter/sizes'
import type { BuildSlot } from '../../charter/types'
import { STANCE, type AnimState, type Way } from '../../arena/client/animation'
import { loadHeroView, type HeroView } from '../../arena/client/heroes'
import { createRenderer, forceWebGLFlag } from '../../arena/client/render/renderer'
import type { MeleeBlow } from '../../arena/engine/combat'
import { LMB_FAMILIES, V_OPTIONS, lmbId, type LmbFamily, type LmbFlight, type LmbMode } from '../../arena/lab/library'
import { ATTITUDES, isAttitude } from '../../kit/anim/attitude'
import { triedHeroes, type TriedHero } from '../../kit/bench/hero-file'
import { johnBuild, johnsOf, PREFS, savedPrefs, write, type Prefs } from './john'
import './john-lab.css'

/**
 * `/dev/moves` (dev builds only): John alone on a plain floor, the camera free to circle him (drag to orbit, wheel to
 * zoom, right-drag to pan), and a button for every move his lab tests. Each button plays the move as the arena's
 * animator would see it, through the same hero view: the clip his kit picks, his weapons coming out for a blow or a
 * shot, his attitude's idle. He is the lab's John (the picks are shared with `/dev/john`), and the readout names the
 * clips playing. What the engine does around a move (shots in flight, auras, the bots) is the lab's, not this page's.
 */

/** One beat of a move: the state the body takes for so long (0: one frame), or takes in turn as `p` runs 0 to 1. */
interface Beat {
  state: AnimState | ((p: number) => AnimState)
  seconds: number
  moving?: boolean
}

interface Move {
  id: string
  label: string
  beats: (seq: () => number) => Beat[]
  /** What the body holds once the move is done: standing, unless the move leaves it crouched, hanging or down. */
  rest?: AnimState
  moving?: boolean
  /**
   * A held move on the ground going `heading` (radians from his hips, a quarter turn his left) at `speed` metres a
   * second, sprinting or not: the gait's way and pace, as the arena hands them over (match-view.ts, `lean`).
   */
  travel?: Travel
}

interface Travel {
  heading: number
  speed: number
  sprint?: boolean
}

const once = (state: AnimState, moving = false): Beat => ({ state, seconds: 0, moving })
const blow = (melee: MeleeBlow, air = false): AnimState => ({ kind: 'cast', slot: 'basic', melee, ...(air ? { air } : {}) })
const cast = (slot: BuildSlot, low?: 'crouch' | 'prone'): AnimState => ({ kind: 'cast', slot, ...(low ? { low } : {}) })
/** A held cast on the engine's clock: drawn back over `hold` seconds, then let go. */
const charged = (slot: BuildSlot, hold = 0.9, after = 0.6): Beat[] => [
  { state: (p) => ({ kind: 'cast', slot, prep: p }), seconds: hold },
  { state: (p) => ({ kind: 'cast', slot, prep: 1, recover: p }), seconds: after },
]
/** A held state the body keeps until another button. */
const hold = (id: string, label: string, state: AnimState, moving = false): Move => ({ id, label, beats: () => [], rest: state, moving })
/** Moving on the ground some way at some pace, his hips square to his aim. */
const going = (id: string, label: string, travel: Travel): Move => ({ id, label, beats: () => [], rest: { kind: 'run' }, moving: true, travel })
const SIDE = Math.PI / 2
/** A one-shot: it plays out, then the body stands. */
const shot = (id: string, label: string, state: AnimState, rest?: AnimState): Move => ({ id, label, beats: () => [once(state)], rest })

const WAYS: readonly Way[] = ['up', 'forward', 'left', 'right', 'back']
const jump = (way: Way): Move => ({
  id: `jump-${way}`,
  label: `Jump ${way}`,
  beats: (seq) => [{ state: { kind: 'jump', seq: seq(), way }, seconds: 0.42 }, { state: { kind: 'air' }, seconds: 0.35 }, { state: { kind: 'land', seq: seq() }, seconds: 0.2 }],
})
const doubleJump = (way: Way): Move => ({
  id: `air-jump-${way}`,
  label: `Double jump ${way}`,
  beats: (seq) => [{ state: { kind: 'jump', seq: seq(), way: 'up' }, seconds: 0.3 }, { state: { kind: 'air_jump', seq: seq(), way }, seconds: 0.4 }, { state: { kind: 'air' }, seconds: 0.3 }, { state: { kind: 'land', seq: seq() }, seconds: 0.2 }],
})
const roll = (way: Way): Move => ({ id: `roll-${way}`, label: `Roll ${way}`, beats: (seq) => [{ state: { kind: 'roll', seq: seq(), way }, seconds: 0 }] })
const movement = (kind: 'dash' | 'land' | 'land_roll' | 'land_heavy' | 'mantle' | 'climb' | 'dive' | 'toggle', label: string, rest?: AnimState): Move => ({ id: kind, label, beats: (seq) => [{ state: { kind, seq: seq() }, seconds: 0 }], rest })

const GROUPS: readonly { title: string; note?: string; moves: readonly Move[] }[] = [
  {
    title: 'V',
    note: 'Each blow plays its family’s own clip: the dash, air, slam and launcher blows their own, the grab one every family shares.',
    moves: [
      shot('v1', 'Combo 1', blow({ step: 0 })),
      shot('v2', 'Combo 2', blow({ step: 1 })),
      shot('v3', 'Combo 3 (finisher)', blow({ step: 2 })),
      { id: 'chain', label: 'Chain V V V', beats: () => [{ state: blow({ step: 0 }), seconds: 0.45 }, { state: blow({ step: 1 }), seconds: 0.45 }, once(blow({ step: 2 }))] },
      { id: 'heavy', label: 'Charged heavy (hold V)', beats: () => [{ state: (p) => ({ kind: 'charge', wound: p }), seconds: 0.9 }, once(blow({ step: 0, heavy: 1 }))] },
      hold('guard', 'Guard (X)', { kind: 'block' }),
      { id: 'dash-blow', label: 'Dash attack', beats: () => [{ state: blow({ step: 0, kind: 'dash' }), seconds: 0, moving: true }] },
      shot('air-blow', 'Air attack', blow({ step: 0, kind: 'air' }, true)),
      shot('slam', 'Air slam', blow({ step: 0, kind: 'slam' }, true)),
      shot('launcher', 'Launcher', blow({ step: 0, kind: 'launcher' })),
      shot('grab', 'Grab and throw', blow({ step: 0, kind: 'grab' })),
    ],
  },
  {
    title: 'LMB',
    moves: [
      shot('lmb', 'Shoot', cast('active1')),
      { id: 'lmb-charge', label: 'Hold to charge', beats: () => charged('active1') },
      shot('lmb-crouch', 'Shoot crouched', cast('active1', 'crouch'), { kind: 'crouch' }),
      shot('lmb-prone', 'Shoot prone', cast('active1', 'prone'), { kind: 'prone' }),
    ],
  },
  {
    title: 'Q · E · F · R',
    note: 'Each plays the clip of what the lab put on that button: the Q its shape’s, the E its kind’s, F its aura’s flourish as it switches on, the R its shape’s (a lock-on, the V family’s flurry).',
    moves: [
      shot('q', 'Q', cast('active2')),
      { id: 'q-charge', label: 'Q held to charge', beats: () => charged('active2') },
      shot('e', 'E', cast('movement')),
      { id: 'f', label: 'F (switch on)', beats: (seq) => [{ state: { kind: 'toggle', seq: seq() }, seconds: 0 }] },
      shot('r', 'R', cast('ultimate')),
    ],
  },
  { title: 'Jumps and rolls', moves: [...WAYS.map(jump), ...WAYS.map(doubleJump), ...WAYS.map(roll)] },
  {
    title: 'Movement',
    moves: [
      movement('dash', 'Dash'),
      { id: 'slide', label: 'Slide', beats: () => [{ state: { kind: 'slide' }, seconds: 0.8, moving: true }] },
      movement('mantle', 'Mantle'),
      { id: 'catch', label: 'Catch the ledge', beats: (seq) => [{ state: { kind: 'catch', seq: seq() }, seconds: 0.45 }], rest: { kind: 'hang' } },
      movement('climb', 'Climb up'),
      movement('dive', 'Dive'),
      movement('land', 'Land'),
      movement('land_roll', 'Land rolling'),
      movement('land_heavy', 'Land heavy'),
    ],
  },
  {
    title: 'Held',
    moves: [
      hold('idle', 'Stand', { kind: 'idle' }),
      hold('run', 'Run', { kind: 'run' }, true),
      going('walk-ahead', 'Walk', { heading: 0, speed: 1.4 }),
      going('walk-left', 'Walk left', { heading: SIDE, speed: 1.4 }),
      going('walk-right', 'Walk right', { heading: -SIDE, speed: 1.4 }),
      going('walk-back', 'Walk back', { heading: Math.PI, speed: 1.4 }),
      going('jog-left', 'Jog left', { heading: SIDE, speed: 4 }),
      going('jog-right', 'Jog right', { heading: -SIDE, speed: 4 }),
      going('strafe-left', 'Strafe left, full speed', { heading: SIDE, speed: 6.5 }),
      going('strafe-right', 'Strafe right, full speed', { heading: -SIDE, speed: 6.5 }),
      going('sprint-left', 'Sprint left', { heading: SIDE, speed: 8, sprint: true }),
      going('ahead-left', 'Jog ahead and left', { heading: SIDE / 2, speed: 4 }),
      going('back-left', 'Jog back and left', { heading: SIDE * 1.5, speed: 4 }),
      hold('air', 'Fall', { kind: 'air' }),
      hold('crouch', 'Crouch', { kind: 'crouch' }),
      hold('crouch-move', 'Crouch walk', { kind: 'crouch_move' }, true),
      hold('prone', 'Prone', { kind: 'prone' }),
      hold('prone-move', 'Crawl', { kind: 'prone_move' }, true),
      hold('hang', 'Hang', { kind: 'hang' }),
      hold('hang-left', 'Shimmy left', { kind: 'hang_left' }),
      hold('hang-right', 'Shimmy right', { kind: 'hang_right' }),
      hold('zip', 'Zipline', { kind: 'zip' }),
      hold('rail', 'Rail', { kind: 'rail' }),
    ],
  },
  {
    title: 'Hit',
    moves: [shot('hit', 'Flinch', { kind: 'hit' }), hold('launched', 'Launched', { kind: 'launched' }), hold('stunned', 'Stunned', { kind: 'stunned' }), hold('dead', 'Down', { kind: 'dead' })],
  },
]

/** The move playing now, beat by beat, and what the body holds after. */
interface Player {
  beats: Beat[]
  at: number
  rest: AnimState
  restMoving: boolean
  /**
   * One frame of a landing first, which gives way at once: the same clip played again starts over (the view only
   * restarts a new clip), and a held pose cuts in rather than waiting for a swing to finish.
   */
  cut: boolean
  /** The last move, to play again on a loop. */
  last?: Move
  /** Which way and how fast the held move goes, if it goes anywhere. */
  travel?: Travel
  /** Seconds since the last move's beats ran out. */
  idle: number
}

const SPEEDS = [0.1, 0.25, 0.5, 1] as const
const LOOP_SECONDS = 2.5

/** The clips sounding on John now, from the hero view's dev probe (characters.ts, window.__fix). */
function playingNow(): string {
  const all = (window as unknown as { __fix?: { hero?: string; playing?: () => string[] }[] }).__fix ?? []
  const mine = [...all].reverse().find((f) => f.hero === 'John')
  return mine?.playing?.().join(' · ') ?? ''
}

/**
 * The page's dev hook (`window.__moves`), for recording a clip of each move: pick a John, then drive the clock by hand
 * so each frame is one fixed step, whatever the browser's own pace. `?clean` shows the stage alone.
 */
interface MovesHook {
  moves: { id: string; label: string; group: string }[]
  vFamilies: string[]
  lmbFamilies: string[]
  pick: (p: { john?: string; attitude?: string; basic?: string; lmb?: string; mode?: string; flight?: string; kit?: Record<string, string> }) => void
  ready: () => boolean
  play: (id: string) => boolean
  drive: (on: boolean) => void
  step: (dt: number) => void
  playing: () => string
  /** Swings the camera round him to `angle` radians from his front (0 straight on, positive round to his left), as far off. */
  face: (angle: number) => void
}

export function JohnMoves() {
  const [, setParams] = useSearchParams()
  const [clean] = useState(() => new URLSearchParams(window.location.search).has('clean'))
  const [heroes, setHeroes] = useState<readonly TriedHero[]>()
  const [prefs, setPrefs] = useState<Prefs>(savedPrefs)
  const [round, setRound] = useState(0)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState<string>()
  const [speed, setSpeed] = useState<number>(1)
  const [loop, setLoop] = useState(false)
  const [playing, setPlaying] = useState('')
  const [pressed, setPressed] = useState<string>()
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<{ renderer: WebGPURenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls } | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const view = useRef<HeroView | undefined>(undefined)
  const seq = useRef(0)
  const player = useRef<Player>({ beats: [], at: 0, rest: { kind: 'idle' }, restMoving: false, cut: false, idle: 0 })
  const pace = useRef({ speed, loop })
  pace.current = { speed, loop }
  useEffect(() => void triedHeroes().then(setHeroes), [])
  useEffect(() => write(PREFS, prefs), [prefs])

  const johns = useMemo(() => johnsOf(heroes ?? []), [heroes])
  const john = johns.find((j) => j.key === prefs.john) ?? johns.find((j) => j.key === 'body:medium')
  const height = john ? (john.hero?.height ?? 1.85 * SIZES[john.size].scale) : 1.85

  // the hero view reads the mesh and the attitude from the address (arena/client/heroes.ts): keep it in step
  const rebuild = (next: Prefs) => {
    const j = johns.find((x) => x.key === next.john) ?? john
    const search = new URLSearchParams()
    if (j?.hero) search.set('mesh', j.hero.label)
    if (next.attitude !== 'neutral') search.set('attitude', next.attitude)
    if (clean) search.set('clean', '')
    setParams(search, { replace: true })
    setPrefs(next)
    setRound((r) => r + 1)
  }
  // the first John, once the heroes are known
  useEffect(() => {
    if (heroes) rebuild(prefs)
  }, [heroes]) // eslint-disable-line react-hooks/exhaustive-deps

  // the stage: renderer, floor, light and the camera that circles John, once per mount
  useEffect(() => {
    const el = host.current
    if (!el) return
    let gone = false
    let observer: ResizeObserver | undefined
    const canvas = document.createElement('canvas')
    canvas.className = 'john-moves-canvas'
    el.appendChild(canvas)
    void createRenderer(canvas, { forceWebGL: forceWebGLFlag(window.location.search) }).then(({ renderer }) => {
      if (gone) {
        void renderer.dispose()
        return
      }
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFShadowMap
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.05
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x161a22)
      scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3128, 1.6))
      const sun = new THREE.DirectionalLight(0xffffff, 2.4)
      sun.position.set(4, 8, 5)
      sun.castShadow = true
      sun.shadow.mapSize.set(2048, 2048)
      Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 30 })
      scene.add(sun)
      const fill = new THREE.DirectionalLight(0xbfd4ff, 0.8)
      fill.position.set(-5, 3, -4)
      scene.add(fill)
      const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a303c, roughness: 0.9 }))
      floor.receiveShadow = true
      scene.add(floor)
      const grid = new THREE.GridHelper(24, 24, 0x4a5568, 0x323a48)
      grid.position.y = 0.002
      scene.add(grid)
      const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 200)
      const controls = new OrbitControls(camera, canvas)
      controls.enableDamping = true
      const size = () => {
        const w = el.clientWidth
        const h = el.clientHeight
        if (!w || !h) return
        renderer.setSize(w, h)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
      }
      size()
      observer = new ResizeObserver(size)
      observer.observe(el)
      stage.current = { renderer, scene, camera, controls }
      setReady(true)

      const clock = new THREE.Clock()
      let t = 0
      let lastCast = false
      let shown = ''
      let since = 0
      const frame = (dt: number) => {
        t += dt
        const v = view.current
        if (v) {
          const p = player.current
          let state = p.rest
          let moving = p.restMoving
          const beat = p.beats[0]
          if (p.cut) {
            state = { kind: 'land', seq: ++seq.current }
            p.cut = false
          } else if (beat) {
            state = typeof beat.state === 'function' ? beat.state(beat.seconds ? Math.min(1, p.at / beat.seconds) : 1) : beat.state
            moving = !!beat.moving
            p.at += dt
            if (p.at >= beat.seconds) {
              p.beats.shift()
              p.at = 0
            }
          } else if (pace.current.loop && p.last && p.last.beats(() => 0).length) {
            p.idle += dt
            if (p.idle >= LOOP_SECONDS) start(p.last)
          }
          // the gait's way and pace for a move going somewhere; the view's own defaults for anything else
          const go = beat ? undefined : p.travel
          if (go) v.lean?.(0, Math.abs(go.heading) > STANCE.back.enter, go.speed, false, 0, go.heading, !!go.sprint)
          else v.lean?.(0, false, undefined, false, 0, 0, false)
          v.pose(state, t, dt, moving)
          v.settle?.(dt)
          lastCast = state.kind === 'cast'
        }
        controls.update()
        renderer.render(scene, camera)
        // the readout, a few times a second
        since += dt / pace.current.speed
        if (since > 0.2) {
          since = 0
          const now = playingNow()
          if (now !== shown) setPlaying((shown = now))
        }
      }
      frameRef.current = frame
      renderer.setAnimationLoop(() => {
        const dt = Math.min(0.05, clock.getDelta()) * pace.current.speed
        if (!driven.current) frame(dt)
      })
      /** Play a move from its first beat; a cast straight after a cast gets its one-frame cut. */
      function start(move: Move) {
        const beats = move.beats(() => ++seq.current)
        const first = beats[0]?.state
        const firstIsCast = !!first && (typeof first === 'function' ? first(0) : first).kind === 'cast'
        player.current = { beats, at: 0, rest: move.rest ?? { kind: 'idle' }, restMoving: !!move.moving, travel: move.travel, cut: (lastCast && firstIsCast) || !beats.length, last: move, idle: 0 }
      }
      startRef.current = start
    })
    return () => {
      gone = true
      observer?.disconnect()
      const s = stage.current
      stage.current = undefined
      if (s) {
        s.renderer.setAnimationLoop(null)
        s.controls.dispose()
        void s.renderer.dispose()
      }
      canvas.remove()
    }
  }, [])
  const startRef = useRef<((move: Move) => void) | undefined>(undefined)
  const frameRef = useRef<((dt: number) => void) | undefined>(undefined)
  const driven = useRef(false)
  const loadedRound = useRef(-1)
  const roundNow = useRef(round)
  roundNow.current = round

  // John himself: built as the lab builds him, whenever a pick that changes his body, clips or weapons changes
  useEffect(() => {
    const s = stage.current
    if (!ready || !s || !john || round === 0) return
    let gone = false
    setLoading(true)
    setFailed(undefined)
    loadHeroView(johnBuild(prefs, john), undefined, 0, true, s.renderer)
      .then((v) => {
        if (gone) return
        if (view.current) s.scene.remove(view.current.root)
        view.current = v
        v.root.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = true
        })
        s.scene.add(v.root)
        // the camera on him: three quarters from the front, his whole height in view, circling his chest
        // (stood further back for a recording, so arms raised overhead stay in a square frame)
        const back = clean ? 1.2 : 1
        s.controls.target.set(0, height * (clean ? 0.62 : 0.55), 0)
        s.camera.position.set(height * 1.3 * back, height * 0.75 * back, height * 2.1 * back)
        s.controls.minDistance = height * 0.4
        s.controls.maxDistance = height * 8
        s.controls.update()
        if (v.fallback) setFailed('His body failed to load: this is the stand-in.')
        else loadedRound.current = round
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (gone) return
        setFailed(String(e))
        setLoading(false)
      })
    return () => {
      gone = true
    }
  }, [ready, round]) // eslint-disable-line react-hooks/exhaustive-deps

  const play = (move: Move) => {
    setPressed(move.id)
    startRef.current?.(move)
  }

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const hook: MovesHook = {
      moves: GROUPS.flatMap((g) => g.moves.map((m) => ({ id: m.id, label: m.label, group: g.title }))),
      vFamilies: V_OPTIONS.map((o) => o.id),
      lmbFamilies: LMB_FAMILIES.map((f) => f.id),
      pick: (p) => {
        const family = (p.lmb as LmbFamily | undefined) ?? prefs.lmb.family
        const lmb = { family, mode: (p.mode as LmbMode | undefined) ?? prefs.lmb.mode, flight: (p.flight as LmbFlight | undefined) ?? prefs.lmb.flight }
        const attitude = p.attitude && isAttitude(p.attitude) ? p.attitude : prefs.attitude
        rebuild({ ...prefs, john: p.john ?? prefs.john, attitude, lmb, kit: { ...prefs.kit, ...p.kit, basic: p.basic ?? prefs.kit.basic, active1: lmbId(lmb.family, lmb.mode, lmb.flight) } })
      },
      ready: () => loadedRound.current === roundNow.current,
      play: (id) => {
        const move = GROUPS.flatMap((g) => g.moves).find((m) => m.id === id)
        if (move) play(move)
        return !!move
      },
      drive: (on) => void (driven.current = on),
      step: (dt) => frameRef.current?.(dt),
      playing: playingNow,
      face: (angle) => {
        const s = stage.current
        if (!s) return
        const t = s.controls.target
        const far = Math.hypot(s.camera.position.x - t.x, s.camera.position.z - t.z)
        s.camera.position.set(t.x + far * Math.sin(angle), s.camera.position.y, t.z + far * Math.cos(angle))
        s.controls.update()
      },
    }
    ;(window as unknown as { __moves?: MovesHook }).__moves = hook
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const vFamily = prefs.kit.basic
  const lmbFamily = prefs.lmb.family
  return (
    <div className="john-moves">
      <div ref={host} className="john-moves-stage" />
      {!clean && (loading || failed) && <p className="john-moves-status">{failed ?? 'Loading John…'}</p>}
      <aside className="john-lab-panel" aria-label="John's moves" hidden={clean}>
        <h2>John’s moves</h2>
        <p className="muted">Drag to circle him, wheel to zoom, right-drag to pan. The picks are the lab’s.</p>
        {john && (
          <label>
            Which John
            <select value={john.key} onChange={(e) => rebuild({ ...prefs, john: e.target.value })}>
              {johns.map((j) => (
                <option key={j.key} value={j.key}>
                  {j.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="john-lab-row">
          <label>
            Attitude
            <select value={prefs.attitude} onChange={(e) => isAttitude(e.target.value) && rebuild({ ...prefs, attitude: e.target.value })}>
              {ATTITUDES.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <label>
            V family
            <select value={vFamily} onChange={(e) => rebuild({ ...prefs, kit: { ...prefs.kit, basic: e.target.value } })}>
              {V_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            LMB grip
            <select
              value={lmbFamily}
              onChange={(e) => {
                const lmb = { ...prefs.lmb, family: e.target.value as LmbFamily }
                rebuild({ ...prefs, lmb, kit: { ...prefs.kit, active1: lmbId(lmb.family, lmb.mode, lmb.flight) } })
              }}
            >
              {LMB_FAMILIES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="john-lab-row">
          <label>
            Speed
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s === 1 ? 'Full speed' : `${s}×`}
                </option>
              ))}
            </select>
          </label>
          <label className="john-moves-check">
            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
            Loop the move
          </label>
        </div>
        <p className="john-moves-playing" aria-live="polite">
          {playing ? `Playing: ${playing}` : ' '}
        </p>
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h2>{g.title}</h2>
            {g.note && <p className="muted">{g.note}</p>}
            <div className="john-moves-grid">
              {g.moves.map((m) => (
                <button key={m.id} className="hud-btn" aria-pressed={pressed === m.id} disabled={loading} onClick={() => play(m)}>
                  {m.label}
                </button>
              ))}
            </div>
          </section>
        ))}
        <p>
          <Link to="/dev/john">John’s lab</Link> · <Link to="/dev">All dev tools</Link>
        </p>
      </aside>
    </div>
  )
}
