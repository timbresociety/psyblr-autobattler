import type { Build } from '../charter/build.js'
import { aiCommands } from '../arena/ai/brain.js'
import { GATE_PROFILE, GATE_TEAM_PROFILE, createMatch, play, type Combatant } from '../arena/engine/match.js'

/**
 * The balance model's entry points (KTD1, KTD6), now thin wrappers over the 3D arena engine: a headless match under
 * the gate profile with the demo AI on both sides. What the gate measures is what people play.
 */

export type { Combatant }

export interface BattleResult {
  winner: 0 | 1 | 'draw'
  time: number
  units: { name: string; team: 0 | 1; alive: boolean; hpFraction: number; damageDealt: number }[]
}

export function simulate(teamA: Combatant[], teamB: Combatant[], seed: number): BattleResult {
  const profile = teamA.length + teamB.length > 2 ? GATE_TEAM_PROFILE : GATE_PROFILE
  const r = play(createMatch(teamA, teamB, seed, { profile }), aiCommands)
  return { winner: r.winner, time: r.seconds, units: r.heroes.map(({ name, team, alive, hpFraction, damageDealt }) => ({ name, team, alive, hpFraction, damageDealt })) }
}

export function duel(a: Build, b: Build, seed: number): BattleResult {
  return simulate([{ build: a }], [{ build: b }], seed)
}
