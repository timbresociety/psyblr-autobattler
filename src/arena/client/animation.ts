import type { BuildSlot } from '../../charter/types.js'
import type { MatchEvent } from '../engine/events.js'
import type { HeroState } from '../engine/state.js'

/**
 * Each hero's animation state (KTD9), driven only by engine events and state: run or fly while moving, a cast
 * pose for a slot, a flinch on a heavy hit, stunned, and dead for good.
 */
export type AnimState = { kind: 'idle' | 'run' | 'fly' | 'hit' | 'stunned' | 'dead' } | { kind: 'cast'; slot: BuildSlot }

export interface Animator {
  state: AnimState
  /** Seconds the current one-shot (cast, hit) keeps playing. */
  hold: number
}

export const CAST_SECONDS = 0.45
export const HIT_SECONDS = 0.25

export const createAnimator = (): Animator => ({ state: { kind: 'idle' }, hold: 0 })

/** Apply this tick's events for one hero. */
export function onEvents(a: Animator, hero: number, events: readonly MatchEvent[]) {
  if (a.state.kind === 'dead') return
  for (const e of events) {
    if (e.type === 'death' && e.hero === hero) {
      a.state = { kind: 'dead' }
      return
    }
    if (e.type === 'cast' && e.hero === hero) {
      a.state = { kind: 'cast', slot: e.slot }
      a.hold = CAST_SECONDS
    } else if (e.type === 'hit' && e.target === hero && e.heavy && a.state.kind !== 'cast') {
      a.state = { kind: 'hit' }
      a.hold = HIT_SECONDS
    }
  }
}

/** Advance by `dt` seconds and settle the looping state from the hero's movement. */
export function settle(a: Animator, hero: HeroState, moved: number, tick: number, dt: number): AnimState {
  if (a.state.kind === 'dead') return a.state
  if (a.hold > 0) {
    a.hold -= dt
    if (a.hold > 0) return a.state
  }
  a.state = { kind: hero.stunnedUntil > tick ? 'stunned' : hero.airborne ? 'fly' : moved > 0.01 ? 'run' : 'idle' }
  return a.state
}
