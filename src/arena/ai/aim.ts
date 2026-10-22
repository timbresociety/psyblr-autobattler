import { chest } from '../engine/deliveries'
import { ENGINE } from '../engine/calibration'
import { atan2, wrapAngle, type Vec3 } from '../engine/maths'
import { next } from '../engine/rng'
import type { BrainState, HeroState, MatchState } from '../engine/state'
import { AI } from './calibration'

/**
 * Human-like aim (KTD7): the hand lags behind the target, overshoots when it swings to a new one, settles, jitters a
 * little, and leads moving targets most of the way. Strong and human, never a snap.
 */

/** Where to point to hit `target` with a shot of `speed` m/s (no speed for instant deliveries). */
export function aimPoint(match: MatchState, brain: BrainState, from: Vec3, target: HeroState, speed?: number): Vec3 {
  const at = chest(target)
  const seen = brain.seen
  if (!speed || !seen || seen.target !== target.id || match.tick <= seen.tick) return at
  const dt = (match.tick - seen.tick) / ENGINE.tickHz
  const v = { x: (target.position.x - seen.x) / dt, y: (target.position.y - seen.y) / dt, z: (target.position.z - seen.z) / dt }
  const dx = at.x - from.x
  const dy = at.y - from.y
  const dz = at.z - from.z
  const flight = Math.sqrt(dx * dx + dy * dy + dz * dz) / speed
  return { x: at.x + v.x * flight * AI.lead, y: at.y + v.y * flight * AI.lead, z: at.z + v.z * flight * AI.lead }
}

export const anglesTo = (from: Vec3, to: Vec3) => {
  const dx = to.x - from.x
  const dz = to.z - from.z
  return { yaw: atan2(dx, dz), pitch: atan2(to.y - from.y, Math.sqrt(dx * dx + dz * dz)) }
}

/** Move the hand one tick toward the wanted angles; returns how far off it still is, radians. */
export function trackAim(match: MatchState, brain: BrainState, want: { yaw: number; pitch: number }, swung: boolean): number {
  const dYaw = wrapAngle(want.yaw - brain.yaw)
  const dPitch = want.pitch - brain.pitch
  if (swung) brain.overshoot = dYaw * AI.overshoot
  brain.overshoot *= AI.overshootDecay
  brain.yaw = wrapAngle(brain.yaw + dYaw * AI.aimTrack + brain.overshoot * (1 - AI.overshootDecay) + (next(match.ai) * 2 - 1) * AI.aimJitter)
  brain.pitch += dPitch * AI.aimTrack + (next(match.ai) * 2 - 1) * AI.aimJitter * 0.5
  const offYaw = wrapAngle(want.yaw - brain.yaw)
  const offPitch = want.pitch - brain.pitch
  return Math.sqrt(offYaw * offYaw + offPitch * offPitch)
}
