import type { Quaternion } from 'three'
import table from './limits.json'
import { fromSwingTwist, swingTwist, type SwingTwist } from './swing-twist.js'

/**
 * Ranges of motion (GAME.md §9.2): per keyed bone, how far it may twist about its length and swing about its local X
 * and Z from rest, in degrees. Measured over the whole clip library by scripts/joint-ranges.ts (both sides' union,
 * mirrored, plus a margin), so clean motion capture stays inside; IK, look-at and the procedural layers clamp to it,
 * and the physique bench (§9.7) counts what a retargeted clip or a fix-up pushes past it.
 *
 * The hips carry the whole body and are free; the eyes are limited by the look code (EYE_LIMIT).
 */
export type AxisRange = readonly [min: number, max: number]
export interface JointLimit {
  twist: AxisRange
  x: AxisRange
  z: AxisRange
}

export const JOINT_LIMITS: Readonly<Record<string, JointLimit>> = (table as unknown as { limits: Record<string, JointLimit> }).limits

/** How far an eye turns from straight ahead, any way. */
export const EYE_LIMIT = 30

const st: SwingTwist = { twist: 0, x: 0, z: 0 }
const EDGE = 1e-3

/** Degrees past the bone's limit on its worst axis (0 inside it, or for a bone with no limit). */
export function limitExcess(bone: string, delta: Quaternion): number {
  const limit = JOINT_LIMITS[bone]
  if (!limit) return 0
  swingTwist(delta, st)
  let worst = 0
  for (const axis of ['twist', 'x', 'z'] as const) {
    const [lo, hi] = limit[axis]
    worst = Math.max(worst, lo - st[axis], st[axis] - hi)
  }
  return worst
}

/** `delta` (rest⁻¹ · pose) brought inside the bone's limit, axis by axis; returns whether it had to move. */
export function clampToLimits(bone: string, delta: Quaternion): boolean {
  const limit = JOINT_LIMITS[bone]
  if (!limit) return false
  swingTwist(delta, st)
  let moved = false
  for (const axis of ['twist', 'x', 'z'] as const) {
    const [lo, hi] = limit[axis]
    // a turn clamped to the edge reads back a hair past it, so the edge itself counts as inside
    if (st[axis] < lo - EDGE || st[axis] > hi + EDGE) (st[axis] = Math.min(hi, Math.max(lo, st[axis]))), (moved = true)
  }
  if (moved) fromSwingTwist(st, delta)
  return moved
}
