import { CARRY_SLOTS, SOCKET_BONE, type CarrySlot } from '../rig/metarig.js'
import { share, type Skeleton, type Skin, type Vec3 } from './regions.js'

/**
 * Where a stowed weapon sits on a body (GAME.md §4, "Where weapons are carried"), measured off the body's own skin so
 * every size, physique and generated mesh gets them the same way. Each slot's point is on the skin plus CLEARANCE, on
 * the bone it rides (metarig SOCKET_BONE). A carried piece is modelled like a held one (gear.ts): its +y runs toward
 * the grip, the end a hand reaches for, and its +z faces away from the body. Renderer-free; glTF axes (+z forward,
 * +x the hero's left, +y up), in the body's rest pose.
 */
export interface CarrySocket {
  bone: string
  pos: Vec3
  up: Vec3
  fwd: Vec3
}
export type CarrySockets = Record<CarrySlot, CarrySocket>

/** How far off the skin a slot sits, for clothes and the piece's own thickness. */
export const CLEARANCE = 0.03
/** A flat piece on the back rides over whatever is on the diagonals. */
const OVER = 0.06
/** Half the height of the band of skin a slot is measured on, in metres. */
const BAND = 0.03
/** The diagonals lean their grips this far over the shoulder, from straight up. */
const LEAN = (35 * Math.PI) / 180

const norm = (v: Vec3): Vec3 => {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}

/**
 * The extreme of `pick` over skin vertices mostly weighted to `bones`, within BAND of height `y` and passing `keep`:
 * the furthest point of the body's surface that way at that height. Undefined when no skin is there.
 */
function extreme(skin: Skin, skeleton: Skeleton, bones: readonly string[], y: number, keep: (x: number, z: number) => boolean, pick: (x: number, z: number) => number) {
  const set = new Set(bones.map((b) => skeleton.bones.indexOf(b)).filter((i) => i >= 0))
  const p = skin.positions
  let best: Vec3 | undefined
  let score = -Infinity
  for (let i = 0; i < p.length / 3; i++) {
    if (skin.skin && !skin.skin[i]) continue
    const [x, py, z] = [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]
    if (Math.abs(py - y) > BAND || !keep(x, z) || share(skin, i, set) < 0.5) continue
    const s = pick(x, z)
    if (s > score) {
      score = s
      best = [x, py, z]
    }
  }
  return best
}

/** Every carry slot on a body, from its skin and its skeleton at rest. */
export function carrySockets(skin: Skin, skeleton: Skeleton): CarrySockets {
  const r = skeleton.rest
  const torso = ['Hips', 'Spine', 'Spine1', 'Spine2']
  const mid = r.Spine2[0]
  const out = {} as CarrySockets
  // the back, between the shoulder blades: the furthest skin behind the spine at the chest
  const chest = r.Spine2[1]
  const back = extreme(skin, skeleton, torso, chest, (x) => Math.abs(x - mid) < 0.06, (_, z) => -z)
  const backZ = (back?.[2] ?? r.Spine2[2] - 0.12) - CLEARANCE
  const lean: Vec3 = [Math.sin(LEAN), Math.cos(LEAN), 0]
  out.back_r = { bone: SOCKET_BONE.back_r, pos: [mid, chest, backZ], up: [-lean[0], lean[1], 0], fwd: [0, 0, -1] }
  out.back_l = { bone: SOCKET_BONE.back_l, pos: [mid, chest, backZ], up: lean, fwd: [0, 0, -1] }
  out.back_flat = { bone: SOCKET_BONE.back_flat, pos: [mid, chest, backZ - OVER], up: [-1, 0, 0], fwd: [0, 0, -1] }
  // the small of the back, halfway from the hips to the spine's first joint above them
  const waist = (r.Hips[1] + r.Spine1[1]) / 2
  const low = extreme(skin, skeleton, torso, waist, (x) => Math.abs(x - mid) < 0.06, (_, z) => -z)
  out.lower_back = { bone: SOCKET_BONE.lower_back, pos: [mid, waist, (low?.[2] ?? r.Hips[2] - 0.12) - CLEARANCE], up: [-1, 0, 0], fwd: [0, 0, -1] }
  for (const [side, sign] of [['Left', 1], ['Right', -1]] as const) {
    const s = side === 'Left' ? 'l' : 'r'
    const legs = ['Hips', `${side}UpLeg`]
    // the hip, on the belt line at the side: the widest skin of the pelvis that way, a touch behind its middle
    const belt = r.Hips[1]
    const hip = extreme(skin, skeleton, legs, belt, (x, z) => (x - mid) * sign > 0 && Math.abs(z - r.Hips[2]) < 0.1, (x) => x * sign)
    const hx = (hip?.[0] ?? mid + sign * 0.18) + sign * CLEARANCE
    out[`hip_${s}`] = { bone: SOCKET_BONE[`hip_${s}`], pos: [hx, belt, (hip?.[2] ?? r.Hips[2]) - 0.03], up: norm([0, 0.85, 0.5]), fwd: [sign, 0, 0] }
    // the thigh, a third of the way down, on its outside
    const top = r[`${side}UpLeg`]
    const knee = r[`${side}Leg`]
    const y = top[1] + (knee[1] - top[1]) / 3
    const leg = extreme(skin, skeleton, [`${side}UpLeg`], y, (x) => (x - top[0]) * sign > 0, (x) => x * sign)
    const tx = (leg?.[0] ?? top[0] + sign * 0.09) + sign * CLEARANCE
    out[`thigh_${s}`] = { bone: SOCKET_BONE[`thigh_${s}`], pos: [tx, y, leg?.[2] ?? top[2]], up: [0, 1, 0], fwd: [sign, 0, 0] }
  }
  for (const slot of CARRY_SLOTS) if (!out[slot]) throw new Error(`carry slot ${slot}`)
  return out
}
