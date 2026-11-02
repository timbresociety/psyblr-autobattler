import { RUINS, floorUnder, initialCoverHealth, type CoverPiece, type MapLine } from './cover.js'
import { HOUSE, HOUSE_LINES, LEVEL } from './house.js'
import { ENGINE } from './calibration.js'

/**
 * The arenas a match can play on. The House of Instinct (GAME.md §8) is where live matches play; the flat ruins stay
 * as the balance gate's ground until the gate is re-run on the house (its duels need the bots to path across bands).
 */

export type MapId = 'house' | 'ruins'

export interface ArenaMap {
  id: MapId
  /** What the loading screen calls it. */
  name: string
  pieces: readonly CoverPiece[]
  lines: readonly MapLine[]
  /** Height a hero placed by x and z stands at: the highest walkable top at or below this. */
  stand: number
  /** Built in levels: the bots path across it on the nav graph (src/arena/ai/nav.ts). */
  levels: boolean
  /** How far from the middle a side's first rank musters when it deploys in one go, metres. */
  muster: number
}

export const MAPS: Record<MapId, ArenaMap> = {
  house: { id: 'house', name: 'House of Instinct', pieces: HOUSE, lines: HOUSE_LINES, stand: LEVEL.main, levels: true, muster: 34 },
  ruins: { id: 'ruins', name: 'Roman ruins', pieces: RUINS, lines: [], stand: 0, levels: false, muster: 10 },
}

/** Live matches play here. */
export const LIVE_MAP: MapId = 'house'

const healths = new Map<readonly CoverPiece[], ReturnType<typeof initialCoverHealth>>()

/** The floor a hero placed at (x, z) on `map` stands on: its main floor, or the trench or tunnel floor under a gap. */
export function standingHeight(map: ArenaMap, x: number, z: number): number {
  let health = healths.get(map.pieces)
  if (!health) healths.set(map.pieces, (health = initialCoverHealth(map.pieces)))
  return floorUnder(map.pieces, health, { x, y: map.stand, z }, map.stand + ENGINE.move.step)
}
