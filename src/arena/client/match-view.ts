import * as THREE from 'three'
import { BUILD_SLOTS } from '../../charter/build'
import type { BuildSlot } from '../../charter/types'
import type { HeroPackage } from '../../forge/package'
import { aiCommands } from '../ai/brain'
import { ENGINE } from '../engine/calibration'
import type { MatchEvent } from '../engine/events'
import type { Vec3 } from '../engine/maths'
import { LIVE_PROFILE, createMatch, healthShare, matchRules, type Arena, type Combatant } from '../engine/match'
import { capsule, type Command, type Team } from '../engine/state'
import { tick } from '../engine/tick'
import { createAnimator, onEvents, settle, type Animator } from './animation'
import { Cameras } from './camera'
import { TEAM_COLORS } from './map'
import { handBack, releaseIfDead, take } from './takeover'
import { loadHeroView, type HeroView } from './heroes'
import { createClock, frame } from './loop'
import { atmosphere, buildMap, lights, type ArenaMap } from './map'
import { buildRuins } from './ruins'
import { CosmeticPhysics, PHYSICS } from './physics'
import { atLeast, createGuard, observe, type QualityLevel } from './quality'
import { createRangeIndicator } from './range'
import { createRenderer, forceWebGLFlag, type Backend } from './render/renderer'
import { createStore, type Store } from './store'
import { statusesOf, type HeroStatus } from '../../ui/arena/hud/status'

/**
 * A live match in the browser (U13, KTD15): the engine and the AI tick at 60 Hz on a fixed clock, heroes are drawn
 * between the last two states, and the HUD reads a store that updates about 10 times a second.
 */

export interface MatchSetup {
  teams: [Combatant[], Combatant[]]
  formations?: [Vec3[]?, Vec3[]?]
  /** Forged heroes' packages, by hero index; demo and Creator heroes have none. */
  packages?: (HeroPackage | undefined)[]
  seed: number
  /** The side the streamer staged first and may control (R2, R14). */
  side: Team
}

export interface HudHero {
  id: number
  name: string
  team: Team
  alive: boolean
  hp: number
  maxHp: number
  /** Seconds left and the full cooldown, per slot. */
  cooldowns: Record<BuildSlot, { left: number; total: number }>
  damageDealt: number
  airborne: boolean
  /** The flight meter, 0 empty to 1 full. */
  flight?: number
  /** What is on the hero, worst first (status.ts). */
  statuses?: HeroStatus[]
  fallback: boolean
}

export interface HudState {
  seconds: number
  timerSeconds: number
  paused: boolean
  winner?: Team | 'draw'
  reason?: 'wipe' | 'time'
  heroes: HudHero[]
  controlled?: number
  backend?: Backend
  quality: QualityLevel
  healthShare: [number, number]
  /** Overtime: the share of extra damage everyone deals now, 0 before it starts. */
  overtime?: number
}

interface Listeners {
  events: (events: MatchEvent[]) => void
  frame: (dt: number, alpha: number) => void
}

/** What the effects, controls and cameras plug into each frame. */
export interface FrameHooks {
  /** Add a listener; listeners run in the order they were added, and each call returns its own removal. */
  on: <K extends keyof Listeners>(kind: K, listener: Listeners[K]) => () => void
  /** The controlled hero's command for this tick, or undefined to leave it to the AI. */
  human?: () => Command | undefined
  /** Animation time scale; the effects slow it to near zero for a hit-stop (render only). */
  timeScale?: () => number
}

export function createHooks(): FrameHooks & { emit: { events: Listeners['events']; frame: Listeners['frame'] } } {
  const lists: { [K in keyof Listeners]: Listeners[K][] } = { events: [], frame: [] }
  return {
    on: (kind, listener) => {
      const list = lists[kind] as Listeners[typeof kind][]
      list.push(listener)
      return () => void list.splice(list.indexOf(listener), 1)
    },
    emit: {
      events: (events) => lists.events.forEach((l) => l(events)),
      frame: (dt, alpha) => lists.frame.forEach((l) => l(dt, alpha)),
    },
  }
}

export interface ArenaController {
  arena: Arena
  store: Store<HudState>
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  map: ArenaMap
  views: HeroView[]
  renderer: Awaited<ReturnType<typeof createRenderer>>['renderer']
  hooks: FrameHooks
  cameras: Cameras
  side: Team
  /** Take a living hero on the streamer's side; false if it cannot be taken (R14, AE2). */
  take: (hero: number | undefined) => boolean
  handBack: () => void
  /** Interpolated positions from the last frame, for cameras and effects. */
  positions: () => Vec3[]
  pause: () => void
  resume: () => void
  /** The frame-rate guard's current level (U18, R26). */
  quality: () => QualityLevel
  stop: () => void
}

/** Is any 3D backend available at all? Neither WebGPU nor WebGL2 means the game cannot run here (R40). */
export function canRender(): boolean {
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) return true
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

function hud(arena: Arena, views: HeroView[], paused: boolean, backend: Backend, quality: QualityLevel): HudState {
  const { match, setups } = arena
  return {
    seconds: match.tick / ENGINE.tickHz,
    timerSeconds: arena.timerTicks / ENGINE.tickHz,
    paused,
    winner: match.winner,
    reason: match.endReason,
    controlled: match.human,
    backend,
    quality,
    healthShare: [healthShare(match, 0), healthShare(match, 1)],
    overtime: match.damageRamp && match.tick > match.damageRamp.fromTick ? ((match.tick - match.damageRamp.fromTick) / ENGINE.tickHz) * match.damageRamp.perSecond : 0,
    heroes: match.heroes.map((h) => ({
      id: h.id,
      name: setups[h.id].build.heroName,
      team: h.team,
      alive: h.alive,
      hp: h.hp,
      maxHp: h.maxHp,
      damageDealt: h.damageDealt,
      airborne: h.airborne,
      flight: (h.flight ?? ENGINE.flight.max) / ENGINE.flight.max,
      statuses: statusesOf(h, match.tick).slice(0, 3),
      fallback: views[h.id]?.fallback ?? false,
      cooldowns: Object.fromEntries(BUILD_SLOTS.map((s) => [s, { left: h.cooldowns[s] / ENGINE.tickHz, total: setups[h.id].kit[s].cooldown }])) as HudHero['cooldowns'],
    })),
  }
}

/**
 * Bloom for the anime spectacle: only bright things glow (effects, the centre line, the barrier trim). Built through
 * three's render pipeline, which works on both backends; if it cannot be built the match renders without it.
 */
async function bloomPipeline(renderer: Awaited<ReturnType<typeof createRenderer>>['renderer'], scene: THREE.Scene, camera: THREE.Camera) {
  try {
    const [{ RenderPipeline }, { pass, screenUV, smoothstep, float }, { bloom }] = await Promise.all([import('three/webgpu'), import('three/tsl'), import('three/addons/tsl/display/BloomNode.js')])
    const scenePass = pass(scene, camera)
    const color = scenePass.getTextureNode('output')
    // a soft vignette pulls the eye to the fight in the middle of the frame
    const vignette = float(1).sub(smoothstep(0.35, 0.85, screenUV.sub(0.5).length()).mul(0.35))
    const pipeline = new RenderPipeline(renderer, color.add(bloom(color, 0.55, 0.35, 0.82)).mul(vignette))
    return { pipeline, enabled: true }
  } catch {
    return undefined
  }
}

type Renderer = Awaited<ReturnType<typeof createRenderer>>['renderer']

/** A fresh canvas with a renderer set up the way the arena draws: soft shadows, filmic tone mapping. */
async function newRenderer(host: HTMLElement, forceWebGL: boolean) {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'width:100%;height:100%;display:block'
  host.prepend(canvas)
  try {
    const { renderer, backend } = await createRenderer(canvas, { forceWebGL })
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    return { canvas, renderer, backend }
  } catch (e) {
    canvas.remove()
    throw e
  }
}

/** Most times a lost graphics device is rebuilt in one match before the stage gives up. */
const MAX_RECOVERIES = 3

/**
 * The canvas, renderer, scene, camera, map and lights; disposed again if any later setup step fails. A loaded machine
 * can lose its graphics device mid-match (three then quietly stops drawing while the HUD runs on), so on a loss the
 * stage swaps in a new canvas and renderer, on WebGL2 for stability, and keeps drawing the same scene and match.
 */
async function createStage(host: HTMLElement) {
  const first = await newRenderer(host, forceWebGLFlag(window.location.search))
  try {
    const pixelRatio = Math.min(2, window.devicePixelRatio)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400)
    atmosphere(scene)
    const map = buildMap()
    scene.add(map.group)
    const sun = lights(scene)
    const stage = {
      host,
      canvas: first.canvas,
      renderer: first.renderer as Renderer,
      backend: first.backend,
      pixelRatio,
      scene,
      camera,
      map,
      sun,
      glow: await bloomPipeline(first.renderer, scene, camera),
      recoveries: 0,
      /** While a new renderer is being built nothing draws: the old device is gone. */
      recovering: false,
      resize: () => {
        const w = host.clientWidth
        const h = host.clientHeight
        stage.renderer.setSize(w, h, false)
        camera.aspect = w / Math.max(1, h)
        camera.updateProjectionMatrix()
      },
      // with bloom off (unsupported, or dropped by the frame-rate guard) the frame renders directly
      draw: () => {
        if (stage.recovering) return
        if (stage.glow?.enabled) stage.glow.pipeline.render()
        else stage.renderer.render(scene, camera)
      },
      dispose: () => {
        window.removeEventListener('resize', stage.resize)
        stage.renderer.dispose()
        stage.canvas.remove()
      },
      /** Rebuild the renderer on a new canvas after the graphics device was lost; false once out of attempts. */
      recover: async (): Promise<boolean> => {
        if (stage.recoveries >= MAX_RECOVERIES || stage.recovering) return false
        stage.recoveries++
        stage.recovering = true
        try {
          const pixel = stage.renderer.getPixelRatio()
          const shadows = stage.sun.castShadow
          const bloomOn = stage.glow?.enabled ?? false
          const next = await newRenderer(host, true)
          try {
            stage.renderer.dispose()
          } catch {
            // a lost device may refuse to release; the canvas goes regardless
          }
          stage.canvas.remove()
          stage.canvas = next.canvas
          stage.renderer = next.renderer
          stage.backend = next.backend
          stage.renderer.setPixelRatio(pixel)
          stage.sun.castShadow = shadows
          stage.glow = await bloomPipeline(stage.renderer, scene, camera)
          if (stage.glow) stage.glow.enabled = bloomOn
          watchDevice(stage)
          stage.resize()
          return true
        } catch {
          return false
        } finally {
          stage.recovering = false
        }
      },
      onRecovered: (_ok: boolean) => {},
    }
    watchDevice(stage)
    return stage
  } catch (e) {
    first.canvas.remove()
    throw e
  }
}
type Stage = Awaited<ReturnType<typeof createStage>>

/** A short-lived notice over the arena, for things the player should know but that need no answer. */
function notice(host: HTMLElement, text: string) {
  const el = document.createElement('div')
  el.className = 'arena-notice'
  el.setAttribute('role', 'status')
  el.textContent = text
  host.append(el)
  setTimeout(() => el.remove(), 6000)
}

/** Hand a lost device to the stage's recovery instead of three's default (log once, then draw nothing forever). */
function watchDevice(stage: { renderer: Renderer; recover: () => Promise<boolean>; onRecovered: (ok: boolean) => void }) {
  const r = stage.renderer as Renderer & { onDeviceLost: (info: { message?: string; reason?: string }) => void }
  r.onDeviceLost = (info) => {
    console.warn(`[arena] graphics device lost (${info.reason ?? info.message ?? 'unknown'}); rebuilding the renderer`)
    void stage.recover().then(
      (ok) => stage.onRecovered(ok),
      () => stage.onRecovered(false),
    )
  }
}

/**
 * The frame-rate guard wired to the stage (U18, R26): each step keeps the ones before it, shadows first and render
 * resolution last.
 */
function qualityControl(stage: Stage) {
  const guard = createGuard()
  let current: QualityLevel = 'full'
  return {
    current: () => current,
    level: (l: QualityLevel) => atLeast(current, l),
    observe(frameMs: number) {
      const next = observe(guard, frameMs)
      if (next === current) return
      current = next
      stage.sun.castShadow = !atLeast(current, 'no-shadows')
      // bloom is the first post effect to go when particles are thinned
      if (stage.glow) stage.glow.enabled = !atLeast(current, 'fewer-particles')
      stage.renderer.setPixelRatio(atLeast(current, 'low-resolution') ? Math.max(0.75, stage.pixelRatio * 0.6) : stage.pixelRatio)
      stage.resize()
    },
  }
}

const yawQ = new THREE.Quaternion()
const up = new THREE.Vector3(0, 1, 0)

/**
 * Pose every hero between the last two engine states. Physics only changes how a body looks: a tumble on top of the
 * engine's position, or where a fallen body lies (KTD12). Returns where each hero was drawn.
 */
function drawHeroes(
  ctx: { arena: Arena; views: HeroView[]; animators: Animator[]; physics: CosmeticPhysics | undefined; camera: THREE.Camera },
  prev: Vec3[],
  frame: { alpha: number; dt: number; t: number; frameNo: number; timeScale: number; slowFar: boolean },
): Vec3[] {
  const { arena, views, animators, physics, camera } = ctx
  return arena.match.heroes.map((h, i) => {
    const p = prev[i]
    const c = h.position
    const at = { x: p.x + (c.x - p.x) * frame.alpha, y: p.y + (c.y - p.y) * frame.alpha, z: p.z + (c.z - p.z) * frame.alpha }
    const moved = Math.sqrt((c.x - p.x) ** 2 + (c.z - p.z) ** 2)
    const view = views[i]
    // under load, heroes far from the camera animate every other frame
    const far = frame.slowFar && camera.position.distanceToSquared(view.root.position) > 900
    const pose = settle(animators[i], h, moved, arena.match.tick, frame.dt)
    const scaled = frame.dt * frame.timeScale
    const moving = moved > 0.01
    if (!far) view.pose(pose, frame.t + i, scaled, moving)
    else if ((frame.frameNo + i) % 2 === 0) view.pose(pose, frame.t + i, scaled * 2, moving)
    // a view that animates its own fall stays where the engine left it; a stand-in lies where its physics body landed
    const fallen = view.animatesDeath ? undefined : physics?.fallenPose(i)
    if (fallen) {
      view.root.position.set(fallen.position.x, fallen.position.y, fallen.position.z)
      view.root.quaternion.set(fallen.rotation.x, fallen.rotation.y, fallen.rotation.z, fallen.rotation.w)
      return at
    }
    view.root.position.set(at.x, at.y, at.z)
    yawQ.setFromAxisAngle(up, h.yaw)
    const tumble = physics?.rotation(i)
    if (tumble) view.root.quaternion.set(tumble.x, tumble.y, tumble.z, tumble.w).multiply(yawQ)
    else view.root.quaternion.copy(yawQ)
    return at
  })
}

const place = new THREE.Object3D()

function drawDebris(debris: THREE.InstancedMesh, physics: CosmeticPhysics | undefined) {
  const pieces = physics?.debrisPoses() ?? []
  debris.count = pieces.length
  pieces.forEach((d, k) => {
    place.position.set(d.position.x, d.position.y, d.position.z)
    place.quaternion.set(d.rotation.x, d.rotation.y, d.rotation.z, d.rotation.w)
    place.scale.setScalar(1)
    place.updateMatrix()
    debris.setMatrixAt(k, place.matrix)
  })
  debris.instanceMatrix.needsUpdate = true
}

/** A team ring on the floor under every living hero, sized to its hitbox, so a crowd still reads at a glance (R38). */
function drawRings(rings: THREE.InstancedMesh, arena: Arena, drawn: Vec3[]) {
  arena.match.heroes.forEach((h, i) => {
    const at = drawn[i]
    place.position.set(at.x, 0.03, at.z)
    place.quaternion.setFromAxisAngle(right, -Math.PI / 2)
    place.scale.setScalar(h.alive ? capsule(h).radius * 1.6 : 0)
    place.updateMatrix()
    rings.setMatrixAt(i, place.matrix)
  })
  rings.instanceMatrix.needsUpdate = true
}
const right = new THREE.Vector3(1, 0, 0)

/** Load everything a match needs, reporting progress, then run it until `stop` (U13). */
export async function startArena(host: HTMLElement, setup: MatchSetup, onProgress: (done: number, total: number) => void = () => {}): Promise<ArenaController> {
  const stage = await createStage(host)
  let physics: CosmeticPhysics | undefined
  try {
    return await run(stage, setup, onProgress, (p) => (physics = p))
  } catch (e) {
    // a failed load must not leave a live renderer or a physics world behind
    physics?.dispose()
    stage.dispose()
    throw e
  }
}

async function run(stage: Stage, setup: MatchSetup, onProgress: (done: number, total: number) => void, keepPhysics: (p: CosmeticPhysics | undefined) => void): Promise<ArenaController> {
  const { renderer, scene, camera, map } = stage
  const arena = createMatch(setup.teams[0], setup.teams[1], setup.seed, { profile: LIVE_PROFILE, formations: setup.formations })
  const builds = arena.setups.map((s) => s.build)
  let loaded = 0
  // Rapier loads with the heroes, so Start waits for both (R40)
  const total = builds.length + 1
  onProgress(0, total)
  // physics is cosmetic: if Rapier fails to load, the match runs without it (KTD12)
  const physicsReady = CosmeticPhysics.create()
    .catch(() => undefined)
    .then((p) => (keepPhysics(p), onProgress(++loaded, total), p))
  // the two heroes nearest the streamer's side load at 2K; the rest at 1K (R24)
  const views = await Promise.all(
    builds.map(async (build, i) => {
      const view = await loadHeroView(build, setup.packages?.[i], i, arena.match.heroes[i].team === setup.side && i < 2, renderer, arena.match.heroes[i].team)
      onProgress(++loaded, total)
      return view
    }),
  )
  views.forEach((v) => scene.add(v.root))
  // the ruins come from the engine's own cover, so what is drawn is exactly what blocks (R25)
  const ruins = arena.match.cover ? buildRuins(arena.match.cover.pieces) : undefined
  if (ruins) {
    scene.add(ruins.group)
    map.proxies.push(...ruins.proxies)
  }
  const physics = await physicsReady
  const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), new THREE.MeshStandardMaterial({ color: 0x8a7f72, roughness: 0.9 }), PHYSICS.maxBodies)
  debris.count = 0
  scene.add(debris)
  const rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }), arena.match.heroes.length)
  // the HUD draws each hero's name and health over its head; the floor ring keeps its team readable from far off
  arena.match.heroes.forEach((h, i) => rings.setColorAt(i, new THREE.Color(TEAM_COLORS[h.team])))
  scene.add(rings)
  // the controlled hero's basic attack reach, on the floor
  const range = createRangeIndicator(scene)
  // compile every material before the fight so the first frames do not stutter (U1 found WebGL2 compiles lazily)
  await (renderer as unknown as { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<void> }).compileAsync?.(scene, camera)

  const animators: Animator[] = arena.match.heroes.map(createAnimator)
  const rules = matchRules(arena)
  const clock = createClock()
  const quality = qualityControl(stage)
  const store = createStore<HudState>(hud(arena, views, false, stage.backend, 'full'))
  const hooks = createHooks()
  const cameras = new Cameras(camera)
  // the free camera starts behind the streamer's half, looking across the arena
  if (setup.side === 1) {
    cameras.free.set(0, 13, 27)
    cameras.yaw = Math.PI
  }
  stage.resize()
  window.addEventListener('resize', stage.resize)

  let prev: Vec3[] = arena.match.heroes.map((h) => ({ ...h.position }))
  let drawn: Vec3[] = prev.map((p) => ({ ...p }))
  let last = performance.now()
  let stopped = false
  let frameNo = 0
  const publish = () => {
    store.set(hud(arena, views, clock.paused, stage.backend, quality.current()))
    store.flush()
  }
  const setPaused = (paused: boolean) => {
    clock.paused = arena.match.paused = paused
    if (!paused) last = performance.now()
    publish()
  }

  const step = () => {
    const now = performance.now()
    const dt = Math.min(0.25, (now - last) / 1000)
    last = now
    frameNo++
    if (!clock.paused) quality.observe(dt * 1000)
    const { ticks, alpha } = frame(clock, dt)
    for (let i = 0; i < ticks && arena.match.winner === undefined; i++) {
      prev = arena.match.heroes.map((h) => ({ ...h.position }))
      const commands = aiCommands(arena)
      const human = arena.match.human
      if (human !== undefined) commands[human] = hooks.human?.()
      const events = tick(arena.match, arena.setups, commands, rules)
      // the controlled hero died: control goes back to watching from the free camera (AE1)
      if (releaseIfDead(arena.match)) cameras.set('free')
      physics?.events(events, arena.match)
      for (const e of events) {
        if (e.type === 'cover-hit') ruins?.hit(e.index, e.health)
        else if (e.type === 'cover-broken') {
          ruins?.broken(e.index)
          physics?.burst(e.at, 12)
        }
      }
      if (events.length) {
        arena.match.heroes.forEach((_, j) => onEvents(animators[j], j, events))
        hooks.emit.events(events)
      }
    }
    physics?.step(dt)
    ruins?.update(dt)
    drawn = drawHeroes({ arena, views, animators, physics, camera }, prev, { alpha, dt, t: now / 1000, frameNo, timeScale: hooks.timeScale?.() ?? 1, slowFar: quality.level('slow-animation') })
    drawDebris(debris, physics)
    drawRings(rings, arena, drawn)
    const followed = arena.match.human === undefined && cameras.follow !== undefined ? drawn[cameras.follow] : undefined
    cameras.update(dt, arena.match.human !== undefined ? drawn[arena.match.human] : undefined, map.proxies, followed)
    range.update(arena.match, arena.setups, drawn, cameras.yaw, cameras.pitch)
    hooks.emit.frame(dt, alpha)
    stage.draw()
    // the HUD snapshot is built only when the store will pass it on (about 10 times a second)
    if (store.due()) store.set(hud(arena, views, clock.paused, stage.backend, quality.current()))
  }
  // a thrown frame must never stop the match: the next frame is booked first, and each distinct error is reported once
  const reported = new Set<string>()
  const loop = () => {
    if (stopped) return
    requestAnimationFrame(loop)
    try {
      step()
    } catch (e) {
      const key = String((e as Error)?.message ?? e)
      if (!reported.has(key)) {
        reported.add(key)
        console.error('[arena] a frame failed; the match keeps running', e)
      }
    }
  }
  requestAnimationFrame(loop)
  stage.onRecovered = (ok) => notice(stage.host, ok ? 'Graphics reset. Recovered in compatibility mode.' : 'The graphics device was lost. Reload the page to keep watching.')

  const controller: ArenaController = {
    arena,
    store,
    scene,
    camera,
    map,
    views,
    get renderer() {
      return stage.renderer
    },
    hooks,
    cameras,
    side: setup.side,
    take: (hero) => {
      if (!take(arena.match, setup.side, hero)) return false
      // the hero camera starts facing where the hero faces
      cameras.yaw = arena.match.heroes[hero!].yaw
      cameras.pitch = -0.15
      cameras.set('hero')
      publish()
      return true
    },
    handBack: () => {
      handBack(arena.match)
      cameras.set('free')
      publish()
    },
    positions: () => drawn,
    pause: () => setPaused(true),
    resume: () => setPaused(false),
    quality: quality.current,
    stop: () => {
      stopped = true
      physics?.dispose()
      stage.dispose()
    },
  }
  // a dev-only handle for checking art and UI from a script, like the cameras and the match (never in production)
  if (import.meta.env.DEV) (window as unknown as { __arena?: ArenaController }).__arena = controller
  return controller
}
