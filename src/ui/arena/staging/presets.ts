import { SQUAD_NAME, type Squad } from '../../../arena/starters.js'
import type { Team } from '../../../arena/engine/state.js'
import type { RoleId } from '../../../charter/types.js'
import { MAX_PER_SIDE, deployHeroes, type Formation } from './formation.js'
import type { LoadoutEntry } from './loadout.js'

/**
 * Who fights whom before anyone drags a hero (U16): the starters are two generated squads, so the default is a squad
 * matchup (your side the Vanguard, the enemy the Outlaws), never a mirror. Kept free of React so it tests alone.
 */

export type MatchupId = 'squads' | 'squads-swapped' | 'mirror' | 'random'

export const MATCHUPS: readonly { id: MatchupId; label: string; needsSquads: boolean }[] = [
  { id: 'squads', label: 'Vanguard vs Outlaws', needsSquads: true },
  { id: 'squads-swapped', label: 'Outlaws vs Vanguard', needsSquads: true },
  { id: 'mirror', label: 'Mirror', needsSquads: false },
  { id: 'random', label: 'Random', needsSquads: false },
]

export { SQUAD_NAME }

/** Who stands nearest the middle: those built to take hits, then divers, controllers just behind them, then the back line. */
const RANK: Record<RoleId, number> = { tank: 0, fighter: 1, assassin: 2, controller: 3, mage: 4, summoner: 5, support: 6, marksman: 7 }

/** One squad's heroes as loadout indices, in roster order, up to `count`. */
export function squadLineup(loadout: readonly LoadoutEntry[], squad: Squad, count = MAX_PER_SIDE): number[] {
  return loadout.flatMap((e, i) => (e.squad === squad ? [i] : [])).slice(0, count)
}

export const hasSquads = (loadout: readonly LoadoutEntry[]) => squadLineup(loadout, 'vanguard', 1).length > 0 && squadLineup(loadout, 'outlaws', 1).length > 0

/** Tanks and fighters in the front rank, marksmen and supports at the back; ties keep their order. */
export function byRank(loadout: readonly LoadoutEntry[], heroes: readonly number[]): number[] {
  return [...heroes].sort((a, b) => (RANK[loadout[a]?.build.roleId] ?? 9) - (RANK[loadout[b]?.build.roleId] ?? 9))
}

/** The squad a side fields by default: yours the Vanguard, the enemy the Outlaws. */
export const defaultSquad = (side: Team, yourSide: Team): Squad => (side === yourSide ? 'vanguard' : 'outlaws')

/**
 * What auto-deploy puts on a side: the side's default squad when the roster has both squads, else the loadout in
 * order, cycling when it is short (a roster of forged heroes only).
 */
export function defaultLineup(loadout: readonly LoadoutEntry[], side: Team, yourSide: Team, count: number): number[] {
  const n = Math.max(1, Math.min(MAX_PER_SIDE, count))
  if (hasSquads(loadout)) return byRank(loadout, squadLineup(loadout, defaultSquad(side, yourSide), n))
  return loadout.length ? Array.from({ length: n }, (_, i) => i % loadout.length) : []
}

function shuffled(n: number, rng: () => number): number[] {
  const out = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Both sides set up at once. Mirror copies your side's lineup to the enemy (the Vanguard on both sides when yours is
 * empty). Random draws up to 10 different heroes for each side, the two sides apart while the roster allows.
 */
export function matchup(id: MatchupId, loadout: readonly LoadoutEntry[], yourSide: Team, current: Formation, rng: () => number = Math.random): Formation {
  const enemy = (1 - yourSide) as Team
  const both = (mine: number[], theirs: number[]) => deployHeroes(deployHeroes(current, yourSide, byRank(loadout, mine)), enemy, byRank(loadout, theirs))
  if (!loadout.length) return current
  switch (id) {
    case 'squads':
      return both(squadLineup(loadout, 'vanguard'), squadLineup(loadout, 'outlaws'))
    case 'squads-swapped':
      return both(squadLineup(loadout, 'outlaws'), squadLineup(loadout, 'vanguard'))
    case 'mirror': {
      const mine = current[yourSide].length ? current[yourSide].map((p) => p.hero) : hasSquads(loadout) ? squadLineup(loadout, 'vanguard') : Array.from({ length: Math.min(MAX_PER_SIDE, loadout.length) }, (_, i) => i)
      return both(mine, mine)
    }
    case 'random': {
      const order = shuffled(loadout.length, rng)
      const mine = order.slice(0, MAX_PER_SIDE)
      const rest = order.slice(MAX_PER_SIDE, MAX_PER_SIDE * 2)
      const theirs = rest.length >= Math.min(MAX_PER_SIDE, mine.length) ? rest : shuffled(loadout.length, rng).slice(0, MAX_PER_SIDE)
      return both(mine, theirs)
    }
  }
}

/** A side's squad as a name: one squad, mixed, the player's own heroes, or nobody yet. */
export function lineupName(loadout: readonly LoadoutEntry[], heroes: readonly number[]): string {
  if (!heroes.length) return 'Empty'
  const squads = new Set(heroes.map((h) => loadout[h]?.squad ?? 'own'))
  if (squads.size > 1) return 'Mixed'
  const only = [...squads][0]
  return only === 'own' ? 'Your heroes' : SQUAD_NAME[only as Squad]
}
