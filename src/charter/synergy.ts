import type { Build } from './build'
import type { RoleId } from './types'

/**
 * Army synergy (R16, KTD8). Any 10 heroes may form an army. Stacking one role past the threshold
 * weakens that role's effects step by step; armies with enough distinct roles get a small team bonus.
 */
export const STACK_THRESHOLD = 3
export const STACK_STEP = 0.1
export const STACK_FLOOR = 0.45
export const DIVERSITY_MIN = 4
export const TEAM_BONUS = 0.06

export interface SynergySummary {
  penalties: { role: RoleId; count: number; scale: number }[]
  distinctRoles: number
  teamBonus: number
}

function roleCounts(builds: Build[]): Map<RoleId, number> {
  const counts = new Map<RoleId, number>()
  for (const b of builds) counts.set(b.roleId, (counts.get(b.roleId) ?? 0) + 1)
  return counts
}

export function stackScale(count: number): number {
  return Math.max(STACK_FLOOR, 1 - Math.max(0, count - STACK_THRESHOLD) * STACK_STEP)
}

export function describeSynergy(builds: Build[]): SynergySummary {
  const counts = roleCounts(builds)
  const penalties = [...counts]
    .filter(([, count]) => count > STACK_THRESHOLD)
    .map(([role, count]) => ({ role, count, scale: stackScale(count) }))
    .sort((a, b) => b.count - a.count)
  return { penalties, distinctRoles: counts.size, teamBonus: counts.size >= DIVERSITY_MIN ? TEAM_BONUS : 0 }
}

/** Per-hero modifiers for a team fight, in army order. */
export function armyModifiers(builds: Build[]): { build: Build; powerScale: number; damageBonus: number }[] {
  const counts = roleCounts(builds)
  const { teamBonus } = describeSynergy(builds)
  return builds.map((build) => ({ build, powerScale: stackScale(counts.get(build.roleId) ?? 0), damageBonus: teamBonus }))
}
