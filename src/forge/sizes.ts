import type { Build } from '../charter/build'
import { getRole } from '../charter/roles'
import { SIZES, type SizeClass } from '../charter/sizes'
import { deriveSheet } from '../charter/stats'
import { runGate, type GateOptions } from '../sim/gate'

export interface SizeCost {
  sizeClass: SizeClass
  healthDelta: number
  speedDelta: number
  /** Metres the hitbox grows (positive) or shrinks against medium. */
  hitRadius: number
  winRate: number
  retuneSteps: number
  state: 'ready' | 'blocked'
}

/** What a size class costs this build, shown at the size confirm (AE3, KTD8). */
export function sizeCost(build: Build, sizeClass: SizeClass, options: GateOptions = { duelsPerMember: 6 }): SizeCost {
  const role = getRole(build.roleId)
  const base = deriveSheet(role, build.spread, 'medium').sheet
  const sized = deriveSheet(role, build.spread, sizeClass).sheet
  const outcome = runGate({ ...build, sizeClass }, options)
  return {
    sizeClass,
    healthDelta: Math.round(sized.maxHealth - base.maxHealth),
    speedDelta: Math.round((sized.moveSpeed - base.moveSpeed) * 100) / 100,
    hitRadius: SIZES[sizeClass].hitRadius,
    winRate: outcome.winRate,
    retuneSteps: outcome.build.slots.basic.retuneSteps,
    state: outcome.state,
  }
}
