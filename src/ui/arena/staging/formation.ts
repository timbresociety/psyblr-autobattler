import { ENGINE } from '../../../arena/engine/calibration'
import { RUINS, initialCoverHealth, pushOut } from '../../../arena/engine/cover'
import type { Team } from '../../../arena/engine/state'

/**
 * Staging rules (R2, R6, R7, R37), kept free of React so they test on their own: heroes go on their own half, at
 * most 10 a side, never on top of each other; the same hero may be placed again; placed heroes move and come off.
 * Keys 1-0 follow placement order (R38).
 */

export const MAX_PER_SIDE = 10
/** Closest two placed heroes may stand, metres. */
export const SPACING = 1.8

export interface Placement {
  /** Index into the loadout. */
  hero: number
  x: number
  z: number
}

export type Formation = [Placement[], Placement[]]

export const emptyFormation = (): Formation => [[], []]

/** Side 0 holds the near half (z < 0), side 1 the far half. */
export function onOwnHalf(side: Team, x: number, z: number): boolean {
  const { halfWidth, halfLength } = ENGINE.arena
  if (Math.abs(x) > halfWidth - 1 || Math.abs(z) > halfLength - 1) return false
  return side === 0 ? z <= -1 : z >= 1
}

const ruinsHealth = initialCoverHealth(RUINS)
/** True when a hero standing at (x, z) would be inside a piece of the ruins (R25). */
// checked at the largest body any hero collides with, so the engine never has to move a staged hero
export const inRuins = (x: number, z: number) => pushOut(RUINS, ruinsHealth, { x, y: 0, z }, ENGINE.bodyRadiusCap, ENGINE.capsule.height * 2)

const crowded = (list: Placement[], x: number, z: number, ignore?: number) => list.some((p, i) => i !== ignore && (p.x - x) ** 2 + (p.z - z) ** 2 < SPACING ** 2)

export type PlaceResult = { ok: true; formation: Formation } | { ok: false; reason: 'wrong-half' | 'full' | 'crowded' | 'in-ruins' }

export function place(f: Formation, side: Team, hero: number, x: number, z: number): PlaceResult {
  const list = f[side]
  if (list.length >= MAX_PER_SIDE) return { ok: false, reason: 'full' }
  if (!onOwnHalf(side, x, z)) return { ok: false, reason: 'wrong-half' }
  if (inRuins(x, z)) return { ok: false, reason: 'in-ruins' }
  if (crowded(list, x, z)) return { ok: false, reason: 'crowded' }
  return { ok: true, formation: withSide(f, side, [...list, { hero, x, z }]) }
}

export function move(f: Formation, side: Team, index: number, x: number, z: number): PlaceResult {
  if (!onOwnHalf(side, x, z)) return { ok: false, reason: 'wrong-half' }
  if (inRuins(x, z)) return { ok: false, reason: 'in-ruins' }
  if (crowded(f[side], x, z, index)) return { ok: false, reason: 'crowded' }
  return { ok: true, formation: withSide(f, side, f[side].map((p, i) => (i === index ? { ...p, x, z } : p))) }
}

export const remove = (f: Formation, side: Team, index: number): Formation => withSide(f, side, f[side].filter((_, i) => i !== index))

function withSide(f: Formation, side: Team, list: Placement[]): Formation {
  return side === 0 ? [list, f[1]] : [f[0], list]
}

/**
 * Replace a side with these heroes (loadout indices, in order) in loose ranks of five across its half: the first rank
 * nearest the middle. At most 10.
 */
export function deployHeroes(f: Formation, side: Team, heroes: readonly number[]): Formation {
  let next = withSide(f, side, [])
  const n = Math.min(MAX_PER_SIDE, heroes.length)
  const perRank = 5
  for (let i = 0; i < n; i++) {
    const rank = Math.floor(i / perRank)
    const inRank = Math.min(perRank, n - rank * perRank)
    const slot = i % perRank
    const x = (slot - (inRank - 1) / 2) * 4
    const z = (side === 0 ? -1 : 1) * (10 + rank * 4)
    // a spot on the ruins slides along the rank until it is clear
    for (const shift of [0, 1.5, -1.5, 3, -3]) {
      const r = place(next, side, heroes[i], x + shift, z)
      if (r.ok) {
        next = r.formation
        break
      }
    }
  }
  return next
}

/** Fill a side up to `count` heroes in loose ranks across its half, cycling the loadout. */
export function autoDeploy(f: Formation, side: Team, loadout: number, count: number): Formation {
  const n = Math.max(1, Math.min(MAX_PER_SIDE, count))
  return deployHeroes(f, side, Array.from({ length: n }, (_, i) => i % Math.max(1, loadout)))
}
