import { ENGINE } from '../../../arena/engine/calibration.js'
import { arenaExtent, coverHit, floorUnder, initialCoverHealth, pushOut, surfaceAt } from '../../../arena/engine/cover.js'
import { LIVE_MAP, MAPS, standingHeight } from '../../../arena/engine/maps.js'
import type { Vec3 } from '../../../arena/engine/maths.js'
import type { Team } from '../../../arena/engine/state.js'

/**
 * Staging rules (R2, R6, R7, R37), kept free of React so they test on their own: heroes go on their own half, at
 * most 10 a side, never on top of each other; the same hero may be placed again; placed heroes move and come off.
 * Keys 1-0 follow placement order (R38). A hero goes on any level the map has: the main floor, a trench, a deck, a
 * balcony or a machine top (owner, 2026-11-03).
 */

export const MAX_PER_SIDE = 10
/** Closest two placed heroes may stand, metres. */
export const SPACING = 1.8

export interface Placement {
  /** Index into the loadout. */
  hero: number
  x: number
  z: number
  /** The height of the surface it stands on; absent, the main floor there (or the lower route under a gap). */
  y?: number
}

export type Formation = [Placement[], Placement[]]

export const emptyFormation = (): Formation => [[], []]

/** The arena heroes are staged on: the live match's map. */
export const STAGE = MAPS[LIVE_MAP]
const stageHealth = initialCoverHealth(STAGE.pieces)
/** The stage's bounds: the whole map, the House and its concourse. */
export const BOUNDS = arenaExtent(STAGE.pieces)

/** Side 0 holds the near half (z < 0), side 1 the far half. */
export function onOwnHalf(side: Team, x: number, z: number): boolean {
  if (Math.abs(x) > BOUNDS.halfWidth - 1 || Math.abs(z) > BOUNDS.halfLength - 1) return false
  return side === 0 ? z <= -1 : z >= 1
}

/** The floor a hero placed at (x, z) stands on: the surface at height `y` there, or the main floor (or the route under it). */
export const standAt = (x: number, z: number, y?: number) => (y === undefined ? standingHeight(STAGE, x, z) : floorUnder(STAGE.pieces, stageHealth, { x, y, z }, y + ENGINE.move.step))

/** The highest surface at (x, z): what the board's camera sees from above, a machine top or a deck before the floor. */
export const topAt = (x: number, z: number) => floorUnder(STAGE.pieces, stageHealth, { x, y: 1e3, z }, 1e3)

/** True when a hero standing at (x, z), on the floor there, would be inside a piece of the arena (R25). */
// checked at the largest body any hero collides with, so the engine never has to move a staged hero
export const inRuins = (x: number, z: number, y?: number) => pushOut(STAGE.pieces, stageHealth, { x, y: standAt(x, z, y), z }, ENGINE.bodyRadiusCap, ENGINE.capsule.height * 2, ENGINE.move.step)

/**
 * Where a line of sight from `from` along `dir` lands for a hero to stand: the top of the first piece it meets (a deck,
 * a balcony, a machine), the floor just in front of a piece it meets side-on, or the ground. Undefined when it looks up.
 */
export function landingOf(from: Vec3, dir: Vec3): Vec3 | undefined {
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z)
  if (!(len > 0)) return undefined
  const far = 3000
  const at = (t: number): Vec3 => ({ x: from.x + (dir.x / len) * far * t, y: from.y + (dir.y / len) * far * t, z: from.z + (dir.z / len) * far * t })
  const hit = coverHit(STAGE.pieces, stageHealth, from, at(1))
  if (!hit) {
    if (dir.y >= 0) return undefined
    const t = -from.y / dir.y
    return { x: from.x + dir.x * t, y: 0, z: from.z + dir.z * t }
  }
  const p = at(hit.t)
  const top = surfaceAt(STAGE.pieces[hit.index], p.x, p.z)
  if (p.y >= top - 0.05) return { x: p.x, y: top, z: p.z }
  // met side-on: a quarter metre back toward the eye, on whatever floor is there
  const q = at(Math.max(0, hit.t - 0.25 / far))
  return { x: q.x, y: floorUnder(STAGE.pieces, stageHealth, q, q.y), z: q.z }
}

/** Two heroes too close: near across, and on the same level (one on a deck over another is fine). */
const crowded = (list: Placement[], x: number, z: number, y: number, ignore?: number) =>
  list.some((p, i) => i !== ignore && (p.x - x) ** 2 + (p.z - z) ** 2 < SPACING ** 2 && Math.abs(standAt(p.x, p.z, p.y) - y) < ENGINE.capsule.height)

export type PlaceResult = { ok: true; formation: Formation } | { ok: false; reason: 'wrong-half' | 'full' | 'crowded' | 'in-ruins' }

/** A spot's level: `y` when a surface was picked, kept only when it is not the main floor's own answer. */
const level = (x: number, z: number, y?: number) => (y === undefined || standAt(x, z, y) === standingHeight(STAGE, x, z) ? undefined : standAt(x, z, y))

export function place(f: Formation, side: Team, hero: number, x: number, z: number, y?: number): PlaceResult {
  const list = f[side]
  if (list.length >= MAX_PER_SIDE) return { ok: false, reason: 'full' }
  if (!onOwnHalf(side, x, z)) return { ok: false, reason: 'wrong-half' }
  if (inRuins(x, z, y)) return { ok: false, reason: 'in-ruins' }
  if (crowded(list, x, z, standAt(x, z, y))) return { ok: false, reason: 'crowded' }
  const at = level(x, z, y)
  return { ok: true, formation: withSide(f, side, [...list, at === undefined ? { hero, x, z } : { hero, x, z, y: at }]) }
}

export function move(f: Formation, side: Team, index: number, x: number, z: number, y?: number): PlaceResult {
  if (!onOwnHalf(side, x, z)) return { ok: false, reason: 'wrong-half' }
  if (inRuins(x, z, y)) return { ok: false, reason: 'in-ruins' }
  if (crowded(f[side], x, z, standAt(x, z, y), index)) return { ok: false, reason: 'crowded' }
  const at = level(x, z, y)
  return { ok: true, formation: withSide(f, side, f[side].map((p, i) => (i === index ? (at === undefined ? { hero: p.hero, x, z } : { hero: p.hero, x, z, y: at }) : p))) }
}

export const remove = (f: Formation, side: Team, index: number): Formation => withSide(f, side, f[side].filter((_, i) => i !== index))

function withSide(f: Formation, side: Team, list: Placement[]): Formation {
  return side === 0 ? [list, f[1]] : [f[0], list]
}

/**
 * Replace a side with these heroes (loadout indices, in order) in loose ranks of five across its half, from the
 * stage's muster line back: the first rank nearest the middle. At most 10.
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
    const z = (side === 0 ? -1 : 1) * (STAGE.muster + rank * 4)
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
