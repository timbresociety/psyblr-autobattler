import { carryOn, cast } from './deliveries.js'
import type { Ctx } from './effects.js'
import type { BuildSlot } from '../../charter/types.js'

/**
 * For tests about where a skill lands and what it does: cast and land it on the same tick, with no wind-up or
 * recovery, the way every cast worked before action timing (phase 1). Returns whether it started.
 */
export function land(ctx: Ctx, index: number, slot: BuildSlot): boolean {
  if (!cast(ctx, index, slot)) return false
  const hero = ctx.match.heroes[index]
  const action = hero.action
  if (action) {
    action.release = ctx.match.tick
    carryOn(ctx, index)
    hero.action = undefined
  }
  return true
}
