import { describe, expect, it } from 'vitest'
import { STARTERS, starterBuild } from '../starters.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { ticks } from '../engine/calibration.js'
import type { MatchEvent } from '../engine/events.js'
import { HOUSE_SPOTS, LEVEL } from '../engine/house.js'
import { EDGE, edgeAt, insideEdge } from '../engine/house-rules.js'
import { LIVE_PROFILE, createMatch, matchRules } from '../engine/match.js'
import { tick } from '../engine/tick.js'
import { aiCommands } from './brain.js'

const squad = (name: 'vanguard' | 'outlaws') => STARTERS.filter((s) => s.squad === name).map((s) => ({ build: starterBuild(s) }))

describe('bots under the house rules (GAME.md §2)', () => {
  it('a bot the edge is about to pass makes for safety, up a level when the edge closes on the balcony', () => {
    const balcony = HOUSE_SPOTS.findIndex((s) => s.floor === LEVEL.up)
    const arena = createMatch([{ build: defaultBuild('mage', 'Runner') }], [{ build: defaultBuild('tank', 'Far') }], balcony, { map: 'house', profile: LIVE_PROFILE })
    const m = arena.match
    // the main floor across the court from the balcony spot, as the second close begins
    m.tick = ticks(EDGE.steps[2].at - 6)
    Object.assign(m.heroes[0].position, { x: -30, y: LEVEL.main, z: -20 })
    // its enemy is parked far off, so the edge is the only reason to move
    Object.assign(m.heroes[1].position, { x: HOUSE_SPOTS[balcony].x, y: LEVEL.up, z: 0 })
    const rules = matchRules(arena)
    const stay = () => Object.assign(m.heroes[1].position, { x: HOUSE_SPOTS[balcony].x, y: LEVEL.up, z: 0 })
    for (let i = 0; i < ticks(30); i++) {
      stay()
      const commands = aiCommands(arena)
      commands[1] = undefined
      tick(m, arena.setups, commands, rules)
    }
    expect(m.heroes[0].alive).toBe(true)
    expect(insideEdge(edgeAt(m.house!.spot, m.tick), m.heroes[0].position)).toBe(true)
    expect(m.heroes[0].position.y).toBeGreaterThan(LEVEL.main + 3)
  })

  it('AI 10 v 10s on the house end with the last squad standing, and the vault is fought over', () => {
    let cracked = 0
    for (const seed of [1, 2, 3]) {
      const arena = createMatch(squad('outlaws'), squad('vanguard'), seed, { map: 'house', profile: LIVE_PROFILE })
      arena.match.aiLevels = ['normal', 'normal']
      const rules = matchRules(arena)
      const events: MatchEvent[] = []
      while (arena.match.winner === undefined) events.push(...tick(arena.match, arena.setups, aiCommands(arena), rules).filter((e) => e.type === 'vault' || e.type === 'end'))
      expect(arena.match.endReason).toBe('wipe')
      expect(arena.match.heroes.filter((h) => h.alive).every((h) => h.team === arena.match.winner)).toBe(true)
      if (events.some((e) => e.type === 'vault' && e.what !== 'open')) cracked++
    }
    expect(cracked).toBeGreaterThanOrEqual(2)
  })
})
