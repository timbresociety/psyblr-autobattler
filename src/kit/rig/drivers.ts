import type { Quaternion } from 'three'
import type { Driver, MetaBone } from './metarig.js'
import { swingTwist, type SwingTwist } from './swing-twist.js'

/**
 * How far a joint's turn drives a helper (GAME.md §9.2): 0 at `range[0]` degrees on the driver's axis, 1 at
 * `range[1]`, clamped; a range that runs downward drives as the angle falls (a triceps as the elbow straightens).
 * `delta` is the joint's local rotation with its rest taken off.
 */
const st: SwingTwist = { twist: 0, x: 0, z: 0 }

export function drive(driver: Driver, delta: Quaternion): number {
  swingTwist(delta, st)
  const v = driver.axis === 'swing' ? Math.hypot(st.x, st.z) : st[driver.axis]
  const [a, b] = driver.range
  return Math.min(1, Math.max(0, (v - a) / (b - a)))
}

/**
 * A helper's pose for a drive: how far it moves out along its push direction, in girths, and how much it swells
 * (a scale about its own joint). A muscle does it by the region's gain (0 on lean bodies); a corrective on every body,
 * since big and small bodies alike lose volume at a bent elbow, and in metres it grows with the girth anyway.
 */
export interface HelperPose {
  out: number
  swell: number
}

export const MUSCLE_PUSH = { out: 0.16, swell: 0.22 }
export const CORRECTIVE_PUSH = { out: 0.32, swell: 0.08 }

export function helperPose(bone: MetaBone, d: number, gain: number, out: HelperPose = { out: 0, swell: 0 }): HelperPose {
  if (bone.kind === 'muscle') {
    out.out = MUSCLE_PUSH.out * d * gain
    out.swell = MUSCLE_PUSH.swell * d * gain
  } else if (bone.kind === 'corrective') {
    out.out = CORRECTIVE_PUSH.out * d
    out.swell = CORRECTIVE_PUSH.swell * d
  } else {
    out.out = 0
    out.swell = 0
  }
  return out
}
