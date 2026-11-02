import { Quaternion, Vector3 } from 'three'
import { clampToLimits, limitExcess } from '../rig/limits.js'

/**
 * What the clip baker (scripts/rpm-anim.ts) does to a clip once it is on our rig (GAME.md §12): it stands the feet flat
 * where they are planted, tags the clip for the engine (where the feet plant, when a blow lands and a shot leaves the
 * hand, how far the clip carried the hips before it was baked in place, whether it loops) and mirrors the directional
 * ones, and holds a noisy source's clips to the joint limits. Renderer-free; works on the baked frames (each keyed bone's local rotation, the hips' position) and the body
 * they were fitted to.
 */

/** A skeleton at rest: every node's name, parent (-1 for none), offset from its parent and local rotation. */
export interface Skel {
  names: string[]
  parent: number[]
  t: Vector3[]
  r: Quaternion[]
}

/** A baked clip: per frame, per keyed bone, its local rotation (x y z w), and per frame the hips' position. */
export interface Frames {
  frames: number
  rot: Float32Array
  pos: Float32Array
}

/** Our body posed by a clip, frame by frame: every node's rotation and position in the scene. */
export interface Posed {
  world: Quaternion[][]
  at: Vector3[][]
}

/** The skeleton node each keyed bone drives (`keyed` lists them in the clip's order; the hips first). */
export function pose(skel: Skel, keyed: readonly number[], clip: Frames, from = 0, to = clip.frames): Posed {
  const slot = new Map(keyed.map((n, k) => [n, k]))
  const width = keyed.length
  const world: Quaternion[][] = []
  const at: Vector3[][] = []
  const hips = keyed[0]
  for (let f = from; f < to; f++) {
    const w: Quaternion[] = []
    const p: Vector3[] = []
    const rotOf = (i: number): Quaternion => {
      if (w[i]) return w[i]
      const k = slot.get(i)
      // stored rotations are rounded, so they come back a little off unit length
      const local = k === undefined ? skel.r[i] : new Quaternion().fromArray(clip.rot, (f * width + k) * 4).normalize()
      return (w[i] = skel.parent[i] < 0 ? local.clone() : rotOf(skel.parent[i]).clone().multiply(local))
    }
    const posOf = (i: number): Vector3 => {
      if (p[i]) return p[i]
      if (i === hips) return (p[i] = new Vector3().fromArray(clip.pos, f * 3))
      const parent = skel.parent[i]
      return (p[i] = parent < 0 ? skel.t[i].clone() : skel.t[i].clone().applyQuaternion(rotOf(parent)).add(posOf(parent)))
    }
    skel.names.forEach((_, i) => (rotOf(i), posOf(i)))
    world.push(w)
    at.push(p)
  }
  return { world, at }
}

/** The skeleton at rest, posed the same way (its nodes' rotations and positions in the scene). */
export function restOf(skel: Skel): { world: Quaternion[]; at: Vector3[] } {
  const world: Quaternion[] = []
  const at: Vector3[] = []
  const rotOf = (i: number): Quaternion => world[i] ?? (world[i] = skel.parent[i] < 0 ? skel.r[i].clone() : rotOf(skel.parent[i]).clone().multiply(skel.r[i]))
  const posOf = (i: number): Vector3 => at[i] ?? (at[i] = skel.parent[i] < 0 ? skel.t[i].clone() : skel.t[i].clone().applyQuaternion(rotOf(skel.parent[i])).add(posOf(skel.parent[i])))
  skel.names.forEach((_, i) => (rotOf(i), posOf(i)))
  return { world, at }
}

const SIDES = ['Left', 'Right'] as const
const find = (skel: Skel, name: string) => {
  const i = skel.names.indexOf(name)
  if (i < 0) throw new Error(`no bone ${name}`)
  return i
}

/** A foot counts as down while its heel is within this of its height at rest (metres), and fully down within LEVEL_FIRM. */
const LEVEL_FIRM = 0.02
const LEVEL_SOFT = 0.06

/**
 * Each foot turned flat where it stands on its heel (GAME.md §12 rest alignment). A source's foot points as its
 * performer's did, and with the knees bent most stances pitch it toe-down against our longer foot: the ball sank 2 to 5
 * cm into the floor on every body (the physique bench's ground score). Where the heel is down, the foot turns about
 * its heel until the ball sits as high above the heel as at rest, fully with the heel within 2 cm of its rest height
 * and not at all from 6 cm up (a heel lifting off its toes is left as it is). The toes keep their turn in the foot.
 * Rewrites `clip.rot` in place; returns the most it turned a foot, in degrees.
 */
export function levelPlantedFeet(skel: Skel, keyed: readonly number[], clip: Frames): number {
  const rest = restOf(skel)
  const slot = new Map(keyed.map((n, k) => [n, k]))
  const width = keyed.length
  let most = 0
  const q = new Quaternion()
  const v = new Vector3()
  const want = new Vector3()
  for (const side of SIDES) {
    const foot = find(skel, `${side}Foot`)
    const ball = find(skel, `${side}ToeBase`)
    const k = slot.get(foot)
    if (k === undefined) continue
    const restRise = rest.at[ball].y - rest.at[foot].y
    const restHeel = rest.at[foot].y
    let prev: Quaternion | undefined
    for (let f = 0; f < clip.frames; f++) {
      const { world, at } = pose(skel, keyed, clip, f, f + 1)
      const heel = at[0][foot].y - restHeel
      const down = Math.min(1, Math.max(0, 1 - (heel - LEVEL_FIRM) / (LEVEL_SOFT - LEVEL_FIRM)))
      v.copy(at[0][ball]).sub(at[0][foot])
      const sunk = restRise - v.y
      const local = q.fromArray(clip.rot, (f * width + k) * 4)
      if (down > 0 && sunk > 1e-4) {
        // the same reach from the heel, its rise back to the rest's by `down`
        const length = v.length()
        const rise = v.y + sunk * down
        const flat = Math.max(1e-6, Math.hypot(v.x, v.z))
        const across = Math.sqrt(Math.max(0, length * length - rise * rise))
        want.set((v.x / flat) * across, rise, (v.z / flat) * across).normalize()
        const turn = new Quaternion().setFromUnitVectors(v.normalize(), want)
        most = Math.max(most, (2 * Math.acos(Math.min(1, Math.abs(turn.w))) * 180) / Math.PI)
        const parent = world[0][skel.parent[foot]]
        local.copy(parent.clone().invert().multiply(turn).multiply(world[0][foot]))
      }
      if (prev && local.dot(prev) < 0) local.set(-local.x, -local.y, -local.z, -local.w)
      local.normalize().toArray(clip.rot, (f * width + k) * 4)
      prev = (prev ?? new Quaternion()).copy(local)
    }
  }
  return most
}

/** What the engine reads off a clip (GAME.md §12 tags). Times are seconds into the clip. */
export interface ClipTags {
  /** Its last frame leads back into its first. */
  loop: boolean
  /** When a hand or a foot moves fastest against the hips: where a blow lands. */
  contact: number
  /** When a hand moves fastest against the hips: where a shot or a cast leaves the hand. */
  release: number
  /** Per foot, the stretches where it stands still on the floor: [start, end] seconds. */
  plants: { left: [number, number][]; right: [number, number][] }
  /**
   * The travel the clip had before it was baked in place, metres on our body: x to the hero's left, z ahead (the engine
   * moves the hero this far over the clip), and how much higher the hips end than they began (a mantle's climb).
   */
  root: { x: number; z: number; rise: number }
}

/** A planted foot's ball stays within this of its rest height (metres) and moves slower than PLANT_SPEED over the ground. */
const PLANT_HEIGHT = 0.04
const PLANT_SPEED = 0.35
/** A loop's last frame is its first again within this, the mean over the keyed bones, in degrees. */
const LOOP_GAP = 6

/**
 * The tags of a baked clip. `drift` is the travel the baker took out to play it in place (metres on our body, x left and
 * z ahead), so a planted foot's speed over the ground is its speed in place plus the drift's.
 */
export function tagClip(skel: Skel, keyed: readonly number[], clip: Frames, fps: number, drift: { x: number; z: number }): ClipTags {
  const rest = restOf(skel)
  const { at } = pose(skel, keyed, clip)
  const n = clip.frames
  const seconds = Math.max(1e-6, (n - 1) / fps)
  const hips = keyed[0]
  // where it hits and lets go: the fastest frame of the hands (and feet) against the hips
  const ends = { hands: SIDES.map((s) => find(skel, `${s}Hand`)), feet: SIDES.map((s) => find(skel, `${s}Foot`)) }
  let contact = 0
  let release = 0
  let fastest = 0
  let fastestHand = 0
  const rel = (f: number, i: number) => at[f][i].clone().sub(at[f][hips])
  for (let f = 1; f < n; f++) {
    for (const i of [...ends.hands, ...ends.feet]) {
      const speed = rel(f, i).distanceTo(rel(f - 1, i))
      if (speed > fastest) (fastest = speed), (contact = f / fps)
      if (ends.hands.includes(i) && speed > fastestHand) (fastestHand = speed), (release = f / fps)
    }
  }
  // where each foot stands: its ball near the floor and still over the ground (the drift added back)
  const drifting = new Vector3(drift.x / seconds, 0, drift.z / seconds)
  const plants = { left: [] as [number, number][], right: [] as [number, number][] }
  SIDES.forEach((side) => {
    const ball = find(skel, `${side}ToeBase`)
    const heel = find(skel, `${side}Foot`)
    const list = plants[side === 'Left' ? 'left' : 'right']
    let start = -1
    for (let f = 0; f < n; f++) {
      const low = Math.min(at[f][ball].y - rest.at[ball].y, at[f][heel].y - rest.at[heel].y)
      const a = at[Math.max(0, f - 1)][ball]
      const b = at[Math.min(n - 1, f + 1)][ball]
      const span = (Math.min(n - 1, f + 1) - Math.max(0, f - 1)) / fps
      const speed = span > 0 ? new Vector3(b.x - a.x, 0, b.z - a.z).multiplyScalar(1 / span).add(drifting).length() : 0
      const down = low < PLANT_HEIGHT && speed < PLANT_SPEED
      if (down && start < 0) start = f
      if ((!down || f === n - 1) && start >= 0) {
        const end = down ? f : f - 1
        if (end - start >= 2) list.push([round(start / fps), round(end / fps)])
        start = -1
      }
    }
  })
  // a loop ends where it began
  let gap = 0
  const width = keyed.length
  const a = new Quaternion()
  const b = new Quaternion()
  for (let k = 0; k < width; k++) {
    a.fromArray(clip.rot, k * 4)
    b.fromArray(clip.rot, ((n - 1) * width + k) * 4)
    gap += (2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * 180) / Math.PI
  }
  const rise = clip.pos[(n - 1) * 3 + 1] - clip.pos[1]
  return {
    loop: n > 2 && gap / width < LOOP_GAP,
    contact: round(contact),
    release: round(release),
    plants,
    root: { x: round(drift.x), z: round(drift.z), rise: round(rise) },
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000

/**
 * A clip's name with its sides swapped (`hit_from_left` → `hit_from_right`, `left_strafe` → `right_strafe`), or
 * undefined when it names no side and so has no mirror under its own name.
 */
export function mirrorName(name: string): string | undefined {
  const parts = name.split('_')
  if (!parts.some((p) => p === 'left' || p === 'right')) return undefined
  return parts.map((p) => (p === 'left' ? 'right' : p === 'right' ? 'left' : p)).join('_')
}

/** The skeleton node of each bone's other side (itself for the middle). */
function sides(skel: Skel): number[] {
  return skel.names.map((n, i) => {
    const other = n.startsWith('Left') ? `Right${n.slice(4)}` : n.startsWith('Right') ? `Left${n.slice(5)}` : n
    const j = skel.names.indexOf(other)
    return j < 0 ? i : j
  })
}

/**
 * The clip performed by its mirror image across the body's middle (x → -x). Each bone takes the turn from rest its
 * other side made, reflected, in the scene: our rest is not quite symmetrical (the feet and hands differ by up to 22°),
 * so swapping local rotations would bend the wrists and ankles; turns from rest carry over cleanly. The hips' sway
 * mirrors about where they stand at rest.
 */
export function mirrorClip(skel: Skel, keyed: readonly number[], clip: Frames): Frames {
  const rest = restOf(skel)
  const other = sides(skel)
  const width = keyed.length
  const out: Frames = { frames: clip.frames, rot: new Float32Array(clip.rot.length), pos: new Float32Array(clip.pos.length) }
  const reflect = (q: Quaternion) => q.set(q.x, -q.y, -q.z, q.w)
  const midX = rest.at[keyed[0]].x
  for (let f = 0; f < clip.frames; f++) {
    const { world } = pose(skel, keyed, clip, f, f + 1)
    const mirrored: Quaternion[] = []
    const isKeyed = new Set(keyed)
    const worldOf = (i: number): Quaternion => {
      if (mirrored[i]) return mirrored[i]
      // a bone the clip doesn't key (a twist, an end) follows its parent at rest, as it will when the clip plays
      if (!isKeyed.has(i)) return (mirrored[i] = skel.parent[i] < 0 ? skel.r[i].clone() : worldOf(skel.parent[i]).clone().multiply(skel.r[i]))
      // the other side's turn from its rest, reflected, on this bone's rest
      const j = other[i]
      const turn = reflect(world[0][j].clone().multiply(rest.world[j].clone().invert()))
      return (mirrored[i] = turn.multiply(rest.world[i]))
    }
    keyed.forEach((i, k) => {
      const parent = skel.parent[i]
      const local = (parent < 0 ? worldOf(i).clone() : worldOf(parent).clone().invert().multiply(worldOf(i))).normalize()
      if (f) {
        const prev = new Quaternion().fromArray(out.rot, ((f - 1) * width + k) * 4)
        if (local.dot(prev) < 0) local.set(-local.x, -local.y, -local.z, -local.w)
      }
      local.toArray(out.rot, (f * width + k) * 4)
    })
    out.pos[f * 3] = 2 * midX - clip.pos[f * 3]
    out.pos[f * 3 + 1] = clip.pos[f * 3 + 1]
    out.pos[f * 3 + 2] = clip.pos[f * 3 + 2]
  }
  return out
}

/** A clip's tags for its mirror: the feet's plants swap and the sideways travel turns round. */
export const mirrorTags = (t: ClipTags): ClipTags => ({ ...t, plants: { left: t.plants.right, right: t.plants.left }, root: { ...t.root, x: -t.root.x } })

/** The furthest any keyed bone of the clip goes past its joint limit (GAME.md §9.2), in degrees (0 inside them all). */
export function limitWorst(skel: Skel, keyed: readonly number[], clip: Frames): number {
  const q = new Quaternion()
  let worst = 0
  for (let f = 0; f < clip.frames; f++)
    keyed.forEach((n, k) => {
      q.fromArray(clip.rot, (f * keyed.length + k) * 4).normalize()
      worst = Math.max(worst, limitExcess(skel.names[n], skel.r[n].clone().invert().multiply(q)))
    })
  return worst
}

/** The clip's every bone brought inside its joint limit, frame by frame; returns how many bone-frames moved. */
export function clampClip(skel: Skel, keyed: readonly number[], clip: Frames): number {
  const q = new Quaternion()
  let moved = 0
  keyed.forEach((n, k) => {
    const rest = skel.r[n]
    const restInverse = rest.clone().invert()
    for (let f = 0; f < clip.frames; f++) {
      const at = (f * keyed.length + k) * 4
      const delta = restInverse.clone().multiply(q.fromArray(clip.rot, at).normalize())
      // a tenth of a degree inside, so the stored (rounded) turn stays in
      if (!clampToLimits(skel.names[n], delta, 0.1)) continue
      rest.clone().multiply(delta).toArray(clip.rot, at)
      moved++
    }
  })
  return moved
}
