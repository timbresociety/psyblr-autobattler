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
 * How fast hips turn (radians a second) and how far the chest twists from them. A hero moving further than `back.enter`
 * from its aim runs backwards, and runs forwards again under `back.leave`: the gap keeps a hero strafing near the line
 * from flipping between the two every few frames. A hero casting while it covers more than `stride` metres a second
 * keeps running under the cast (Forge goal, phase 2).
 */
export const STANCE = { turn: 12, twist: 100 * DEG, back: { enter: 140 * DEG, leave: 120 * DEG }, stride: 0.6 }

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** Where a moving hero's hips face, how far its chest twists back toward its aim, and whether it runs backwards. */
export interface Stance {
  body: number
  twist: number
  back: boolean
}

/**
 * How a hero stands this frame (Forge goal, phase 1). Its legs follow where it moves and its chest twists toward where
 * it aims, so a hero shooting while it strafes or backs away doesn't skate; moving away from its aim it faces the aim
 * and runs backwards. Standing, casting or flying, the whole body faces the aim. `last` is last frame's stance: the hips
 * turn from there at STANCE.turn. `move` is how far the hero moved, if it did.
 */
export function stance(last: Stance | undefined, aim: number, move: { x: number; z: number } | undefined, square: boolean, dt: number): Stance {
  let target = aim
  let back = false
  if (move && !square) {
    const heading = Math.atan2(move.x, move.z)
    back = Math.abs(wrap(aim - heading)) > (last?.back ? STANCE.back.leave : STANCE.back.enter)
    target = back ? wrap(heading + Math.PI) : heading
  }
  const from = last?.body ?? aim
  const step = wrap(target - from)
  let hips = wrap(from + Math.sign(step) * Math.min(Math.abs(step), STANCE.turn * dt))
  // the chest never twists past its limit: past it, the hips come round with it
  let twist = wrap(aim - hips)
  if (Math.abs(twist) > STANCE.twist) {
    twist = Math.sign(twist) * STANCE.twist
    hips = wrap(aim - twist)
  }
  return { body: hips, twist, back }
}
