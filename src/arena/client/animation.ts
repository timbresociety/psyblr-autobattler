import type { BuildSlot } from '../../charter/types.js'
import type { MatchEvent } from '../engine/events.js'
import type { HeroState } from '../engine/state.js'

/**
 * Each hero's animation state (KTD9), driven only by engine events and state: run or fly while moving, a cast
 * pose for a slot, a flinch on a heavy hit, stunned, and dead for good.
 *
 * A cast runs on the engine's clock (Forge goal, phase 1): `prep` is how much of the wind-up is done and `recover` how
 * much of the recovery, each 0 to 1, so the clip's release frame lands on the engine's release tick. `seq` counts the
 * hero's casts, so a second swing of the same skill restarts its clip. Previews that only name a slot play the clip
 * as it was made.
 */
export type AnimState =
  | { kind: 'idle' | 'run' | 'fly' | 'hit' | 'stunned' | 'dead' }
  | { kind: 'cast'; slot: BuildSlot; seq?: number; prep?: number; recover?: number }

export interface Animator {
  state: AnimState
  /** Seconds the current flinch keeps playing. */
  hold: number
  /** The cast in progress, in engine ticks: pressed at `started`, released at `release`, over at `ends`. */
  cast?: { slot: BuildSlot; started: number; release: number; ends: number }
  /** Casts so far. */
  casts: number
}

export const HIT_SECONDS = 0.25

export const createAnimator = (): Animator => ({ state: { kind: 'idle' }, hold: 0, casts: 0 })

/** Apply one tick's events for one hero; `tick` is the tick they happened on. */
export function onEvents(a: Animator, hero: number, events: readonly MatchEvent[], tick: number) {
  if (a.state.kind === 'dead') return
  for (const e of events) {
    if (e.type === 'death' && e.hero === hero) {
      a.state = { kind: 'dead' }
      a.cast = undefined
      return
    }
    if (e.type === 'cast' && e.hero === hero) {
      a.cast = { slot: e.slot, started: tick, release: e.release, ends: e.ends }
      a.casts++
      a.state = { kind: 'cast', slot: e.slot, seq: a.casts, prep: 0, recover: 0 }
      a.hold = 0
    } else if (e.type === 'interrupt' && e.hero === hero && a.cast?.slot === e.slot) {
      a.cast = undefined
    } else if (e.type === 'hit' && e.target === hero && e.heavy && !a.cast) {
      a.state = { kind: 'hit' }
      a.hold = HIT_SECONDS
    }
  }
}

/**
 * Settle the state for this frame. `now` is the engine's clock in ticks, fractional between ticks, so a cast's clip
 * moves as smoothly as the heroes do; `dt` (seconds) runs down a flinch.
 */
export function settle(a: Animator, hero: HeroState, moved: number, now: number, dt: number): AnimState {
  if (a.state.kind === 'dead') return a.state
  const c = a.cast
  if (c && now < c.ends) {
    const prep = Math.min(1, Math.max(0, (now - c.started) / Math.max(1, c.release - c.started)))
    const recover = now <= c.release ? 0 : Math.min(1, (now - c.release) / Math.max(1, c.ends - c.release))
    a.state = { kind: 'cast', slot: c.slot, seq: a.casts, prep, recover }
    return a.state
  }
  a.cast = undefined
  if (a.hold > 0) {
    a.hold -= dt
    if (a.hold > 0) return a.state
  }
  a.state = { kind: hero.stunnedUntil > now ? 'stunned' : hero.airborne ? 'fly' : moved > 0.01 ? 'run' : 'idle' }
  return a.state
}

const DEG = Math.PI / 180

/**
 * How fast hips turn (radians a second) and how far the chest twists from them. Running, the hips turn at most `warp`
 * toward where the hero goes and the legs run the rest of the way at an angle under them, at most `legs`, easing
 * there at `swing` radians a second; so a hero strafing past its aim runs on a diagonal with its chest square to the
 * aim, the way a player strafes, instead of turning its hips side on and wringing its spine round (Forge goal, phase
 * 2). A hero moving further than `back.enter` from its aim runs backwards, and runs forwards again under `back.leave`,
 * so a hero strafing near the line doesn't flip between the two every few frames. A hero casting while it covers more
 * than `stride` metres a second keeps running under the cast, and a standing hero's hips hold until its aim is `pivot`
 * round from them.
 */
export const STANCE = { turn: 12, twist: 100 * DEG, warp: 55 * DEG, legs: 60 * DEG, swing: 8, back: { enter: 110 * DEG, leave: 90 * DEG }, stride: 0.6, pivot: 45 * DEG }

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/**
 * Where a hero's hips face, how far its chest twists back toward its aim, whether it runs backwards, whether it's
 * turning on the spot to face its aim, and how far its legs run at an angle to its hips (radians, the same way round
 * as yaw).
 */
export interface Stance {
  body: number
  twist: number
  back: boolean
  pivot: boolean
  legs: number
}

/**
 * How a hero stands this frame (Forge goal, phases 1 and 2). Running, its hips turn part of the way toward where it
 * moves, its legs run the rest at an angle, and its chest twists to where it aims, so a hero shooting while it strafes
 * or backs away doesn't skate; moving away from its aim it faces the aim and runs backwards. Standing, its feet stay
 * put: the hips hold while the chest follows the aim, and only once the aim is STANCE.pivot round do the hips turn, all
 * the way to face it. In the air the whole body faces the aim. `last` is last frame's stance: the hips turn from there
 * at STANCE.turn. `move` is how far the hero moved, if it did.
 */
export function stance(last: Stance | undefined, aim: number, move: { x: number; z: number } | undefined, mode: 'run' | 'stand' | 'square', dt: number): Stance {
  const from = last?.body ?? aim
  let target = aim
  let back = false
  let pivot = false
  let heading: number | undefined
  if (mode === 'run' && move) {
    heading = Math.atan2(move.x, move.z)
    const off = wrap(heading - aim)
    back = Math.abs(off) > (last?.back ? STANCE.back.leave : STANCE.back.enter)
    // the hips go part of the way round toward the line the legs run along, forwards or backwards
    target = wrap(aim + clamp(back ? wrap(off + Math.PI) : off, STANCE.warp))
  } else if (mode === 'stand') {
    pivot = Math.abs(wrap(aim - from)) > (last?.pivot ? 1e-3 : STANCE.pivot)
    if (!pivot) target = from
  }
  const step = wrap(target - from)
  let hips = wrap(from + Math.sign(step) * Math.min(Math.abs(step), STANCE.turn * dt))
  // the chest never twists past its limit: past it, the hips come round with it
  let twist = wrap(aim - hips)
  if (Math.abs(twist) > STANCE.twist) {
    twist = Math.sign(twist) * STANCE.twist
    hips = wrap(aim - twist)
  }
  // the legs make up the rest of the way to the line they run along, easing there
  const wanted = heading === undefined ? 0 : clamp(wrap((back ? heading + Math.PI : heading) - hips), STANCE.legs)
  const was = last?.legs ?? 0
  const legs = was + Math.sign(wanted - was) * Math.min(Math.abs(wanted - was), STANCE.swing * dt)
  return { body: hips, twist, back, pivot, legs }
}

const clamp = (a: number, limit: number) => Math.max(-limit, Math.min(limit, a))
