import * as THREE from 'three'
import { BUILD_SLOTS } from '../../charter/build.js'
import type { Style } from '../../charter/motions.js'
import type { BuildSlot } from '../../charter/types.js'
import type { AiLevel } from '../ai/calibration.js'
import type { HeroPackage } from '../../forge/package.js'
import { aiCommands } from '../ai/brain.js'
import { ENGINE, ticks } from '../engine/calibration.js'
import { shotSeconds } from '../engine/combat.js'
import type { MatchEvent } from '../engine/events.js'
import type { Vec3 } from '../engine/maths.js'
import { LIVE_PROFILE, PRACTICE_PROFILE, createMatch, healthShare, matchRules, type Arena, type Combatant } from '../engine/match.js'
import { capsule, type Command, type MatchState, type Team } from '../engine/state.js'
import { tick } from '../engine/tick.js'
import { createAnimator, onEvents, settle, STANCE, stance, type Animator, type Stance } from './animation.js'
import { Cameras, FIRST_PERSON } from './camera.js'
import { TEAM_COLORS } from './map.js'
import { handBack, releaseIfDead, take } from './takeover.js'
import { loadHeroView, type HeroView } from './heroes.js'
import { HeroLod, impostorMaterial, LOD, lodReady, POSE_EVERY, tiersFor, type Tier } from './lod.js'
import { createClock, frame } from './loop.js'
import { atmosphere, buildMap, lights, type ArenaMap } from './map.js'
import { cascade, sunShadows, VIEW_FAR } from './sky.js'
import { propLods } from './render/prop-lod.js'
import { createHouseView } from './house-view.js'
import { VAULT, edgeAt, insideEdge } from '../engine/house-rules.js'
import { HIDE_AFTER, OCCLUDED_LAYER, occluded, setOccluded, sightHealth } from './occlusion.js'
import { mayRest, setResting } from './rest.js'
import { buildRuins } from './ruins.js'
import { buildGreybox } from './greybox.js'
import { LIVE_MAP, MAPS } from '../engine/maps.js'
import { CosmeticPhysics } from './physics.js'
import { groundUnder } from './effects/anchors.js'
import { atFloor, atLeast, basePixelRatio, createGuard, createScaler, observe, scaleFor, SCALER, type QualityLevel } from './quality.js'
import { createRangeIndicator } from './range.js'
import { createRenderer, forceWebGLFlag, gpuTimeFlag, type Backend } from './render/renderer.js'
import { createStore, type Store } from './store.js'
import { statusesOf, type HeroStatus } from '../../ui/arena/hud/status.js'

/**
 * A live match in the browser (U13, KTD15): the engine and the AI tick at 60 Hz on a fixed clock, heroes are drawn
 * between the last two states, and the HUD reads a store that updates about 10 times a second.
 */

export interface MatchSetup {
  teams: [Combatant[], Combatant[]]
  formations?: [Vec3[]?, Vec3[]?]
  /** Forged heroes' packages, by hero index; demo heroes and heroes made in the Forge have none. */
  packages?: (HeroPackage | undefined)[]
  seed: number
  /** The side the streamer staged first and may control (R2, R14). */
  side: Team
  /** Heroes the AI leaves standing, by index: a training dummy that only takes hits. */
  idle?: readonly number[]
  /** How well the AI plays each side (§2); Hard, the gate's level, when absent. */
  aiLevels?: [AiLevel, AiLevel]
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
  /** Stamina pips, fractional while one refills, out of `staminaMax` (Forge goal, phase 2). */
  stamina?: number
  staminaMax?: number
  /** What is on the hero, worst first (status.ts). */
  statuses?: HeroStatus[]
  /** Whether the passive is switched on (F toggles it). */
  passiveOn?: boolean
  /** Seconds the basic attack button has been held, while it is: past ENGINE.melee.heavyHold it charges a heavy blow. */
  holding?: number
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
  /** The house's rules (GAME.md §2), when the match plays them. */
  house?: HudHouse
}

export interface HudHouse {
  /** Where the edge closes; shown once it starts to close. */
  spot: string
  phase: number
  closing: boolean
  /** Seconds until the edge next starts or stops moving; undefined once it has closed. */
  nextIn?: number
  /** What a hero outside loses each second, as a share of its health. */
  dps: number
  vault: { open: boolean; opensIn: number; holder?: Team; by?: Team; fill: number }
  /** The controlled hero is outside the edge. */
  outside: boolean
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
  /**
   * The match clock's speed: 1 is real time. A practice room slows it to watch a wind-up and its contact frame; the
   * engine still steps whole ticks, so nothing about the fight changes, only how fast it plays.
   */
  speed?: () => number
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
  /** Show the hit feel on screen this frame (radial blur, speed lines, impact frame); nothing without the post pass. */
  screen: (feel: ScreenFeel) => void
  /**
   * More views drawn over the main one each frame (the kit reel's three points of view, GAME.md §11): each camera into
   * its own rectangle, `[x, y, width, height]` as fractions of the screen from the top left. An empty list clears them.
   */
  insets: (views: readonly Inset[]) => void
  stop: () => void
}

export interface Inset {
  camera: THREE.PerspectiveCamera
  rect: readonly [x: number, y: number, width: number, height: number]
}

/**
 * The insets' drawing: each camera renders into a target of its rectangle's size (linear: the frame's own post pass
 * tone-maps it once), shown on a quad held just in front of the main camera so it goes through the same frame (a
 * second render to the canvas would replace the post-processed picture with three's own output pass).
 */
function createInsets(scene: THREE.Scene, main: THREE.PerspectiveCamera, backend: Backend) {
  const size = new THREE.Vector2()
  const offset = new THREE.Vector3()
  let live: { inset: Inset; target: THREE.RenderTarget; quad: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> }[] = []
  const clear = () => {
    for (const v of live) {
      v.target.dispose()
      v.quad.material.dispose()
      v.quad.geometry.dispose()
      scene.remove(v.quad)
    }
    live = []
  }
  return {
    set(views: readonly Inset[]) {
      clear()
      live = views.map((inset) => {
        const target = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
        const plane = new THREE.PlaneGeometry(1, 1)
        // WebGPU's render targets come out with v running the other way to WebGL's
        if (backend === 'webgpu') {
          const uv = plane.attributes.uv
          for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i))
        }
        const quad = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: target.texture, depthTest: false, depthWrite: false, fog: false }))
        quad.renderOrder = 10_000
        quad.frustumCulled = false
        quad.name = 'inset'
        scene.add(quad)
        return { inset, target, quad }
      })
    },
    /** Render each inset's view into its target and hold its quad over its rectangle; before the main frame. */
    render(renderer: Renderer) {
      if (!live.length) return
      renderer.getDrawingBufferSize(size)
      for (const v of live) v.quad.visible = false
      for (const v of live) {
        const w = Math.max(1, Math.round(size.x * v.inset.rect[2]))
        const h = Math.max(1, Math.round(size.y * v.inset.rect[3]))
        if (v.target.width !== w || v.target.height !== h) v.target.setSize(w, h)
        v.inset.camera.aspect = w / h
        v.inset.camera.updateProjectionMatrix()
        renderer.setRenderTarget(v.target)
        renderer.render(scene, v.inset.camera)
      }
      renderer.setRenderTarget(null)
      // a plane just past the near plane, sized to the main view there
      const d = main.near * 1.5
      const high = 2 * d * Math.tan(THREE.MathUtils.degToRad(main.fov) / 2)
      const wide = high * main.aspect
      main.updateMatrixWorld()
      for (const v of live) {
        const [x, y, w, h] = v.inset.rect
        offset.set((x + w / 2 - 0.5) * wide, (0.5 - y - h / 2) * high, -d).applyMatrix4(main.matrixWorld)
        v.quad.position.copy(offset)
        v.quad.quaternion.copy(main.quaternion)
        v.quad.scale.set(w * wide, h * high, 1)
        v.quad.visible = true
      }
    },
    dispose: clear,
  }
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

function houseHud(match: MatchState): HudHouse | undefined {
  const house = match.house
  if (!house) return undefined
  const edge = edgeAt(house.spot, match.tick)
  const seconds = match.tick / ENGINE.tickHz
  const v = house.vault
  const player = match.human !== undefined ? match.heroes[match.human] : undefined
  return {
    spot: house.spot.name,
    phase: edge.phase,
    closing: edge.closing,
    nextIn: edge.nextAt !== undefined ? edge.nextAt - seconds : undefined,
    dps: edge.dps,
    vault: { open: v.open, opensIn: Math.max(0, VAULT.opensAt - seconds), holder: v.holder, by: v.by, fill: v.by === undefined ? 0 : v.meter / ticks(v.holder === undefined ? VAULT.crack : VAULT.steal) },
    outside: !!player?.alive && !insideEdge(edge, player.position),
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
    house: houseHud(match),
    heroes: match.heroes.map((h) => ({
      id: h.id,
      name: setups[h.id].build.heroName,
      team: h.team,
      alive: h.alive,
      hp: h.hp,
      maxHp: h.maxHp,
      damageDealt: h.damageDealt,
      airborne: h.airborne,
      stamina: h.stamina,
      staminaMax: ENGINE.move.stamina.max,
      statuses: statusesOf(h, match.tick).slice(0, 3),
      passiveOn: h.passiveOn,
      ...(h.basicSince >= 0 ? { holding: (match.tick - h.basicSince) / ENGINE.tickHz } : {}),
      fallback: views[h.id]?.fallback ?? false,
      // Skill 1 is a gun: its wait is the time between shots
      cooldowns: Object.fromEntries(BUILD_SLOTS.map((s) => [s, { left: h.cooldowns[s] / ENGINE.tickHz, total: s === 'active1' ? shotSeconds(setups[h.id].kit.active1.ranged?.rate ?? 1, setups[h.id].sheet.fireRate) : setups[h.id].kit[s].cooldown }])) as HudHero['cooldowns'],
    })),
  }
}

/**
 * Bloom for the anime spectacle: only bright things glow (effects, the centre line, the barrier trim). Built through
 * three's render pipeline, which works on both backends; if it cannot be built the match renders without it.
 */
async function bloomPipeline(renderer: Awaited<ReturnType<typeof createRenderer>>['renderer'], scene: THREE.Scene, camera: THREE.Camera) {
  try {
    const [{ RenderPipeline }, { pass, screenUV, smoothstep, float, uniform, vec2, vec3, Fn, Loop, If, mix, step, luminance, atan, hash, floor, PI }, { bloom }] = await Promise.all([
      import('three/webgpu'),
      import('three/tsl'),
      import('three/addons/tsl/display/BloomNode.js'),
    ])
    const scenePass = pass(scene, camera)
    const color = scenePass.getTextureNode('output')
    // the hit feel's share of the screen (§6b): radial blur and speed lines toward a heavy blow or an ultimate, and the
    // impact frame. Each costs nothing while its uniform is zero: the branch is the same for every pixel
    const feel = { blur: uniform(0), centre: uniform(new THREE.Vector2(0.5, 0.5)), lines: uniform(0), impact: uniform(0), seed: uniform(0) }
    const post = Fn(() => {
      const c = vec3(color.rgb).toVar()
      const toward = vec2(feel.centre).sub(screenUV)
      If(feel.blur.greaterThan(0.001), () => {
        const sum = vec3(0).toVar()
        Loop(8, ({ i }) => {
          sum.addAssign(color.sample(screenUV.add(toward.mul(float(i).div(8).mul(feel.blur).mul(0.16)))).rgb)
        })
        c.assign(sum.div(8))
      })
      If(feel.lines.greaterThan(0.001), () => {
        const away = screenUV.sub(vec2(feel.centre))
        const angle = atan(away.y, away.x).div(PI.mul(2)).add(0.5)
        const ray = hash(floor(angle.mul(110)).add(floor(feel.seed.mul(24)).mul(131)))
        const streak = step(0.8, ray).mul(smoothstep(0.16, 0.5, away.length())).mul(feel.lines)
        c.assign(mix(c, vec3(1, 1, 1), streak.mul(0.7)))
      })
      // the impact frame: two frames of ink, light parts white on black, the first of them the other way round
      If(feel.impact.greaterThan(0.5), () => {
        const ink = step(0.3, luminance(c))
        c.assign(vec3(feel.impact.greaterThan(1.5).select(float(1).sub(ink), ink)))
      })
      return c
    })()
    // a soft vignette pulls the eye to the fight in the middle of the frame
    const vignette = float(1).sub(smoothstep(0.35, 0.85, screenUV.sub(0.5).length()).mul(0.35))
    const glow = bloom(color, 0.55, 0.35, 0.82)
    const lit = post.add(glow.rgb.mul(float(1).sub(step(0.5, feel.impact)))).mul(vignette)
    const pipeline = new RenderPipeline(renderer, lit)
    return { pipeline, enabled: true, feel }
  } catch {
    return undefined
  }
}

/** The hit feel the screen shows this frame (effects/player.ts `screen`). */
export interface ScreenFeel {
  blur: number
  centre: [number, number]
  lines: number
  impact: number
  seed: number
}

type Renderer = Awaited<ReturnType<typeof createRenderer>>['renderer']

/** A fresh canvas with a renderer set up the way the arena draws: soft shadows, filmic tone mapping. */
async function newRenderer(host: HTMLElement, forceWebGL: boolean) {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'width:100%;height:100%;display:block'
  host.prepend(canvas)
  try {
    const { renderer, backend } = await createRenderer(canvas, { forceWebGL, trackTimestamp: gpuTimeFlag(window.location.search) })
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

/**
 * Every texture the scene's materials hold, for `retire` to let go of (Forge goal, phase 0). three's renderer hangs a
 * dispose listener on each texture it uploads and its own dispose() leaves those in place, so a texture shared through
 * a cache (faces, clothes, scenery, the head kit) keeps the finished renderer reachable. Calling the texture's own
 * dispose() would free it in every renderer at once, the live match's too, whose next frame then draws with destroyed
 * buffers (StrictMode's discarded first arena finishes loading in the middle of the second one's battle).
 */
function sceneTextures(scene: THREE.Scene) {
  const textures = new Set<THREE.Texture>()
  scene.traverse((o) => {
    const material = (o as THREE.Mesh).material
    for (const m of Array.isArray(material) ? material : material ? [material] : [])
      for (const value of Object.values(m)) if ((value as THREE.Texture | null)?.isTexture) textures.add(value as THREE.Texture)
  })
  return textures
}

/**
 * A finished renderer's device-loss handler. It lives out here because any function made inside createStage, even an
 * empty one, holds createStage's variables, and with them the whole match.
 */
const ignoreLoss = () => {}

/**
 * Let a finished renderer go (Forge goal, phase 0). three keeps a few textures for good, like the lookup table its
 * lighting reads (r186), and a renderer that drew one stays reachable through the listener it left there, along with
 * every scene it drew: one more match kept per match played. So before it's disposed, the renderer drops each texture
 * its shaders bound or its scene holds (its own copy only, so a live renderer elsewhere keeps drawing) and its
 * device-loss hook.
 */
function retire(renderer: Renderer, scene?: THREE.Scene) {
  const own = renderer as Renderer & {
    onDeviceLost: (info: unknown) => void
    _nodes?: { nodeBuilderCache?: Map<unknown, { bindings?: { bindings?: { texture?: THREE.Texture }[] }[] }> }
    _textures?: { _destroyTexture?: (texture: THREE.Texture) => void }
  }
  const bound = scene ? sceneTextures(scene) : new Set<THREE.Texture>()
  for (const state of own._nodes?.nodeBuilderCache?.values() ?? [])
    for (const group of state.bindings ?? [])
      for (const binding of group.bindings ?? []) if (binding.texture?.isTexture && !binding.texture.isRenderTargetTexture) bound.add(binding.texture)
  for (const texture of bound) own._textures?._destroyTexture?.(texture)
  own.onDeviceLost = ignoreLoss
  renderer.dispose()
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
    // the frame-rate guard scales down from the screen's own density, held to the 1440 × 900 the game is built for;
    // until 2026-10-30 nothing applied it, so a Retina screen drew at 1x and then jumped to 2x on its first step down
    const pixelRatio = basePixelRatio(host.clientWidth, host.clientHeight, window.devicePixelRatio)
    first.renderer.setPixelRatio(pixelRatio)
    const scene = new THREE.Scene()
    // far enough to draw the sky dome and the mountains in front of it
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, VIEW_FAR)
    atmosphere(scene)
    const map = buildMap()
    scene.add(map.group)
    const sun = lights(scene)
    cascade(sun)
    const stage = {
      host,
      canvas: first.canvas,
      renderer: first.renderer as Renderer,
      backend: first.backend,
      pixelRatio,
      /** The frame-rate scaler's share of `pixelRatio` (SCALER.min to 1). */
      scale: 1,
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
        stage.pixelRatio = basePixelRatio(w, h, window.devicePixelRatio)
        stage.renderer.setPixelRatio(Math.max(0.5, stage.pixelRatio * stage.scale))
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
        retire(stage.renderer, scene)
        stage.canvas.remove()
      },
      /** Rebuild the renderer on a new canvas after the graphics device was lost; false once out of attempts. */
      recover: async (): Promise<boolean> => {
        if (stage.recoveries >= MAX_RECOVERIES || stage.recovering) return false
        stage.recoveries++
        stage.recovering = true
        try {
          const shadows = stage.sun.castShadow
          const bloomOn = stage.glow?.enabled ?? false
          const next = await newRenderer(host, true)
          try {
            retire(stage.renderer, scene)
          } catch {
            // a lost device may refuse to release; the canvas goes regardless
          }
          stage.canvas.remove()
          stage.canvas = next.canvas
          stage.renderer = next.renderer
          stage.backend = next.backend
          stage.sun.castShadow = shadows
          cascade(stage.sun)
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

/** The render scale the last match ended on (Forge goal, phase 0): the next one starts there instead of at full. */
let lastScale: number | undefined

/**
 * The frame-rate guard wired to the stage (U18, R26): render resolution moves first, and the quality levels only start
 * once it is at its floor; on the way back up the levels return first and resolution after. Nothing here turns shadows
 * or bloom off, because either one rebuilds every material in the middle of a fight.
 */
function qualityControl(stage: Stage) {
  const guard = createGuard()
  const scaler = createScaler(lastScale)
  let current: QualityLevel = 'full'
  let frame = 0
  const applyScale = () => {
    lastScale = stage.scale = scaler.scale
    stage.resize()
  }
  if (scaler.scale < SCALER.max) applyScale()
  return {
    current: () => current,
    level: (l: QualityLevel) => atLeast(current, l),
    observe(frameMs: number) {
      const before = scaler.scale
      if (current === 'full') scaleFor(scaler, frameMs)
      if (scaler.scale !== before) applyScale()
      // the guard only watches once resolution has nothing left to give, and starts from a fresh window when it does
      if (current === 'full' && !atFloor(scaler)) guard.frames = []
      else current = observe(guard, frameMs)
      // lazy shadows redraw the sun's shadow map every third frame instead of every frame
      const lazy = atLeast(current, 'lazy-shadows')
      const redraw = lazy && frame++ % 3 === 0
      for (const shadow of sunShadows(stage.sun)) {
        shadow.autoUpdate = !lazy
        if (redraw) shadow.needsUpdate = true
      }
    },
  }
}

const yawQ = new THREE.Quaternion()
const up = new THREE.Vector3(0, 1, 0)

/** How far cast clips may fall behind the engine during hit-stops, in ticks, and how fast they catch up after. */
const HIT_STOP_LAG = { max: 12, catchUp: 0.5 }

/**
 * Pose every hero between the last two engine states. Physics only changes how a body looks: a tumble on top of the
 * engine's position, or where a fallen body lies (KTD12). Returns where each hero was drawn.
 */
function drawHeroes(
  ctx: { arena: Arena; views: HeroView[]; animators: Animator[]; stances: (Stance | undefined)[]; physics: CosmeticPhysics | undefined; camera: THREE.Camera; lods?: HeroLod[]; tiers: Tier[]; impostors?: THREE.Sprite[]; hidden: number[]; sight: number[]; occlude: boolean; down: number[]; swinging: boolean[] },
  prev: Vec3[],
  frame: { alpha: number; dt: number; t: number; frameNo: number; timeScale: number; slowFar: boolean; clock: number },
): Vec3[] {
  const { arena, views, animators, stances, physics, camera, lods, impostors } = ctx
  const ats = arena.match.heroes.map((h, i) => {
    const p = prev[i]
    const c = h.position
    return { x: p.x + (c.x - p.x) * frame.alpha, y: p.y + (c.y - p.y) * frame.alpha, z: p.z + (c.z - p.z) * frame.alpha }
  })
  // each hero's level of detail from how far it stands from the camera (GAME.md §10)
  const tiers = ctx.tiers
  const distances = ats.map((a) => Math.sqrt((a.x - camera.position.x) ** 2 + (a.y - camera.position.y) ** 2 + (a.z - camera.position.z) ** 2))
  tiersFor(distances, tiers).forEach((t, i) => (tiers[i] = t))
  // occlusion by zone and level: a hero the stone hides from the camera for a few frames is drawn for the sun only
  const cover = arena.match.cover
  const sight = cover && sightHealth(cover.pieces, cover.health, ctx.sight)
  return arena.match.heroes.map((h, i) => {
    const p = prev[i]
    const c = h.position
    const at = ats[i]
    const moved = Math.sqrt((c.x - p.x) ** 2 + (c.z - p.z) ** 2)
    const view = views[i]
    view.setForm?.(h.formUntil > 0, h.size)
    const tier = tiers[i]
    lods?.[i].apply(tier, distances[i] <= LOD.close)
    const unseen = ctx.occlude && !!cover && !!sight && i !== arena.match.human && distances[i] > LOD.close && occluded(camera.position, at, capsule(h).height, cover.pieces, sight)
    ctx.hidden[i] = unseen ? (ctx.hidden[i] ?? 0) + 1 : 0
    const hide = ctx.hidden[i] >= HIDE_AFTER
    if (hide !== view.root.layers.isEnabled(OCCLUDED_LAYER)) setOccluded(view.root, hide)
    const card = impostors?.[i]
    if (card) {
      card.visible = tier === 'impostor' && view.root.visible && !hide
      if (card.visible) {
        const { height } = capsule(h)
        card.scale.set(height * 0.5, height, 1)
        card.position.set(at.x, at.y + height / 2, at.z)
      }
    }
    // a body that has lain dead and still a while is drawn as it lay: no pose, no cloth, no matrices worked out again
    ctx.down[i] = h.alive ? 0 : (ctx.down[i] ?? 0) + frame.dt
    const fallen = view.animatesDeath ? undefined : physics?.fallenPose(i)
    const resting = !h.alive && mayRest(ctx.down[i], moved, ctx.swinging[i] ?? false, fallen?.sleeping ?? true)
    setResting(view.root, resting)
    if (resting) return at
    // mid heroes animate at 30 Hz and far ones at 15; under load, or seen only by its shadow, twice as seldom again; an
    // impostor not at all
    const every = POSE_EVERY[tier] * (frame.slowFar && tier !== 'near' ? 2 : 1) * (hide ? 2 : 1)
    const far = tier !== 'near'
    // casts run on the engine's clock, between ticks too, so a clip's release frame lands on its release tick
    const pose = settle(animators[i], h, moved, frame.clock, frame.dt)
    const scaled = frame.dt * frame.timeScale
    const moving = moved > 0.01
    // the hips turn partway toward the way the hero moves, the legs run the rest at an angle and the chest twists to
    // its aim, casting on the move too, since its legs keep running under the cast, and dashing, on the ground or off
    // it; a slide or a roll faces along its line; standing, the feet stay put until the aim is far round; in the air, the whole
    // body faces the aim. A view that can't twist faces its aim whole. The run keeps pace with the ground covered
    const ground = h.airborne ? 0 : moved * ENGINE.tickHz
    const striding = pose.kind === 'run' || (pose.kind === 'cast' && pose.prep !== undefined && ground > STANCE.stride)
    // a roll, like a slide, faces along its line: the body tumbles the way it goes
    const mode = pose.kind === 'slide' || pose.kind === 'roll' ? 'slide' : pose.kind === 'dash' || (striding && !h.airborne) ? 'run' : h.airborne ? 'square' : 'stand'
    // a view on the motion library's gait sidesteps and backpedals square to its aim, but turns into a dash
    const strafes = view.strafes === true && pose.kind !== 'dash'
    const s = view.lean ? stance(stances[i], h.yaw, moving ? { x: c.x - p.x, z: c.z - p.z } : undefined, mode, scaled, strafes) : undefined
    stances[i] = s
    // standing on the ground, the feet stay where they land
    if (s) view.lean!(s.twist, s.back, ground, mode === 'stand' && !moving && pose.kind !== 'dead', s.legs, s.heading, h.sprinting)
    view.aim?.(h.yaw, h.pitch)
    if (every && (frame.frameNo + i) % every === 0) view.pose(pose, frame.t + i, scaled * every, moving)
    // a view that animates its own fall stays where the engine left it; a stand-in lies where its physics body landed
    if (fallen) {
      view.root.position.set(fallen.position.x, fallen.position.y, fallen.position.z)
      view.root.quaternion.set(fallen.rotation.x, fallen.rotation.y, fallen.rotation.z, fallen.rotation.w)
      ctx.swinging[i] = view.settle?.(scaled, far) ?? false
      return at
    }
    view.root.position.set(at.x, at.y, at.z)
    yawQ.setFromAxisAngle(up, s?.body ?? h.yaw)
    const tumble = physics?.rotation(i)
    if (tumble) view.root.quaternion.set(tumble.x, tumble.y, tumble.z, tumble.w).multiply(yawQ)
    else view.root.quaternion.copy(yawQ)
    // the outfit's loose cloth swings once the hero stands where it's drawn
    ctx.swinging[i] = view.settle?.(scaled, far) ?? false
    return at
  })
}

const place = new THREE.Object3D()

/** A team ring on the floor under every living hero, sized to its hitbox, so a crowd still reads at a glance (R38). */
function drawRings(rings: THREE.InstancedMesh, arena: Arena, drawn: Vec3[]) {
  arena.match.heroes.forEach((h, i) => {
    const at = drawn[i]
    // on the floor under the hero (a jump leaves its ring behind on the deck it left), not at y 0
    place.position.set(at.x, groundUnder(arena.match, at) + 0.03, at.z)
    place.quaternion.setFromAxisAngle(right, -Math.PI / 2)
    place.scale.setScalar(h.alive ? capsule(h).radius * 1.6 : 0)
    place.updateMatrix()
    rings.setMatrixAt(i, place.matrix)
  })
  rings.instanceMatrix.needsUpdate = true
}
const right = new THREE.Vector3(1, 0, 0)

/**
 * Load everything a match needs, reporting progress, then run it until `stop` (U13). An aborted `signal` (the player
 * left the route while it loaded) stops the load at its next step and frees what it had built.
 */
export async function startArena(host: HTMLElement, setup: MatchSetup, onProgress: (done: number, total: number) => void = () => {}, signal?: AbortSignal): Promise<ArenaController> {
  signal?.throwIfAborted()
  const stage = await createStage(host)
  let physics: CosmeticPhysics | undefined
  try {
    signal?.throwIfAborted()
    return await run(stage, setup, onProgress, (p) => (physics = p), signal)
  } catch (e) {
    // a failed load must not leave a live renderer or a physics world behind
    physics?.dispose()
    stage.dispose()
    throw e
  }
}

async function run(stage: Stage, setup: MatchSetup, onProgress: (done: number, total: number) => void, keepPhysics: (p: CosmeticPhysics | undefined) => void, signal?: AbortSignal): Promise<ArenaController> {
  const { renderer, scene, camera, map } = stage
  // the range's drills (a dummy standing idle) play without the house's edge and vault
  const arena = createMatch(setup.teams[0], setup.teams[1], setup.seed, { profile: setup.idle?.length ? PRACTICE_PROFILE : LIVE_PROFILE, formations: setup.formations, map: LIVE_MAP })
  if (setup.aiLevels) arena.match.aiLevels = setup.aiLevels
  // dev only: ?style=rifle hands every hero that fighting style, to watch a style's clips in a live match
  const devStyle = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('style') : null
  const builds = arena.setups.map((s) => (devStyle && s.build.look ? { ...s.build, look: { ...s.build.look, style: devStyle as Style } } : s.build))
  let loaded = 0
  // Rapier loads with the heroes, so Start waits for both (R40)
  const total = builds.length + 1
  onProgress(0, total)
  // physics is cosmetic: if Rapier fails to load, the match runs without it (KTD12)
  const physicsReady = CosmeticPhysics.create(arena.match.cover?.pieces)
    .catch(() => undefined)
    .then((p) => (keepPhysics(p), onProgress(++loaded, total), p))
  // the two heroes nearest the streamer's side load at 2K; the rest at 1K (R24)
  const views = await Promise.all(
    builds.map(async (build, i) => {
      signal?.throwIfAborted()
      const view = await loadHeroView(build, setup.packages?.[i], i, arena.match.heroes[i].team === setup.side && i < 2, renderer, arena.match.heroes[i].team)
      onProgress(++loaded, total)
      return view
    }),
  )
  signal?.throwIfAborted()
  views.forEach((v) => scene.add(v.root))
  // every hero's simplified meshes are made now, while loading, not in the frame it first walks off; a hero whose
  // view the simplifier can't take is drawn whole
  const lods = await lodReady()
    .then(() => views.map((v) => {
      const lod = new HeroLod(v.root)
      lod.prepare()
      return lod
    }))
    .catch(() => undefined)
  signal?.throwIfAborted()
  const cards = TEAM_COLORS.map((c) => impostorMaterial(new THREE.Color(c)))
  const impostors = arena.match.heroes.map((h) => {
    const card = new THREE.Sprite(cards[h.team])
    card.name = 'impostor'
    card.visible = false
    scene.add(card)
    return card
  })
  // the arena comes from the engine's own cover, so what is drawn is exactly what blocks (R25): the House of
  // Instinct in grey boxes (GAME.md §8), or the ruins
  const cover = arena.match.cover
  const ruins = cover ? (arena.match.map === 'house' ? buildGreybox(cover.pieces, arena.match.lines) : buildRuins(cover.pieces)) : undefined
  if (ruins) {
    scene.add(ruins.group)
    map.proxies.push(...ruins.proxies)
  }
  const physics = await physicsReady
  signal?.throwIfAborted()
  const rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }), arena.match.heroes.length)
  // the HUD draws each hero's name and health over its head; the floor ring keeps its team readable from far off
  arena.match.heroes.forEach((h, i) => rings.setColorAt(i, new THREE.Color(TEAM_COLORS[h.team])))
  rings.name = 'team rings'
  scene.add(rings)
  // the controlled hero's basic attack reach, on the floor
  const range = createRangeIndicator(scene)
  // the edge and the vault's ring first show 20 s in, mid-fight: built before the compile, their shaders are ready
  const houseView = createHouseView(scene)
  // compile every material before the fight so the first frames do not stutter (U1 found WebGL2 compiles lazily)
  await (renderer as unknown as { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<void> }).compileAsync?.(scene, camera)
  signal?.throwIfAborted()

  const animators: Animator[] = arena.match.heroes.map(createAnimator)
  const stances: (Stance | undefined)[] = []
  const props = propLods(scene)
  const drawCtx = { arena, views, animators, stances, physics, camera, lods, tiers: [] as Tier[], impostors, hidden: [] as number[], sight: [] as number[], occlude: true, down: [] as number[], swinging: [] as boolean[] }
  if (import.meta.env.DEV) Object.assign(window, { __lod: drawCtx })
  const rules = matchRules(arena)
  const clock = createClock()
  const quality = qualityControl(stage)
  const insets = createInsets(scene, camera, stage.backend)
  const store = createStore<HudState>(hud(arena, views, false, stage.backend, 'full'))
  const hooks = createHooks()
  const cameras = new Cameras(camera)
  // the free camera starts behind the streamer's half, looking across the arena; over the House of Instinct it
  // starts high behind the muster, above the balconies, looking down on the court
  const house = arena.match.map === 'house'
  if (house) {
    cameras.floor = MAPS.house.stand
    cameras.free.set(0, 26, -38)
    cameras.pitch = -0.52
  }
  if (setup.side === 1) {
    cameras.free.set(0, house ? 26 : 13, house ? 38 : 27)
    cameras.yaw = Math.PI
  }
  stage.resize()
  window.addEventListener('resize', stage.resize)

  let prev: Vec3[] = arena.match.heroes.map((h) => ({ ...h.position }))
  let drawn: Vec3[] = prev.map((p) => ({ ...p }))
  let last = performance.now()
  let stopped = false
  let unprobe: (() => void) | undefined
  let frameNo = 0
  // ticks the cast clips run behind the engine: a hit-stop holds every swing at its contact frame, and the clips catch
  // up through the recovery
  let lag = 0
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
    // a slowed clock slows everything drawn with it: the fight, the animation and the effects
    const speed = hooks.speed?.() ?? 1
    const { ticks, alpha } = frame(clock, dt * speed)
    const scale = hooks.timeScale?.() ?? 1
    const elapsed = clock.paused ? 0 : dt * speed * ENGINE.tickHz
    lag = Math.min(HIT_STOP_LAG.max, scale < 1 ? lag + elapsed * (1 - scale) : Math.max(0, lag - elapsed * HIT_STOP_LAG.catchUp))
    for (let i = 0; i < ticks && arena.match.winner === undefined; i++) {
      prev = arena.match.heroes.map((h) => ({ ...h.position }))
      const commands = aiCommands(arena)
      for (const i of setup.idle ?? []) commands[i] = undefined
      const human = arena.match.human
      if (human !== undefined) commands[human] = hooks.human?.()
      const events = tick(arena.match, arena.setups, commands, rules)
      // the controlled hero died: control goes back to watching from the free camera (AE1)
      if (releaseIfDead(arena.match)) cameras.set('free')
      physics?.events(events, arena.match)
      for (const e of events) {
        if (e.type === 'cover-hit') ruins?.hit(e.index, e.health)
        else if (e.type === 'cover-broken') ruins?.broken(e.index)
      }
      if (events.length) {
        arena.match.heroes.forEach((_, j) => onEvents(animators[j], j, events, arena.match.tick))
        hooks.emit.events(events)
      }
    }
    physics?.step(dt)
    ruins?.update(dt)
    for (const p of props) p.update(camera.position)
    houseView.update(arena.match, alpha)
    drawn = drawHeroes(drawCtx, prev, { alpha, dt, t: now / 1000, frameNo, timeScale: scale * speed, slowFar: quality.level('slow-animation'), clock: arena.match.tick + alpha - lag })
    drawRings(rings, arena, drawn)
    const followed = arena.match.human === undefined && cameras.follow !== undefined ? drawn[cameras.follow] : undefined
    cameras.update(dt, arena.match.human !== undefined ? drawn[arena.match.human] : undefined, map.proxies, followed)
    // in first person the camera looks out of the hero's eyes, so its own body isn't drawn
    if (arena.match.human !== undefined) views[arena.match.human].root.visible = cameras.scope < FIRST_PERSON
    range.update(arena.match, arena.setups, drawn, cameras.yaw, cameras.pitch)
    hooks.emit.frame(dt * speed, alpha)
    if (!stage.recovering) insets.render(stage.renderer)
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
    insets: (views) => insets.set(views),
    screen: (f) => {
      const u = stage.glow?.enabled ? stage.glow.feel : undefined
      if (!u) return
      u.blur.value = f.blur
      u.centre.value.set(f.centre[0], f.centre[1])
      u.lines.value = f.lines
      u.impact.value = f.impact
      u.seed.value = f.seed
    },
    stop: () => {
      stopped = true
      unprobe?.()
      physics?.dispose()
      insets.dispose()
      stage.dispose()
      // a stopped match must not stay reachable as the dev handle (a Vite reload or a double mount left one behind)
      if (import.meta.env.DEV && (window as unknown as { __arena?: ArenaController }).__arena === controller) (window as unknown as { __arena?: ArenaController }).__arena = undefined
    },
  }
  // a dev-only handle for checking art and UI from a script, like the cameras and the match (never in production)
  if (import.meta.env.DEV) (window as unknown as { __arena?: ArenaController }).__arena = controller
  // dev only too: `__probe` reads the scene with rays and `__listen` records the sound, so a script can see and hear it
  if (import.meta.env.DEV)
    void Promise.all([import('./probe.js'), import('./effects/listen.js')]).then(([probe, listen]) => {
      listen.install()
      if (stopped) return
      unprobe = probe.watch('arena', {
        scene,
        camera,
        get canvas() {
          return stage.renderer.domElement
        },
        heroes: () => views.map((v, i) => ({ root: v.root, name: builds[i].heroName, team: arena.match.heroes[i].team, alive: arena.match.heroes[i].alive })),
      })
    })
  return controller
}
