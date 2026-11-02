import { describe, expect, it } from 'vitest'
import type { RoleId } from '../../charter/types.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { GATE_TEAM_PROFILE, createMatch, play } from '../engine/match.js'
import { aiCommands } from './brain.js'
import { AI, AI_LEVELS, useLevel, type AiLevel } from './calibration.js'

/** One mixed squad: a front line, damage and a back line. */
const ROLES: RoleId[] = ['tank', 'fighter', 'mage', 'marksman', 'support']
const squad = () => ROLES.map((r) => ({ build: defaultBuild(r) }))

/** Share of fights `better` wins against `worse`, the same squads on both sides, each level playing each side in turn. */
function winShare(better: AiLevel, worse: AiLevel, seeds = 5): number {
  let wins = 0
  let fights = 0
  for (let seed = 1; seed <= seeds; seed++) {
    for (const side of [0, 1] as const) {
      const arena = createMatch(squad(), squad(), seed * 101 + side, { profile: GATE_TEAM_PROFILE })
      arena.match.aiLevels = side === 0 ? [better, worse] : [worse, better]
      const r = play(arena, aiCommands)
      fights++
      if (r.winner === side) wins++
      else if (r.winner === 'draw') wins += 0.5
    }
  }
  return wins / fights
}

describe('AI levels (GAME.md §2)', () => {
  it('differ only in how they play: reaction, aim, defence, combos and skill use, never health or damage', () => {
    const keys = Object.keys(AI_LEVELS.hard)
    for (const level of ['easy', 'normal'] as const) expect(Object.keys(AI_LEVELS[level])).toEqual(keys)
    for (const k of keys) expect(k).not.toMatch(/health|damage|hp|armou?r/i)
    // slower decisions and reactions, looser aim, fewer dodges, as the level drops
    expect(AI_LEVELS.easy.decisionTicks).toBeGreaterThan(AI_LEVELS.normal.decisionTicks)
    expect(AI_LEVELS.normal.decisionTicks).toBeGreaterThan(AI_LEVELS.hard.decisionTicks)
    expect(AI_LEVELS.easy.skillUse).toBeLessThan(AI_LEVELS.normal.skillUse)
    expect(AI_LEVELS.normal.skillUse).toBeLessThan(AI_LEVELS.hard.skillUse)
  })

  it('Hard is the gate’s level: with no level set, the AI plays as Hard', () => {
    useLevel(undefined)
    expect(AI).toBe(AI_LEVELS.hard)
  })

  it('in the same fights, Hard beats Normal and Normal beats Easy', () => {
    expect(winShare('hard', 'normal')).toBeGreaterThan(0.6)
    expect(winShare('normal', 'easy')).toBeGreaterThan(0.6)
    expect(winShare('hard', 'easy')).toBeGreaterThan(0.75)
  })
})
