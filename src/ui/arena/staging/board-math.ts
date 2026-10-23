import { PerspectiveCamera, Vector3 } from 'three'
import { ENGINE } from '../../../arena/engine/calibration'
import type { Team } from '../../../arena/engine/state'
import { MAX_PER_SIDE, move, place, type Formation } from './formation'

/**
 * The 3D staging board's maths, free of the renderer and the DOM so it tests on its own: the camera that orbits a spot on
 * the floor and its limits, the framing that fits the whole arena, pointer to floor and floor to screen, which figure
 * is under the pointer, and what a spot means for the hero carried there.
 */

const { halfWidth: W, halfLength: L } = ENGINE.arena

/** A narrow lens: close to isometric, so the far half does not shrink away. */
export const BOARD_FOV = 32
/** The home view looks down at about 52 degrees. */
export const HOME_PITCH = 0.9
/** How far the camera leans toward the horizon when fully zoomed in, radians: close up, the heroes are seen from the side. */
export const ZOOM_LEAN = 0.25
/** The lowest the camera's line of sight goes, leaning included, radians above the floor. */
const MIN_ELEVATION = 0.4

export interface FloorPoint {
  x: number
  z: number
}

export interface View {
  /** Bearing around the target: 0 sits behind the near half (z < 0) looking toward +z, π behind the far half. */
  yaw: number
  /** Height of the camera above the floor as an angle: π/2 looks straight down. */
  pitch: number
  /** Metres from the target. */
  distance: number
  /** The spot on the floor the camera looks at. */
  target: FloorPoint
  /** Extra tilt toward the horizon as the camera closes in, radians; clampView sets it from the distance. */
  lean?: number
}

export interface Limits {
  home: View
  minDistance: number
  maxDistance: number
  /** How far the bearing may turn either way from home, radians. */
  yawRange: number
  pitch: readonly [number, number]
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** An angle folded into -π..π. */
export const wrapAngle = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI))

/** Each side's camera sits behind its own half, facing the enemy, the way the match's free camera starts. */
export const homeYaw = (side: Team) => (side === 0 ? 0 : Math.PI)

/** The angle the camera actually looks down at: its pitch, less the lean it takes when zoomed in. */
export const elevation = (view: View) => Math.max(MIN_ELEVATION, view.pitch - (view.lean ?? 0))

export function cameraPosition(view: View, out = new Vector3()): Vector3 {
  const pitch = elevation(view)
  const flat = Math.cos(pitch) * view.distance
  return out.set(view.target.x - Math.sin(view.yaw) * flat, Math.sin(pitch) * view.distance, view.target.z - Math.cos(view.yaw) * flat)
}

/** Put a camera where the view says and refresh its matrices, so projecting and unprojecting are right at once. */
export function applyView(camera: PerspectiveCamera, view: View) {
  cameraPosition(view, camera.position)
  camera.up.set(0, 1, 0)
  camera.lookAt(view.target.x, 0, view.target.z)
  camera.updateMatrixWorld()
}

const probe = new PerspectiveCamera()
const v = new Vector3()
/** The arena's floor and anything standing on it up to head height, which the home view must show whole. */
const ARENA_BOX = [-W, W].flatMap((x) => [-L, L].flatMap((z) => [0, 2.5].map((y) => new Vector3(x, y, z))))

const inFrame = (camera: PerspectiveCamera, p: Vector3, margin: number) => {
  v.copy(p).project(camera)
  return v.z > -1 && v.z < 1 && Math.abs(v.x) <= margin && Math.abs(v.y) <= margin
}

/** The nearest distance at which every corner of the arena sits inside the frame, `margin` of the way to its edges. */
export function fitDistance(view: View, aspect: number, fov = BOARD_FOV, margin = 0.94): number {
  probe.fov = fov
  probe.aspect = aspect
  probe.near = 0.5
  probe.far = 5000
  probe.updateProjectionMatrix()
  let lo = 5
  let hi = 2000
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    applyView(probe, { ...view, distance: mid })
    if (ARENA_BOX.every((p) => inFrame(probe, p, margin))) hi = mid
    else lo = mid
  }
  return hi
}

/** Where the arena's top and bottom edges land on screen, in normalised device coordinates. */
function verticalExtent(camera: PerspectiveCamera): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const p of ARENA_BOX) {
    v.copy(p).project(camera)
    lo = Math.min(lo, v.y)
    hi = Math.max(hi, v.y)
  }
  return [lo, hi]
}

/**
 * The view a side starts from: behind its own half, looking down across the whole arena, as close as fits. The near
 * half looks bigger through the lens, so the target slides along the line of sight until the arena sits in the middle of
 * the frame, as much space above it as below.
 */
export function homeView(side: Team, aspect: number, fov = BOARD_FOV, pitch = HOME_PITCH): View {
  const yaw = homeYaw(side)
  const at = (shift: number): View => {
    // `+ 0` keeps a -0 out of the target, so views compare equal after clamping
    const target = { x: Math.sin(yaw) * shift + 0, z: Math.cos(yaw) * shift + 0 }
    return { yaw, pitch, distance: fitDistance({ yaw, pitch, distance: 1, target }, aspect, fov), target }
  }
  probe.fov = fov
  probe.aspect = aspect
  probe.updateProjectionMatrix()
  // a target nearer the camera lifts the arena in the frame; bisect for the shift that centres it
  let lo: number = -L
  let hi: number = L
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    applyView(probe, at(mid))
    const [bottom, top] = verticalExtent(probe)
    if (bottom + top > 0) lo = mid
    else hi = mid
  }
  return at(Math.round(((lo + hi) / 2) * 100) / 100)
}

/** Close enough to read a hero's face, out to a little past the home framing; a gentle turn either way. */
export const limitsFor = (home: View): Limits => ({ home, minDistance: Math.min(20, home.distance * 0.5), maxDistance: home.distance * 1.18, yawRange: 0.8, pitch: [0.6, 1.45] })

/**
 * Keep a view inside its limits. Zoomed in, the target may wander toward the arena's edges and the camera leans toward
 * the horizon; at the home framing and beyond it comes back to the home target and angle, so the whole arena shows.
 */
export function clampView(view: View, lim: Limits): View {
  const distance = clamp(view.distance, lim.minDistance, lim.maxDistance)
  const yaw = lim.home.yaw + clamp(wrapAngle(view.yaw - lim.home.yaw), -lim.yawRange, lim.yawRange)
  const pitch = clamp(view.pitch, lim.pitch[0], lim.pitch[1])
  const freedom = clamp((lim.home.distance - distance) / Math.max(1e-6, lim.home.distance - lim.minDistance), 0, 1)
  const h = lim.home.target
  const target = { x: h.x + clamp(view.target.x - h.x, -W * freedom, W * freedom), z: h.z + clamp(view.target.z - h.z, -L * freedom, L * freedom) }
  return { yaw, pitch, distance, target, lean: ZOOM_LEAN * freedom }
}

/** Turn and tilt by a pointer drag in pixels: the arena follows the hand sideways, and dragging down looks more from above. */
export const orbit = (view: View, dx: number, dy: number, lim: Limits): View => clampView({ ...view, yaw: view.yaw - dx * 0.006, pitch: view.pitch + dy * 0.005 }, lim)

/**
 * Zoom by a wheel step. With a `focus` (the floor under the pointer) the view closes in on that spot, the way maps
 * zoom, rather than on the middle of the frame.
 */
export function zoom(view: View, deltaY: number, focus: FloorPoint | undefined, lim: Limits): View {
  const distance = clamp(view.distance * Math.exp(clamp(deltaY, -300, 300) * 0.0012), lim.minDistance, lim.maxDistance)
  const k = 1 - distance / view.distance
  const target = focus ? { x: view.target.x + (focus.x - view.target.x) * k, z: view.target.z + (focus.z - view.target.z) * k } : view.target
  return clampView({ ...view, distance, target }, lim)
}

/** Slide the view along the floor by metres. */
export const pan = (view: View, dx: number, dz: number, lim: Limits): View => clampView({ ...view, target: { x: view.target.x + dx, z: view.target.z + dz } }, lim)

/** Ease a view toward another; `k` is the share of the way to go this frame (0..1). Turns take the short way round. */
export function approach(from: View, to: View, k: number): View {
  const mix = (a: number, b: number) => a + (b - a) * k
  return {
    yaw: from.yaw + wrapAngle(to.yaw - from.yaw) * k,
    pitch: mix(from.pitch, to.pitch),
    distance: mix(from.distance, to.distance),
    target: { x: mix(from.target.x, to.target.x), z: mix(from.target.z, to.target.z) },
    lean: mix(from.lean ?? 0, to.lean ?? 0),
  }
}

/** Two views a pixel's worth apart or less. */
export const sameView = (a: View, b: View) =>
  Math.abs(wrapAngle(a.yaw - b.yaw)) < 1e-3 && Math.abs(a.pitch - b.pitch) < 1e-3 && Math.abs(a.distance - b.distance) < 0.02 * Math.max(1, a.distance / 50) && Math.abs(a.target.x - b.target.x) < 0.02 && Math.abs(a.target.z - b.target.z) < 0.02

/** A pointer position inside an element's box as normalised device coordinates (-1..1, y up). */
export const toNdc = (clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }) => ({
  x: ((clientX - box.left) / Math.max(1, box.width)) * 2 - 1,
  y: 1 - ((clientY - box.top) / Math.max(1, box.height)) * 2,
})

export const insideBox = (clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }) =>
  clientX >= box.left && clientX <= box.left + box.width && clientY >= box.top && clientY <= box.top + box.height

const origin = new Vector3()
const dir = new Vector3()
/**
 * The spot on the floor (y = 0) under a point of the screen, or undefined when the pointer is on the sky or so near the
 * horizon that the spot would be off the island.
 */
export function floorPoint(camera: PerspectiveCamera, ndcX: number, ndcY: number): FloorPoint | undefined {
  origin.setFromMatrixPosition(camera.matrixWorld)
  dir.set(ndcX, ndcY, 0.5).unproject(camera).sub(origin)
  if (dir.y > -1e-6) return undefined
  const t = -origin.y / dir.y
  const x = origin.x + dir.x * t
  const z = origin.z + dir.z * t
  return Math.abs(x) > 400 || Math.abs(z) > 400 ? undefined : { x, z }
}

export interface ScreenPoint {
  /** Pixels from the box's left and top edges. */
  x: number
  y: number
  /** In front of the camera and on screen, give or take a little. */
  visible: boolean
}

export const screenPoint = (): ScreenPoint => ({ x: 0, y: 0, visible: false })

/** A world point in pixels of a `width` by `height` box; call applyView (or updateMatrixWorld) first. */
export function toScreen(camera: PerspectiveCamera, x: number, y: number, z: number, width: number, height: number, out: ScreenPoint = screenPoint()): ScreenPoint {
  v.set(x, y, z).project(camera)
  out.x = ((v.x + 1) / 2) * width
  out.y = ((1 - v.y) / 2) * height
  out.visible = v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1.15 && Math.abs(v.y) <= 1.15
  return out
}

/** A placed hero on screen: the spot it stands on and the top of its key badge. */
export interface Standee {
  foot: ScreenPoint
  top: ScreenPoint
}

function distanceToSegment(px: number, py: number, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = dx * dx + dy * dy
  const t = len > 0 ? clamp(((px - a.x) * dx + (py - a.y) * dy) / len, 0, 1) : 0
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t))
}

/**
 * The figure under the pointer: the nearest, within `radius` pixels, to the line from its feet up to its badge, so a
 * hero only a few pixels tall from far away is still easy to grab. On a tie the one nearer the camera wins.
 */
export function pick(standees: readonly (Standee | undefined)[], x: number, y: number, radius = 16, body = 8): number | undefined {
  let nearest: number | undefined
  let nearestD = radius
  // where figures overlap, the one drawn in front (lower on screen) is the one under the pointer
  let front: number | undefined
  let frontY = -Infinity
  standees.forEach((s, i) => {
    if (!s?.foot.visible) return
    const d = distanceToSegment(x, y, s.foot, s.top)
    if (d < nearestD) {
      nearest = i
      nearestD = d
    }
    if (d <= body && s.foot.y > frontY) {
      front = i
      frontY = s.foot.y
    }
  })
  return front ?? nearest
}

/** Inside the arena's walls (not the deploy halves, which keep a metre clear of them). */
export const onArena = (x: number, z: number) => Math.abs(x) <= W && Math.abs(z) <= L

export type Reason = 'wrong-half' | 'full' | 'crowded' | 'in-ruins' | 'edge' | 'off-arena'

/** What letting go here would do with the carried hero. */
export type Verdict = { kind: 'ok' } | { kind: 'bad'; reason: Reason } | { kind: 'remove' }

/** A hero in the hand: from the row (no `index`) or already on the board (its place in its side's list). */
export interface Carried {
  side: Team
  hero: number
  index?: number
}

/** The formation's own reason, told apart a little more: a spot by the wall is not "the other half". */
export function refine(reason: 'wrong-half' | 'full' | 'crowded' | 'in-ruins', at: FloorPoint): Reason {
  if (reason !== 'wrong-half') return reason
  if (!onArena(at.x, at.z)) return 'off-arena'
  return Math.abs(at.x) > W - 1 || Math.abs(at.z) > L - 1 ? 'edge' : 'wrong-half'
}

/**
 * Judge a spot for the carried hero with the formation's own rules (place, move). A hero already on the board that is
 * let go off the arena goes back to the row.
 */
export function judge(f: Formation, c: Carried, at: FloorPoint | undefined): Verdict {
  if (!at || !onArena(at.x, at.z)) return c.index !== undefined ? { kind: 'remove' } : { kind: 'bad', reason: 'off-arena' }
  const r = c.index !== undefined ? move(f, c.side, c.index, at.x, at.z) : place(f, c.side, c.hero, at.x, at.z)
  return r.ok ? { kind: 'ok' } : { kind: 'bad', reason: refine(r.reason, at) }
}

/** The ghost's caption for a spot it cannot take. `yours` is the player's side. */
export function reasonText(reason: Reason, side: Team, yours: Team): string {
  switch (reason) {
    case 'wrong-half':
      return side === yours ? 'Not here: the enemy half' : 'Not here: your half'
    case 'in-ruins':
      return 'Not here: inside the ruins'
    case 'crowded':
      return 'Not here: too close to another hero'
    case 'edge':
      return 'Not here: too close to the wall'
    case 'off-arena':
      return 'Off the arena'
    case 'full':
      return `${side === yours ? 'Your' : 'The enemy'} side is full (${MAX_PER_SIDE} of ${MAX_PER_SIDE})`
  }
}

/** A placed hero as the board draws it: its side, which hero (the loadout entry's key) and where it stands. */
export interface Slot {
  side: Team
  key: string
  x: number
  z: number
}

/**
 * Which figure each placement keeps when the formation changes, so a hero that stayed or moved is not rebuilt: the same
 * hero on the same spot first, then the same hero nearest by (it moved). Returns, for each of `next`, the index of the
 * figure it keeps in `current`, or -1 for a new one.
 */
export function matchSlots(current: readonly Slot[], next: readonly Slot[]): number[] {
  const used = new Set<number>()
  const out = next.map(() => -1)
  next.forEach((n, i) => {
    const j = current.findIndex((c, j) => !used.has(j) && c.side === n.side && c.key === n.key && c.x === n.x && c.z === n.z)
    if (j < 0) return
    used.add(j)
    out[i] = j
  })
  next.forEach((n, i) => {
    if (out[i] >= 0) return
    let best = -1
    let bestD = Infinity
    current.forEach((c, j) => {
      if (used.has(j) || c.side !== n.side || c.key !== n.key) return
      const d = (c.x - n.x) ** 2 + (c.z - n.z) ** 2
      if (d < bestD) {
        bestD = d
        best = j
      }
    })
    if (best < 0) return
    used.add(best)
    out[i] = best
  })
  return out
}
