import { Vector3, type PerspectiveCamera } from 'three'

/**
 * World to screen for the HUD's per-frame layer (overhead bars, damage numbers, the aim target). Everything here
 * writes into caller-owned objects so a frame allocates nothing.
 */

export interface ScreenPoint {
  /** Pixels from the layer's left and top edges. */
  x: number
  y: number
  /** Metres in front of the camera, along its view axis. */
  depth: number
  /** In front of the camera and inside the screen, give or take `margin`. */
  visible: boolean
}

export const screenPoint = (): ScreenPoint => ({ x: 0, y: 0, depth: 0, visible: false })

type Projector = Pick<PerspectiveCamera, 'matrixWorldInverse' | 'projectionMatrix' | 'near'>

const v = new Vector3()

/**
 * Project a world point. Behind the camera (or nearer than its near plane) and outside the screen by more than
 * `margin` (a share of the half-screen) both count as not visible. Call `camera.updateMatrixWorld()` first if the
 * camera moved this frame.
 */
export function project(camera: Projector, x: number, y: number, z: number, width: number, height: number, out: ScreenPoint, margin = 0.08): ScreenPoint {
  v.set(x, y, z).applyMatrix4(camera.matrixWorldInverse)
  out.depth = -v.z
  if (out.depth <= camera.near) {
    out.visible = false
    return out
  }
  v.applyMatrix4(camera.projectionMatrix)
  out.x = (v.x + 1) * 0.5 * width
  out.y = (1 - v.y) * 0.5 * height
  out.visible = Math.abs(v.x) <= 1 + margin && Math.abs(v.y) <= 1 + margin
  return out
}

/** Overhead bars shrink with distance but stay readable: full size inside 18 m, never under 62%. */
export const distanceScale = (depth: number) => Math.max(0.62, Math.min(1.05, 18 / Math.max(1, depth)))

/** Past this many metres the overhead drops its name and keeps the bar. */
export const FAR_METRES = 34

/**
 * The visible point nearest the screen centre within `radius` (a share of the screen width), among `ids`.
 * Used for the target frame: what the crosshair is on, or nearly on.
 */
export function nearestToCentre(points: readonly ScreenPoint[], ids: Iterable<number>, width: number, height: number, radius = 0.15): number | undefined {
  const cx = width / 2
  const cy = height / 2
  let best: number | undefined
  let bestD = (radius * width) ** 2
  for (const i of ids) {
    const p = points[i]
    if (!p?.visible) continue
    const d = (p.x - cx) ** 2 + (p.y - cy) ** 2
    if (d <= bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/**
 * The target the crosshair holds: the nearest to centre, except the current one keeps the lock while it stays near
 * and visible unless another is clearly closer, so two enemies side by side do not make the frame flicker.
 */
export function stickyTarget(points: readonly ScreenPoint[], ids: Iterable<number>, current: number | undefined, width: number, height: number, radius = 0.15): number | undefined {
  const best = nearestToCentre(points, ids, width, height, radius)
  const held = current === undefined ? undefined : points[current]
  if (best === current || !held?.visible) return best
  const d = (p: ScreenPoint) => (p.x - width / 2) ** 2 + (p.y - height / 2) ** 2
  const keep = d(held) <= (radius * 1.25 * width) ** 2
  if (!keep) return best
  if (best === undefined) return current
  return d(points[best]) < d(held) * 0.6 ? best : current
}

/**
 * How high over a hero's feet its overhead sits: above the hitbox and above the small team marker the stage draws
 * at 2.3 m times the model's scale.
 */
export const overheadLift = (hitboxHeight: number, modelScale: number) => Math.max(hitboxHeight + 0.45, modelScale * 2.3 + 0.3)
