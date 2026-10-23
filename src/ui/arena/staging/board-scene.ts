import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import type { AnimState } from '../../../arena/client/animation'
import { loadHeroView, type HeroView } from '../../../arena/client/heroes'
import { TEAM_COLORS, atmosphere, buildMap, lights } from '../../../arena/client/map'
import { createRenderer, forceWebGLFlag } from '../../../arena/client/render/renderer'
import { buildRuins } from '../../../arena/client/ruins'
import { SIZE_SCALE } from '../../../arena/demo/procedural-hero'
import { ENGINE } from '../../../arena/engine/calibration'
import { RUINS } from '../../../arena/engine/cover'
import type { Team } from '../../../arena/engine/state'
import { shortName } from '../hud/format'
import {
  BOARD_FOV,
  applyView,
  approach,
  clampView,
  floorPoint,
  homeView,
  insideBox,
  judge,
  limitsFor,
  matchSlots,
  orbit,
  pan,
  pick,
  reasonText,
  sameView,
  screenPoint,
  toNdc,
  toScreen,
  zoom,
  type FloorPoint,
  type Limits,
  type Slot,
  type Standee,
  type Verdict,
  type View,
} from './board-math'
import type { Formation } from './formation'
import type { LoadoutEntry } from './loadout'

/**
 * The staging board in 3D (U16): the arena itself, built by the match's own builders (sky, island, ruins, characters,
 * lights and bloom), seen from an angled camera over the whole of it. Heroes are dragged in from the row, moved, and
 * dragged off; each placed hero stands as its arena character on a team ring under its 1-0 key badge.
 *
 * It draws only when something changes (the camera, a drag, a hero landing), keeps one renderer, and gives everything
 * back on dispose, before the match makes its own.
 */

export interface BoardState {
  formation: Formation
  loadout: readonly LoadoutEntry[]
  /** The player's side: the camera starts behind it. */
  side: Team
  /** The side being set up: its half is lit, and heroes from the row go there. */
  editing: Team
  selected?: { side: Team; index: number }
  /** A hero picked in the row, placed with a click on the floor. */
  brush?: number
}

export interface BoardHandlers {
  /** Put `hero` on the side being set up at (x, z); the caller applies the rules and says why a spot is refused. */
  place: (hero: number, x: number, z: number) => void
  move: (side: Team, index: number, x: number, z: number) => void
  remove: (side: Team, index: number) => void
  select: (placed: { side: Team; index: number } | undefined) => void
  /** A placed hero is in the hand (true) or let go (false). */
  dragging: (on: boolean) => void
  /** The view left its home framing (false) or came back (true). */
  view: (home: boolean) => void
}

export interface BoardScene {
  update: (state: BoardState) => void
  /** A hero carried from the row is at this pointer position; true when that is over the board. */
  carry: (hero: number, clientX: number, clientY: number) => boolean
  /** Let the carried hero go: the floor spot under the pointer, or undefined when it was not over the floor. */
  drop: (clientX: number, clientY: number) => FloorPoint | undefined
  cancelCarry: () => void
  resetView: () => void
  dispose: () => Promise<void>
}

const { halfWidth: W, halfLength: L } = ENGINE.arena
const TEAM_RGB = TEAM_COLORS.map((c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255] as const)
/** Pixels per metre in the floor overlays. */
const PPM = 16
/** How high a hero in the hand floats over the floor, metres. */
const LIFT = 0.9
/** How much bigger a hero in the hand is drawn: picked up, it reads at a glance even from the whole-arena view. */
const HELD_SCALE = 1.5
/** Team rings and the landing marker are drawn wider than the match's, metres of radius at medium size. */
const RING_RADIUS = 1.25
const VERDICT_COLOR = { ok: new THREE.Color(0x63ff9a), bad: new THREE.Color(0xff4d3d), remove: new THREE.Color(0xd9d0e6) }
const GOLD = new THREE.Color(0xffcf5a)
const WHITE = new THREE.Color(0xffffff)

interface Figure {
  side: Team
  /** The loadout entry's key: the same hero keeps the same figure across edits. */
  key: string
  hero: number
  /** Where the formation has it. */
  x: number
  z: number
  /** Where it is drawn now; eases toward `x, z` unless it is in the hand. */
  at: FloorPoint
  held: boolean
  body: THREE.Group
  mark: THREE.Group
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  disc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>
  halo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  view?: HeroView
  /** The size class's scale: the ring and the badge's height follow it. */
  scale: number
  name: string
  badge: HTMLDivElement
  standee: Standee
  lift: number
  liftTo: number
  /** Drawn size relative to its own: HELD_SCALE in the hand, 1 on the floor. */
  grow: number
  /** When its drop-in starts (ms), or 0 once landed. */
  dropAt: number
  anim: AnimState
  animUntil: number
  /** A stable offset into its idle, so a crowd does not stand in step. */
  phase: number
}

/** A hero the pointer is carrying that is not on the board yet: from the row, or the one a click would place. */
interface Ghost {
  figure: Figure
  hero: number
  side: Team
  source: 'carry' | 'brush'
  at?: FloorPoint
  verdict?: Verdict
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'press'; figure: Figure; side: Team; index: number; x0: number; y0: number; id: number }
  | { kind: 'drag'; figure: Figure; side: Team; index: number; id: number; at?: FloorPoint; verdict: Verdict }
  | { kind: 'orbit'; x: number; y: number; id: number }
  | { kind: 'pan'; x: number; y: number; x0: number; y0: number; id: number; tap: boolean }

const flat = <T extends THREE.BufferGeometry>(g: T) => g.rotateX(-Math.PI / 2)
const overlayMaterial = (color: THREE.ColorRepresentation, opacity: number, extra: THREE.MeshBasicMaterialParameters = {}) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false, ...extra })

function hashOf(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

const easeOut = (t: number) => 1 - (1 - t) ** 3

/** The ground a side may stand on, as a canvas rectangle in the half's own overlay (see `halfCanvas`). */
function legalRect(side: Team) {
  const zTop = side === 0 ? -L : 0
  const Z = (z: number) => (z - zTop) * PPM
  const top = Z(side === 0 ? -L + 1 : 1)
  const bottom = Z(side === 0 ? -1 : L - 1)
  return { left: PPM, top, width: (2 * W - 2) * PPM, height: bottom - top, Z }
}

/**
 * A canvas the size of one half, mapped onto a floor plane: the canvas's left edge is x = -W and its top edge is the
 * half's most negative z (the back wall for side 0, the middle for side 1).
 */
function halfCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = 2 * W * PPM
  canvas.height = L * PPM
  return { canvas, g: canvas.getContext('2d')! }
}

function canvasTexture(canvas: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** A half's deploy zone: its team's tint, a glow inside the border, a faint 4 m grid, and its name on the floor. */
function zoneTexture(side: Team, yours: Team): THREE.CanvasTexture {
  const { canvas, g } = halfCanvas()
  const [r, gr, b] = TEAM_RGB[side]
  const tint = (a: number) => `rgba(${r},${gr},${b},${a})`
  const { left, top, width, height, Z } = legalRect(side)
  g.fillStyle = tint(0.13)
  g.fillRect(left, top, width, height)
  const edge = 3.2 * PPM
  const band = (x: number, y: number, w: number, h: number, x0: number, y0: number, x1: number, y1: number) => {
    const lg = g.createLinearGradient(x0, y0, x1, y1)
    lg.addColorStop(0, tint(0.34))
    lg.addColorStop(1, tint(0))
    g.fillStyle = lg
    g.fillRect(x, y, w, h)
  }
  band(left, top, width, edge, 0, top, 0, top + edge)
  band(left, top + height - edge, width, edge, 0, top + height, 0, top + height - edge)
  band(left, top, edge, height, left, 0, left + edge, 0)
  band(left + width - edge, top, edge, height, left + width, 0, left + width - edge, 0)
  g.strokeStyle = tint(0.13)
  g.lineWidth = 2
  g.beginPath()
  for (let x = -W + 4; x < W; x += 4) {
    g.moveTo((x + W) * PPM, top)
    g.lineTo((x + W) * PPM, top + height)
  }
  for (let k = 4; k < L; k += 4) {
    const y = Z(side === 0 ? -k : k)
    g.moveTo(left, y)
    g.lineTo(left + width, y)
  }
  g.stroke()
  g.strokeStyle = tint(0.95)
  g.lineWidth = 0.24 * PPM
  g.strokeRect(left, top, width, height)
  // the side's name at the back of its half, upright as the player's camera sees it (the near half reads upside down
  // in canvas terms from behind side 0)
  g.save()
  g.translate(W * PPM, Z(side === 0 ? -L + 4.2 : L - 4.2))
  if (yours === 0) g.rotate(Math.PI)
  g.font = `italic 800 ${4.8 * PPM}px 'Barlow Condensed', 'Arial Narrow', sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = tint(0.62)
  g.fillText(side === yours ? 'YOUR SIDE' : 'ENEMY SIDE', 0, 0)
  g.restore()
  return canvasTexture(canvas)
}

/** Where the ruins keep a hero out (each piece plus the widest body's radius), hatched, inside the half's ground. */
function keepOutTexture(side: Team): THREE.CanvasTexture {
  const { canvas, g } = halfCanvas()
  const { left, top, width, height, Z } = legalRect(side)
  const hatch = document.createElement('canvas')
  hatch.width = hatch.height = 12
  const h = hatch.getContext('2d')!
  h.strokeStyle = 'rgba(255, 96, 72, 0.6)'
  h.lineWidth = 2.2
  h.beginPath()
  for (const o of [-12, 0, 12]) {
    h.moveTo(o, 12)
    h.lineTo(o + 12, 0)
  }
  h.stroke()
  g.save()
  g.beginPath()
  g.rect(left, top, width, height)
  g.clip()
  const pad = ENGINE.bodyRadiusCap
  const X = (x: number) => (x + W) * PPM
  g.beginPath()
  for (const p of RUINS) {
    // a lintel high overhead does not stop anyone standing under it (formation.inRuins)
    if (p.base >= ENGINE.capsule.height * 2) continue
    const s = p.shape
    if (s.kind === 'column') {
      g.moveTo(X(s.x) + (s.r + pad) * PPM, Z(s.z))
      g.arc(X(s.x), Z(s.z), (s.r + pad) * PPM, 0, Math.PI * 2)
    } else g.roundRect(X(s.x - s.hx - pad), Z(s.z - s.hz - pad), (2 * s.hx + 2 * pad) * PPM, (2 * s.hz + 2 * pad) * PPM, pad * PPM)
  }
  g.fillStyle = 'rgba(255, 70, 50, 0.16)'
  g.fill()
  g.fillStyle = g.createPattern(hatch, 'repeat')!
  g.fill()
  g.strokeStyle = 'rgba(255, 120, 90, 0.75)'
  g.lineWidth = 0.12 * PPM
  g.stroke()
  g.restore()
  return canvasTexture(canvas)
}

/** A vertical glow that fades upward, for the beam over the spot a carried hero would land on. */
function beamTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 64
  const g = canvas.getContext('2d')!
  const lg = g.createLinearGradient(0, 64, 0, 0)
  lg.addColorStop(0, 'rgba(255,255,255,0.75)')
  lg.addColorStop(0.35, 'rgba(255,255,255,0.22)')
  lg.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = lg
  g.fillRect(0, 0, 4, 64)
  return new THREE.CanvasTexture(canvas)
}

/** The match's bloom and vignette (match-view.ts), so the board looks like the fight it sets up. */
async function bloomPipeline(renderer: WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera) {
  try {
    const [{ RenderPipeline }, { pass, screenUV, smoothstep, float }, { bloom }] = await Promise.all([import('three/webgpu'), import('three/tsl'), import('three/addons/tsl/display/BloomNode.js')])
    const scenePass = pass(scene, camera)
    const color = scenePass.getTextureNode('output')
    const vignette = float(1).sub(smoothstep(0.35, 0.85, screenUV.sub(0.5).length()).mul(0.35))
    return new RenderPipeline(renderer, color.add(bloom(color, 0.55, 0.35, 0.82)).mul(vignette))
  } catch {
    return undefined
  }
}

/** Wait (briefly) for the display face, so the names painted on the floor use it. */
async function fontsReady() {
  try {
    await Promise.race([document.fonts.load(`italic 800 64px 'Barlow Condensed'`), new Promise((r) => setTimeout(r, 1200))])
  } catch {
    // no font loading API: the fallback face is fine
  }
}

export async function createBoardScene(host: HTMLElement, initial: BoardState, handlers: () => BoardHandlers): Promise<BoardScene> {
  const canvas = document.createElement('canvas')
  canvas.className = 'board3d-canvas'
  canvas.setAttribute('aria-hidden', 'true')
  const overlay = document.createElement('div')
  overlay.className = 'board3d-overlay'
  overlay.setAttribute('aria-hidden', 'true')
  const label = document.createElement('div')
  label.className = 'board3d-label'
  label.hidden = true
  overlay.append(label)
  host.append(canvas, overlay)

  let renderer: WebGPURenderer
  try {
    ;({ renderer } = await createRenderer(canvas, { forceWebGL: forceWebGLFlag(window.location.search) }))
  } catch (e) {
    canvas.remove()
    overlay.remove()
    throw e
  }
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1))
  renderer.shadowMap.enabled = true
  // the match asks for PCFSoftShadowMap, which three now draws as PCFShadowMap (and warns); ask for that directly
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05

  // the match's own stage: sky, island, lights and the ruins the engine blocks with
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(BOARD_FOV, 1, 2, 1400)
  atmosphere(scene)
  // the camera stands far back to take in the whole arena: push the haze out with it so the floor stays clear
  const fog = scene.fog as THREE.Fog | null
  if (fog) {
    fog.near = 190
    fog.far = 620
  }
  scene.add(buildMap().group)
  lights(scene)
  scene.add(buildRuins(RUINS).group)
  const pipeline = await bloomPipeline(renderer, scene, camera)
  await fontsReady()

  let state = initial

  // ── the halves: each tinted for its side, the one being set up lit, the other dimmed ──
  const halfGeo = flat(new THREE.PlaneGeometry(2 * W, L))
  const zones = ([0, 1] as const).map((s) => {
    const zone = new THREE.Mesh(halfGeo, overlayMaterial(0xffffff, 1, { map: zoneTexture(s, state.side) }))
    const keepOut = new THREE.Mesh(halfGeo, overlayMaterial(0xffffff, 0.55, { map: keepOutTexture(s) }))
    const dim = new THREE.Mesh(halfGeo, overlayMaterial(0x080412, 0.34))
    const z = s === 0 ? -L / 2 : L / 2
    zone.position.set(0, 0.03, z)
    keepOut.position.set(0, 0.035, z)
    dim.position.set(0, 0.04, z)
    zone.renderOrder = 1
    keepOut.renderOrder = 1
    dim.renderOrder = 1
    scene.add(zone, keepOut, dim)
    return { zone, keepOut, dim }
  })
  let zoneSide: Team | undefined
  let zoneDragging = false
  const emphasise = () => {
    const held = gesture.kind === 'drag' ? gesture.side : ghost?.source === 'carry' ? ghost.side : undefined
    const active = held ?? state.editing
    const dragging = held !== undefined
    if (active === zoneSide && dragging === zoneDragging) return
    zoneSide = active
    zoneDragging = dragging
    zones.forEach((z, s) => {
      z.zone.material.opacity = s === active ? 1 : 0.4
      z.dim.visible = s !== active
      z.keepOut.visible = s === active
      z.keepOut.material.opacity = dragging ? 0.95 : 0.5
    })
    kick()
  }

  // ── the floor marker under a carried hero: green where it can stand, red where it cannot ──
  const ringGeo = flat(new THREE.RingGeometry(0.8, 1, 48))
  const discGeo = flat(new THREE.CircleGeometry(0.8, 40))
  const haloGeo = flat(new THREE.RingGeometry(1.14, 1.32, 48))
  const marker = new THREE.Group()
  // a bold ring and fill, so the verdict reads even where the hero is a few pixels tall
  const markerRing = new THREE.Mesh(flat(new THREE.RingGeometry(0.62, 1, 48)), overlayMaterial(VERDICT_COLOR.ok, 1))
  const markerDisc = new THREE.Mesh(flat(new THREE.CircleGeometry(0.62, 40)), overlayMaterial(VERDICT_COLOR.ok, 0.42))
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85, 0.85, 6, 32, 1, true).translate(0, 3, 0),
    overlayMaterial(VERDICT_COLOR.ok, 0.85, { map: beamTexture(), blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  )
  marker.add(markerDisc, markerRing, beam)
  marker.visible = false
  marker.renderOrder = 3
  scene.add(marker)
  const showMarker = (at: FloorPoint | undefined, verdict: Verdict | undefined, scale: number) => {
    if (!at || !verdict) {
      marker.visible = false
      return
    }
    const c = VERDICT_COLOR[verdict.kind]
    marker.visible = true
    marker.position.set(at.x, 0.07, at.z)
    marker.scale.setScalar(Math.max(1, scale) * RING_RADIUS * 1.2)
    markerRing.material.color.copy(c)
    markerDisc.material.color.copy(c)
    beam.material.color.copy(c)
    beam.visible = verdict.kind !== 'remove'
  }
  const showLabel = (clientX: number, clientY: number, text: string | undefined, kind: Verdict['kind']) => {
    if (!text) {
      label.hidden = true
      return
    }
    label.hidden = false
    if (label.textContent !== text) label.textContent = text
    label.className = `board3d-label ${kind}`
    label.style.transform = `translate3d(${Math.round(clientX + 18)}px, ${Math.round(clientY + 14)}px, 0)`
  }

  // ── the camera ──
  const probe = new THREE.PerspectiveCamera(BOARD_FOV, 1, 2, 1400)
  let home: View = homeView(state.side, 1.4)
  let limits: Limits = limitsFor(home)
  let view = home
  let goal = home
  let atHome = true
  const setGoal = (next: View) => {
    goal = next
    const now = sameView(goal, home)
    if (now !== atHome) {
      atHome = now
      handlers().view(now)
    }
    kick()
  }
  /** The floor under a pointer, as the camera will see it once it settles (so drags and zooms do not lag). */
  const floorAt = (clientX: number, clientY: number, rect: DOMRect, through: View = goal) => {
    applyView(probe, through)
    const ndc = toNdc(clientX, clientY, rect)
    return floorPoint(probe, ndc.x, ndc.y)
  }

  // ── placed heroes ──
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let placed: Figure[][] = [[], []]
  const pool: Figure[] = []
  let ghost: Ghost | undefined
  /** A carried hero just let go on a good spot, waiting for the formation to take it in. */
  let landing: { figure: Figure; timer: number } | undefined
  let hovered: Figure | undefined
  let disposed = false

  const entryKey = (hero: number) => state.loadout[hero]?.key ?? `missing:${hero}`
  function makeFigure(side: Team, key: string, hero: number): Figure {
    const entry = state.loadout[hero]
    const team = new THREE.Color(TEAM_COLORS[side])
    const scale = SIZE_SCALE[entry?.build.sizeClass ?? 'medium'] ?? 1
    const body = new THREE.Group()
    // facing the enemy, as the match starts them (engine yaw 0 for side 0, π for side 1)
    body.rotation.y = side === 0 ? 0 : Math.PI
    const mark = new THREE.Group()
    const disc = new THREE.Mesh(discGeo, overlayMaterial(team, 0.2))
    const ring = new THREE.Mesh(ringGeo, overlayMaterial(team, 0.92))
    const halo = new THREE.Mesh(haloGeo, overlayMaterial(GOLD, 0.95))
    halo.visible = false
    disc.renderOrder = ring.renderOrder = halo.renderOrder = 2
    mark.add(disc, ring, halo)
    mark.scale.setScalar(Math.max(1, scale) * RING_RADIUS)
    body.visible = mark.visible = false
    scene.add(body, mark)
    const badge = document.createElement('div')
    badge.className = `board-badge team-${side}`
    badge.hidden = true
    badge.innerHTML = '<b></b><span></span>'
    overlay.append(badge)
    const figure: Figure = {
      side,
      key,
      hero,
      x: 0,
      z: 0,
      at: { x: 0, z: 0 },
      held: false,
      body,
      mark,
      ring,
      disc,
      halo,
      scale,
      name: entry ? shortName(entry.build.heroName) : '?',
      badge,
      standee: { foot: screenPoint(), top: screenPoint() },
      lift: 0,
      liftTo: 0,
      grow: 1,
      dropAt: 0,
      anim: { kind: 'idle' },
      animUntil: 0,
      phase: 0.25 + (hashOf(`${key}|${side}`) % 1000) / 700,
    }
    ;(badge.lastChild as HTMLElement).textContent = figure.name
    if (entry) {
      void loadHeroView(entry.build, entry.pkg, hero, false, renderer, side).then((v) => {
        if (disposed) return
        figure.view = v
        body.add(v.root)
        v.root.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = true
        })
        v.pose(figure.anim, figure.phase, figure.phase, false)
        kick()
      })
    }
    return figure
  }

  const showFigure = (f: Figure, on: boolean) => {
    f.body.visible = f.mark.visible = on
    f.badge.hidden = !on
  }
  /** A figure for this side and hero: one put away earlier if there is one (already loaded), else a new one. */
  function acquire(side: Team, hero: number): Figure {
    const key = entryKey(hero)
    const i = pool.findIndex((f) => f.side === side && f.key === key)
    const f = i >= 0 ? pool.splice(i, 1)[0] : makeFigure(side, key, hero)
    f.hero = hero
    f.held = false
    f.lift = f.liftTo = 0
    f.grow = 1
    f.dropAt = 0
    // one put away mid-hover settles back into its idle
    f.anim = { kind: 'idle' }
    f.animUntil = f.view ? performance.now() + 400 : 0
    return f
  }
  /** Put a figure away, out of sight, ready for the same hero on the same side again. */
  function release(f: Figure) {
    showFigure(f, false)
    f.held = false
    f.animUntil = 0
    f.halo.visible = false
    if (hovered === f) hovered = undefined
    pool.push(f)
  }

  /** Keep the figures in step with the formation: the same hero on the same spot keeps its figure; new ones drop in. */
  function reconcile() {
    const next: (Slot & { index: number; hero: number })[] = []
    for (const s of [0, 1] as const) state.formation[s].forEach((p, index) => next.push({ side: s, key: entryKey(p.hero), x: p.x, z: p.z, index, hero: p.hero }))
    const current = [...placed[0], ...placed[1]]
    const assign = matchSlots(
      current.map((f) => ({ side: f.side, key: f.key, x: f.x, z: f.z })),
      next,
    )
    const kept = new Set<number>()
    const fresh: Figure[][] = [[], []]
    const now = performance.now()
    let arriving = 0
    next.forEach((n, i) => {
      let f: Figure
      if (assign[i] >= 0) {
        f = current[assign[i]]
        kept.add(assign[i])
      } else if (landing && landing.figure.side === n.side && landing.figure.key === n.key) {
        // the hero just let go here from the row: it is already standing on its spot
        f = landing.figure
        clearTimeout(landing.timer)
        landing = undefined
        f.hero = n.hero
        f.at = { x: n.x, z: n.z }
      } else {
        f = acquire(n.side, n.hero)
        f.at = { x: n.x, z: n.z }
        f.dropAt = reduced ? 0 : now + arriving++ * 28
      }
      f.x = n.x
      f.z = n.z
      f.hero = n.hero
      showFigure(f, true)
      fresh[n.side][n.index] = f
    })
    current.forEach((f, j) => !kept.has(j) && !fresh.some((side) => side.includes(f)) && release(f))
    placed = fresh
    // a drag whose hero left the board (cleared, redeployed) ends with it
    if (gesture.kind === 'drag' || gesture.kind === 'press') {
      const g = gesture
      if (placed[g.side][g.index] !== g.figure) cancelGesture()
    }
    placed.forEach((list, s) =>
      list.forEach((f, i) => {
        const n = (i + 1) % 10
        const key = f.badge.firstChild as HTMLElement
        if (key.textContent !== String(n)) key.textContent = String(n)
        const selected = state.selected?.side === s && state.selected.index === i
        f.halo.visible = selected
        f.badge.className = `board-badge team-${s}${s === state.side ? ' mine' : ''}${selected ? ' selected' : ''}${hovered === f ? ' hover' : ''}`
        styleRing(f)
      }),
    )
  }

  function styleRing(f: Figure) {
    const lit = hovered === f || f.held
    f.ring.material.color.setHex(TEAM_COLORS[f.side])
    if (lit) f.ring.material.color.lerp(WHITE, 0.4)
    f.ring.material.opacity = f.held ? 0.35 : 0.92
    f.disc.material.opacity = f.held ? 0.08 : lit ? 0.32 : 0.2
  }

  function setHover(f: Figure | undefined) {
    if (f === hovered) return
    const before = hovered
    hovered = f
    for (const g of [before, f]) {
      if (!g) continue
      styleRing(g)
      g.badge.classList.toggle('hover', g === f)
    }
    kick()
  }

  // ── the hero a click or a drag from the row would place ──
  function startGhost(hero: number, source: Ghost['source']) {
    endGhost()
    const f = acquire(state.editing, hero)
    f.held = true
    f.liftTo = LIFT
    f.lift = reduced ? LIFT : 0
    // it blends into its hover and holds it: frames are drawn as the pointer moves, not while it rests
    f.anim = { kind: 'fly' }
    f.animUntil = performance.now() + 500
    ghost = { figure: f, hero, side: state.editing, source }
    emphasise()
  }
  function endGhost() {
    if (!ghost) return
    release(ghost.figure)
    ghost = undefined
    marker.visible = false
    label.hidden = true
    emphasise()
  }
  /** Move the ghost to the spot under the pointer; false when the pointer is not over the board. */
  function moveGhost(clientX: number, clientY: number): boolean {
    if (!ghost) return false
    const rect = canvas.getBoundingClientRect()
    const inside = insideBox(clientX, clientY, rect)
    const at = inside ? floorAt(clientX, clientY, rect) : undefined
    const g = ghost
    g.at = at
    g.verdict = at || inside ? judge(state.formation, { side: g.side, hero: g.hero }, at) : undefined
    const f = g.figure
    if (at) {
      f.at = { ...at }
      f.x = at.x
      f.z = at.z
      showFigure(f, true)
      f.mark.visible = false
      f.badge.hidden = true
    } else showFigure(f, false)
    showMarker(at, g.verdict, f.scale)
    const name = state.loadout[g.hero] ? shortName(state.loadout[g.hero].build.heroName) : 'this hero'
    if (inside && g.verdict) showLabel(clientX, clientY, g.verdict.kind === 'ok' ? `Place ${name}` : g.verdict.kind === 'bad' ? reasonText(g.verdict.reason, g.side, state.side) : undefined, g.verdict.kind)
    else label.hidden = true
    kick()
    return inside
  }
  /** The ghost was let go on a good spot: it stays there until the formation takes it in (or briefly, if it does not). */
  function land(at: FloorPoint): void {
    if (!ghost) return
    const f = ghost.figure
    ghost = undefined
    marker.visible = false
    label.hidden = true
    if (landing) {
      clearTimeout(landing.timer)
      release(landing.figure)
    }
    f.x = at.x
    f.z = at.z
    f.at = { ...at }
    f.held = false
    f.liftTo = 0
    f.anim = { kind: 'idle' }
    f.animUntil = performance.now() + 450
    f.mark.visible = true
    landing = { figure: f, timer: window.setTimeout(() => landing?.figure === f && (release(f), (landing = undefined), kick()), 600) }
    emphasise()
  }

  // ── pointer: pick, drag, orbit, pan, zoom ──
  let gesture: Gesture = { kind: 'none' }
  const placedList = () => [...placed[0], ...placed[1]]
  const pickAt = (px: number, py: number) => {
    const list = placedList()
    const i = pick(
      list.map((f) => (f.held || !f.body.visible ? undefined : f.standee)),
      px,
      py,
    )
    return i === undefined ? undefined : list[i]
  }
  const indexOf = (f: Figure) => {
    const side = f.side
    return { side, index: placed[side].indexOf(f) }
  }
  const setCursor = (c: string) => {
    if (canvas.style.cursor !== c) canvas.style.cursor = c
  }

  function startDrag(g: Extract<Gesture, { kind: 'press' }>) {
    const f = g.figure
    f.held = true
    f.liftTo = LIFT
    f.anim = { kind: 'fly' }
    f.animUntil = performance.now() + 500
    styleRing(f)
    gesture = { kind: 'drag', figure: f, side: g.side, index: g.index, id: g.id, verdict: { kind: 'ok' } }
    setHover(undefined)
    setCursor('grabbing')
    handlers().dragging(true)
    emphasise()
  }
  function moveDrag(clientX: number, clientY: number) {
    if (gesture.kind !== 'drag') return
    const g = gesture
    const rect = canvas.getBoundingClientRect()
    const inside = insideBox(clientX, clientY, rect)
    const at = inside ? floorAt(clientX, clientY, rect) : undefined
    g.at = at
    g.verdict = judge(state.formation, { side: g.side, hero: g.figure.hero, index: g.index }, at)
    if (at) g.figure.at = { ...at }
    showMarker(at, g.verdict, g.figure.scale)
    const name = g.figure.name
    showLabel(clientX, clientY, g.verdict.kind === 'ok' ? `Move ${name} here` : g.verdict.kind === 'remove' ? `Let go to send ${name} back to the row` : reasonText(g.verdict.reason, g.side, state.side), g.verdict.kind)
    kick()
  }
  function settleFigure(f: Figure) {
    f.held = false
    f.liftTo = 0
    f.anim = { kind: 'idle' }
    f.animUntil = performance.now() + 450
    styleRing(f)
  }
  function endDrag() {
    if (gesture.kind !== 'drag') return
    const { figure: f, side, index, at, verdict } = gesture
    gesture = { kind: 'none' }
    marker.visible = false
    label.hidden = true
    settleFigure(f)
    handlers().dragging(false)
    emphasise()
    if (verdict.kind === 'remove') {
      showFigure(f, false)
      handlers().remove(side, index)
    } else if (at) {
      // a good spot is taken at once; a refused one slides back while the caller says why
      if (verdict.kind === 'ok') {
        f.x = at.x
        f.z = at.z
      }
      handlers().move(side, index, at.x, at.z)
    }
    kick()
  }
  function cancelGesture() {
    if (gesture.kind === 'drag') {
      settleFigure(gesture.figure)
      marker.visible = false
      label.hidden = true
      handlers().dragging(false)
    }
    gesture = { kind: 'none' }
    emphasise()
    kick()
  }

  const capture = (id: number) => {
    try {
      canvas.setPointerCapture(id)
    } catch {
      // a synthetic pointer has nothing to capture
    }
  }
  const onDown = (e: PointerEvent) => {
    if (gesture.kind !== 'none' || ghost?.source === 'carry') return
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    if (e.button === 2 || (e.button === 0 && (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey))) {
      gesture = { kind: 'orbit', x: e.clientX, y: e.clientY, id: e.pointerId }
      setCursor('move')
    } else if (e.button === 1) {
      gesture = { kind: 'pan', x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, id: e.pointerId, tap: false }
      setCursor('grabbing')
    } else if (e.button === 0) {
      const f = pickAt(px, py)
      if (f) {
        const { side, index } = indexOf(f)
        // a hero on the board is taken in hand: the picked one waiting to be placed steps aside
        if (ghost?.source === 'brush') endGhost()
        gesture = { kind: 'press', figure: f, side, index, x0: e.clientX, y0: e.clientY, id: e.pointerId }
        handlers().select({ side, index })
        setCursor('grabbing')
      } else gesture = { kind: 'pan', x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, id: e.pointerId, tap: true }
    } else return
    capture(e.pointerId)
    e.preventDefault()
  }
  const onMove = (e: PointerEvent) => {
    const g = gesture
    if (g.kind !== 'none' && 'id' in g && g.id !== e.pointerId) return
    if (g.kind === 'orbit') {
      setGoal(orbit(goal, e.clientX - g.x, e.clientY - g.y, limits))
      g.x = e.clientX
      g.y = e.clientY
      return
    }
    if (g.kind === 'pan') {
      if (g.tap && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 5) g.tap = false
      if (!g.tap) {
        const rect = canvas.getBoundingClientRect()
        const a = floorAt(g.x, g.y, rect)
        const b = floorAt(e.clientX, e.clientY, rect)
        if (a && b) setGoal(pan(goal, a.x - b.x, a.z - b.z, limits))
        setCursor('grabbing')
      }
      g.x = e.clientX
      g.y = e.clientY
      return
    }
    if (g.kind === 'press') {
      if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < 4) return
      startDrag(g)
    }
    if (gesture.kind === 'drag') return moveDrag(e.clientX, e.clientY)
    if (ghost?.source === 'carry') return
    // nothing in the hand: light up the hero under the pointer, or show where the picked hero would go
    const rect = canvas.getBoundingClientRect()
    const f = pickAt(e.clientX - rect.left, e.clientY - rect.top)
    setHover(f)
    if (state.brush !== undefined && !f) {
      if (!ghost || ghost.hero !== state.brush || ghost.side !== state.editing) startGhost(state.brush, 'brush')
      moveGhost(e.clientX, e.clientY)
      setCursor(ghost?.verdict?.kind === 'ok' ? 'copy' : 'not-allowed')
    } else {
      if (ghost?.source === 'brush') endGhost()
      setCursor(f ? 'grab' : 'default')
    }
  }
  const onUp = (e: PointerEvent) => {
    const g = gesture
    if (g.kind === 'none' || g.id !== e.pointerId) return
    try {
      canvas.releasePointerCapture(e.pointerId)
    } catch {
      // already released
    }
    if (g.kind === 'drag') return void (endDrag(), setCursor('grab'))
    gesture = { kind: 'none' }
    setCursor('default')
    if (g.kind !== 'pan' || !g.tap) return
    // a click on the floor: places the picked hero there, or lets go of the selection
    if (state.brush !== undefined) {
      const rect = canvas.getBoundingClientRect()
      const at = floorAt(e.clientX, e.clientY, rect)
      if (!at) return
      const good = judge(state.formation, { side: state.editing, hero: state.brush }, at).kind === 'ok'
      if (good && ghost) land(at)
      handlers().place(state.brush, at.x, at.z)
    } else handlers().select(undefined)
  }
  const onCancel = (e: PointerEvent) => {
    const g = gesture
    if (g.kind !== 'none' && g.id === e.pointerId) cancelGesture()
  }
  const onLeave = () => {
    if (gesture.kind !== 'none') return
    setHover(undefined)
    if (ghost?.source === 'brush') endGhost()
  }
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const rect = canvas.getBoundingClientRect()
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
    setGoal(zoom(goal, dy, floorAt(e.clientX, e.clientY, rect), limits))
  }
  const onContext = (e: Event) => e.preventDefault()
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && gesture.kind === 'drag') cancelGesture()
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onCancel)
  canvas.addEventListener('pointerleave', onLeave)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('contextmenu', onContext)
  window.addEventListener('keydown', onKey)

  // ── drawing, only while something changes ──
  let raf = 0
  let last = 0
  /** Frames drawn so far (the dev handle reads it to check that an idle board draws nothing). */
  let frames = 0
  function kick() {
    if (!raf && !disposed) raf = requestAnimationFrame(frame)
  }
  const glide = (f: Figure, dt: number, now: number): boolean => {
    let busy = false
    // position: in the hand it follows the pointer exactly; let go, it eases to its spot
    if (!f.held) {
      const dx = f.x - f.at.x
      const dz = f.z - f.at.z
      if (Math.abs(dx) + Math.abs(dz) > 0.01) {
        const k = reduced ? 1 : 1 - Math.exp(-dt * 18)
        f.at.x += dx * k
        f.at.z += dz * k
        busy = true
      } else {
        f.at.x = f.x
        f.at.z = f.z
      }
    }
    if (Math.abs(f.liftTo - f.lift) > 0.005) {
      f.lift += (f.liftTo - f.lift) * (reduced ? 1 : 1 - Math.exp(-dt * 16))
      busy = true
    } else f.lift = f.liftTo
    const grow = f.held ? HELD_SCALE : 1
    if (Math.abs(grow - f.grow) > 0.003) {
      f.grow += (grow - f.grow) * (reduced ? 1 : 1 - Math.exp(-dt * 16))
      busy = true
    } else f.grow = grow
    let drop = 0
    let pop = 1
    if (f.dropAt) {
      const t = Math.min(1, Math.max(0, (now - f.dropAt) / 300))
      drop = (1 - easeOut(t)) * 2.2
      pop = 0.35 + 0.65 * easeOut(t)
      if (t >= 1) f.dropAt = 0
      busy = true
    }
    f.body.position.set(f.at.x, f.lift + drop, f.at.z)
    f.body.scale.setScalar(f.grow)
    f.mark.position.set(f.held ? f.x : f.at.x, 0.05, f.held ? f.z : f.at.z)
    f.mark.scale.setScalar(Math.max(1, f.scale) * RING_RADIUS * pop * (hovered === f ? 1.12 : 1))
    if (f.view && now < f.animUntil) {
      f.view.pose(f.anim, now / 1000, dt, false)
      busy = true
    }
    return busy
  }
  function layoutBadges() {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    for (const list of placed)
      for (const f of list) {
        const height = ENGINE.capsule.height * f.scale * f.grow + 0.3
        toScreen(camera, f.at.x, 0, f.at.z, w, h, f.standee.foot)
        toScreen(camera, f.at.x, f.lift + height, f.at.z, w, h, f.standee.top)
        const show = f.body.visible && f.standee.top.visible
        if (f.badge.hidden === show) f.badge.hidden = !show
        if (!show) continue
        // badges follow the zoom: small over the whole arena, so one rank's badges leave the next rank's heroes in
        // sight; larger close up; never small while hovered or selected, when the name shows beside it
        const perMetre = (f.standee.foot.y - f.standee.top.y) / height
        let k = Math.min(1.35, Math.max(0.78, perMetre / 7))
        if (hovered === f || f.halo.visible) k = Math.max(1, k)
        f.badge.style.transform = `translate3d(${f.standee.top.x.toFixed(1)}px, ${f.standee.top.y.toFixed(1)}px, 0) scale(${k.toFixed(3)})`
        f.badge.style.zIndex = String(Math.round(f.standee.foot.y) + (f.held ? 5000 : 0))
      }
  }
  function frame(now: number) {
    raf = 0
    if (disposed) return
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60
    let busy = false
    if (!sameView(view, goal)) {
      view = reduced ? goal : approach(view, goal, 1 - Math.exp(-dt * 14))
      busy = true
    } else view = goal
    applyView(camera, view)
    for (const list of placed) for (const f of list) busy = glide(f, dt, now) || busy
    if (ghost) busy = glide(ghost.figure, dt, now) || busy
    if (landing) busy = glide(landing.figure, dt, now) || busy
    if (pipeline) pipeline.render()
    else renderer.render(scene, camera)
    frames++
    layoutBadges()
    if (busy) {
      last = now
      kick()
    } else last = 0
  }

  const resize = () => {
    const w = Math.max(1, host.clientWidth)
    const h = Math.max(1, host.clientHeight)
    renderer.setSize(w, h, false)
    camera.aspect = probe.aspect = w / h
    camera.updateProjectionMatrix()
    probe.updateProjectionMatrix()
    const wasHome = atHome
    home = homeView(state.side, camera.aspect)
    limits = limitsFor(home)
    if (wasHome) view = goal = home
    else {
      goal = clampView(goal, limits)
      view = clampView(view, limits)
    }
    kick()
  }
  const sizer = new ResizeObserver(resize)
  sizer.observe(host)
  resize()

  // painted textures arrive after the first frame: draw again as each lands (for a while, then stop asking)
  const textures = new Set<THREE.Texture>()
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) for (const v of Object.values(mat)) if (v instanceof THREE.Texture) textures.add(v)
  })
  let waiting = [...textures].filter((t) => !t.image).length
  const started = performance.now()
  const textureWatch = window.setInterval(() => {
    const now = [...textures].filter((t) => !t.image).length
    if (now !== waiting) {
      waiting = now
      kick()
    }
    if (!now || performance.now() - started > 20_000) window.clearInterval(textureWatch)
  }, 200)

  // compile every material up front, so the first frames do not stall (as the match does)
  await (renderer as unknown as { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<void> }).compileAsync?.(scene, camera)
  emphasise()
  reconcile()
  kick()

  // a dev-only handle for checking the board from a script, like the match's (never in production)
  const debug = import.meta.env.DEV ? (window as unknown as { __board?: unknown }) : undefined
  if (debug)
    debug.__board = {
      /** Where a floor point is on screen, in client pixels, as the camera settles. */
      screen: (x: number, z: number, y = 0) => {
        const rect = canvas.getBoundingClientRect()
        applyView(probe, goal)
        const p = toScreen(probe, x, y, z, rect.width, rect.height)
        return { x: rect.left + p.x, y: rect.top + p.y, visible: p.visible }
      },
      view: () => ({ ...goal, home: atHome }),
      frames: () => frames,
      placed: () => placed.map((list) => list.map((f) => ({ name: f.name, x: f.x, z: f.z, loaded: !!f.view }))),
    }

  let disposing: Promise<void> | undefined
  return {
    update(next) {
      if (disposed) return
      const sideChanged = next.side !== state.side
      const brushChanged = next.brush !== state.brush || next.editing !== state.editing
      state = next
      if (sideChanged) {
        zones.forEach((z, s) => {
          z.zone.material.map?.dispose()
          z.zone.material.map = zoneTexture(s as Team, state.side)
          z.zone.material.needsUpdate = true
        })
        home = homeView(state.side, camera.aspect)
        limits = limitsFor(home)
        view = goal = home
      }
      if (brushChanged && ghost?.source === 'brush') endGhost()
      reconcile()
      emphasise()
      kick()
    },
    carry(hero, clientX, clientY) {
      if (disposed) return false
      if (gesture.kind !== 'none') cancelGesture()
      if (!ghost || ghost.source !== 'carry' || ghost.hero !== hero || ghost.side !== state.editing) startGhost(hero, 'carry')
      setHover(undefined)
      return moveGhost(clientX, clientY)
    },
    drop(clientX, clientY) {
      if (disposed || ghost?.source !== 'carry') return undefined
      const rect = canvas.getBoundingClientRect()
      const at = insideBox(clientX, clientY, rect) ? floorAt(clientX, clientY, rect) : undefined
      if (at && judge(state.formation, { side: ghost.side, hero: ghost.hero }, at).kind === 'ok') land(at)
      else endGhost()
      kick()
      return at
    },
    cancelCarry() {
      if (ghost?.source === 'carry') endGhost()
      kick()
    },
    resetView() {
      setGoal(home)
    },
    dispose() {
      disposing ??= (async () => {
        disposed = true
        if (debug?.__board) delete debug.__board
        cancelAnimationFrame(raf)
        window.clearInterval(textureWatch)
        if (landing) clearTimeout(landing.timer)
        sizer.disconnect()
        canvas.removeEventListener('pointerdown', onDown)
        canvas.removeEventListener('pointermove', onMove)
        canvas.removeEventListener('pointerup', onUp)
        canvas.removeEventListener('pointercancel', onCancel)
        canvas.removeEventListener('pointerleave', onLeave)
        canvas.removeEventListener('wheel', onWheel)
        canvas.removeEventListener('contextmenu', onContext)
        window.removeEventListener('keydown', onKey)
        // everything this board made: its geometry, materials and textures (the match builds its own)
        const geometries = new Set<THREE.BufferGeometry>()
        const materials = new Set<THREE.Material>()
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (!mesh.isMesh) return
          geometries.add(mesh.geometry)
          for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m)
        })
        for (const m of materials) for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v)
        if (scene.environment) textures.add(scene.environment)
        pipeline?.dispose()
        geometries.forEach((g) => g.dispose())
        materials.forEach((m) => m.dispose())
        textures.forEach((t) => t.dispose())
        try {
          await renderer.dispose()
        } finally {
          canvas.remove()
          overlay.remove()
        }
      })()
      return disposing
    },
  }
}
