import * as THREE from 'three'
import { BUILD_SLOTS } from '../../charter/build'
import type { BuildSlot } from '../../charter/types'
import type { HeroPackage } from '../../forge/package'
import { aiCommands } from '../ai/brain'
import { ENGINE } from '../engine/calibration'
import type { MatchEvent } from '../engine/events'
import type { Vec3 } from '../engine/maths'
import { LIVE_PROFILE, createMatch, healthShare, matchRules, type Arena, type Combatant } from '../engine/match'
import type { Command, Team } from '../engine/state'
import { tick } from '../engine/tick'
import { createAnimator, onEvents, settle, type Animator } from './animation'
import { Cameras } from './camera'
import { TEAM_COLORS } from './map'
import { handBack, releaseIfDead, take } from './takeover'
import { loadHeroView, type HeroView } from './heroes'
import { createClock, frame } from './loop'
import { buildMap, lights, type ArenaMap } from './map'
import { CosmeticPhysics, PHYSICS } from './physics'
import { atLeast, createGuard, observe, type QualityLevel } from './quality'
import { createRenderer, forceWebGLFlag, type Backend } from './render/renderer'
import { createStore, type Store } from './store'

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
}

/** What the effects, physics and cameras need each frame; later units plug in here. */
export interface FrameHooks {
  events?: (events: MatchEvent[]) => void
  frame?: (dt: number, alpha: number) => void
  /** The controlled hero's command for this tick, or undefined to leave it to the AI. */
  human?: () => Command | undefined
  /** Animation time scale; the effects slow it to near zero for a hit-stop (render only). */
  timeScale?: () => number
  /** The controlled hero died and control went back to watching (AE1). */
  released?: () => void
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
    heroes: match.heroes.map((h) => ({
      id: h.id,
      name: setups[h.id].build.heroName,
      team: h.team,
      alive: h.alive,
      hp: h.hp,
      maxHp: h.maxHp,
      damageDealt: h.damageDealt,
      airborne: h.airborne,
      fallback: views[h.id]?.fallback ?? false,
      cooldowns: Object.fromEntries(BUILD_SLOTS.map((s) => [s, { left: h.cooldowns[s] / ENGINE.tickHz, total: setups[h.id].kit[s].cooldown }])) as HudHero['cooldowns'],
    })),
  }
}

export async function startArena(host: HTMLElement, setup: MatchSetup, onProgress: (done: number, total: number) => void = () => {}): Promise<ArenaController> {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'width:100%;height:100%;display:block'
  host.append(canvas)
  const { renderer, backend } = await createRenderer(canvas, { forceWebGL: forceWebGLFlag(window.location.search) })
  const pixelRatio = Math.min(2, window.devicePixelRatio)
  renderer.setPixelRatio(pixelRatio)
  renderer.shadowMap.enabled = true
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x10141c)
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400)
  const map = buildMap()
  scene.add(map.group)
  const sun = lights(scene)

  const arena = createMatch(setup.teams[0], setup.teams[1], setup.seed, { profile: LIVE_PROFILE, formations: setup.formations })
  const builds = arena.setups.map((s) => s.build)
  let loaded = 0
  // Rapier loads with the heroes, so Start waits for both (R40)
  const total = builds.length + 1
  onProgress(0, total)
  // physics is cosmetic: if Rapier fails to load, the match runs without it (KTD12)
  const physicsReady = CosmeticPhysics.create()
    .catch(() => undefined)
    .then((p) => (onProgress(++loaded, total), p))
  // the two heroes nearest the streamer's side load at 2K; the rest at 1K (R24)
  const views = await Promise.all(
    builds.map(async (build, i) => {
      const view = await loadHeroView(build, setup.packages?.[i], i, arena.match.heroes[i].team === setup.side && i < 2, renderer)
      onProgress(++loaded, total)
      return view
    }),
  )
  views.forEach((v) => scene.add(v.root))
  const physics = await physicsReady
  const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), new THREE.MeshStandardMaterial({ color: 0x8a7f72, roughness: 0.9 }), PHYSICS.maxBodies)
  debris.count = 0
  scene.add(debris)
  const tmp = new THREE.Object3D()
  const yawQ = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  // compile every material before the fight so the first frames do not stutter (U1 found WebGL2 compiles lazily)
  await (renderer as unknown as { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<void> }).compileAsync?.(scene, camera)

  const animators: Animator[] = arena.match.heroes.map(createAnimator)
  const rules = matchRules(arena)
  const clock = createClock()
  const store = createStore<HudState>(hud(arena, views, false, backend, 'full'))
  const hooks: FrameHooks = {}
  let prev: Vec3[] = arena.match.heroes.map((h) => ({ ...h.position }))
  let drawn: Vec3[] = prev.map((p) => ({ ...p }))
  let last = performance.now()
  let stopped = false
  const publish = () => {
    store.set(hud(arena, views, clock.paused, backend, quality))
    store.flush()
  }
  const guard = createGuard()
  let quality: QualityLevel = 'full'
  let frameNo = 0
  const level = (l: QualityLevel) => atLeast(quality, l)
  // each step keeps the ones before it: shadows go first, render resolution last (R26)
  const applyQuality = (next: QualityLevel) => {
    quality = next
    sun.castShadow = !level('no-shadows')
    renderer.setPixelRatio(level('low-resolution') ? Math.max(0.75, pixelRatio * 0.6) : pixelRatio)
    resize()
  }

  const resize = () => {
    const w = host.clientWidth
    const h = host.clientHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / Math.max(1, h)
    camera.updateProjectionMatrix()
  }
  resize()
  window.addEventListener('resize', resize)
  const cameras = new Cameras(camera)
  // the free camera starts behind the streamer's half, looking across the arena
  if (setup.side === 1) {
    cameras.free.set(0, 22, 34)
    cameras.yaw = Math.PI
  }
  // team-coloured markers over every hero, and a brighter one over the controlled hero (R38)
  const markers = new THREE.InstancedMesh(new THREE.ConeGeometry(0.28, 0.5, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0xffffff }), arena.match.heroes.length)
  arena.match.heroes.forEach((h, i) => markers.setColorAt(i, new THREE.Color(TEAM_COLORS[h.team])))
  scene.add(markers)
  const mark = new THREE.Object3D()

  const loop = () => {
    if (stopped) return
    const now = performance.now()
    const dt = Math.min(0.25, (now - last) / 1000)
    last = now
    frameNo++
    if (!clock.paused) {
      const next = observe(guard, dt * 1000)
      if (next !== quality) applyQuality(next)
    }
    const { ticks, alpha } = frame(clock, dt)
    for (let i = 0; i < ticks && arena.match.winner === undefined; i++) {
      prev = arena.match.heroes.map((h) => ({ ...h.position }))
      const commands = aiCommands(arena)
      const human = arena.match.human
      if (human !== undefined) commands[human] = hooks.human?.()
      const events = tick(arena.match, arena.setups, commands, rules)
      if (releaseIfDead(arena.match)) hooks.released?.()
      if (events.length) arena.match.heroes.forEach((_, j) => onEvents(animators[j], j, events))
      physics?.events(events, arena.match)
      if (events.length) hooks.events?.(events)
    }
    const t = now / 1000
    physics?.step(dt)
    drawn = arena.match.heroes.map((h, i) => {
      const p = prev[i]
      const c = h.position
      const at = { x: p.x + (c.x - p.x) * alpha, y: p.y + (c.y - p.y) * alpha, z: p.z + (c.z - p.z) * alpha }
      const moved = Math.sqrt((c.x - p.x) ** 2 + (c.z - p.z) ** 2)
      const view = views[i]
      // under load, heroes far from the camera animate every other frame
      const far = level('slow-animation') && camera.position.distanceToSquared(view.root.position) > 900
      const pose = settle(animators[i], h, moved, arena.match.tick, dt)
      const scaled = dt * (hooks.timeScale?.() ?? 1)
      if (!far) view.pose(pose, t + i, scaled)
      else if ((frameNo + i) % 2 === 0) view.pose(pose, t + i, scaled * 2)
      // physics only changes how a body looks: a tumble on top of the engine's position, or where a fallen body lies
      const fallen = physics?.fallenPose(i)
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
    const pieces = physics?.debrisPoses() ?? []
    debris.count = pieces.length
    pieces.forEach((d, k) => {
      tmp.position.set(d.position.x, d.position.y, d.position.z)
      tmp.quaternion.set(d.rotation.x, d.rotation.y, d.rotation.z, d.rotation.w)
      tmp.updateMatrix()
      debris.setMatrixAt(k, tmp.matrix)
    })
    debris.instanceMatrix.needsUpdate = true
    arena.match.heroes.forEach((h, i) => {
      const at = drawn[i]
      const controlled = arena.match.human === i
      mark.position.set(at.x, at.y + views[i].root.scale.y * 2.3, at.z)
      // the controlled hero needs no marker: the camera sits on its shoulder
      mark.scale.setScalar(h.alive && !controlled ? 1 : 0)
      mark.updateMatrix()
      markers.setMatrixAt(i, mark.matrix)
    })
    markers.instanceMatrix.needsUpdate = true
    cameras.update(dt, arena.match.human !== undefined ? drawn[arena.match.human] : undefined, map.proxies)
    hooks.frame?.(dt, alpha)
    renderer.render(scene, camera)
    // the HUD snapshot is built only when the store will pass it on (about 10 times a second)
    if (store.due()) store.set(hud(arena, views, clock.paused, backend, quality))
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

  return {
    arena,
    store,
    scene,
    camera,
    map,
    views,
    renderer,
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
    pause: () => {
      clock.paused = arena.match.paused = true
      publish()
    },
    resume: () => {
      clock.paused = arena.match.paused = false
      last = performance.now()
      publish()
    },
    quality: () => quality,
    stop: () => {
      stopped = true
      physics?.dispose()
      window.removeEventListener('resize', resize)
      renderer.dispose()
      canvas.remove()
    },
  }
}
