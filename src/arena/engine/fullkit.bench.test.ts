import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STARTERS, starterBuild } from '../starters.js'
import { matchRules, type Combatant } from './match.js'
import { advance, arenaFor } from './replay.js'

/**
 * What the full kit (GAME.md §4: knockdowns, the perfect guard, the V moveset, the downed state) does to a fight
 * nobody plays: the same AI squads on the same seeds, with it off and on. Run before changing which matches turn it on:
 *
 *     FULLKIT_BENCH=1 npx vitest run src/arena/engine/fullkit.bench.test.ts
 *
 * Writes its table to FULLKIT_OUT when set. Not part of the ordinary run.
 */
const squad = (name: 'vanguard' | 'outlaws'): Combatant[] => STARTERS.filter((s) => s.squad === name).map((s) => ({ build: starterBuild(s) }))

function fight(seed: number, fullKit: boolean) {
  const arena = arenaFor({ teams: [squad('vanguard'), squad('outlaws')], seed, side: 0, map: 'house', ...(fullKit ? { fullKit } : {}) })
  const rules = matchRules(arena)
  const seen = { downed: 0, revived: 0, bledOut: 0, knockdowns: 0, parries: 0, launches: 0, deaths: 0 }
  const limit = arena.timerTicks + 60 * 120
  while (arena.match.winner === undefined && arena.match.tick < limit) {
    for (const e of advance(arena, rules, undefined, undefined).events) {
      if (e.type === 'downed') seen[e.phase === 'down' ? 'downed' : e.phase === 'revived' ? 'revived' : e.phase === 'out' ? 'bledOut' : 'downed'] += e.phase === 'revive-start' ? 0 : 1
      else if (e.type === 'melee' && e.what === 'knockdown') seen.knockdowns++
      else if (e.type === 'melee' && e.what === 'parry') seen.parries++
      else if (e.type === 'melee' && e.what === 'launch') seen.launches++
      else if (e.type === 'death') seen.deaths++
    }
  }
  return { winner: arena.match.winner, reason: arena.match.endReason, seconds: Math.round(arena.match.tick / 60), ...seen }
}

describe.runIf(process.env.FULLKIT_BENCH)('the full kit in a fight nobody plays', () => {
  it('ends every match, and moves who wins by little', () => {
    const seeds = Array.from({ length: Number(process.env.FULLKIT_SEEDS ?? 12) }, (_, i) => 101 + i * 7)
    const rows = seeds.map((seed) => ({ seed, off: fight(seed, false), on: fight(seed, true) }))
    const wins = (key: 'off' | 'on') => rows.filter((r) => r[key].winner === 0).length
    const mean = (key: 'off' | 'on', f: 'seconds' | 'downed' | 'revived' | 'bledOut' | 'knockdowns' | 'parries' | 'launches') => rows.reduce((s, r) => s + r[key][f], 0) / rows.length
    const table = {
      seeds: seeds.length,
      blueWins: { off: wins('off'), on: wins('on') },
      sameWinner: rows.filter((r) => r.off.winner === r.on.winner).length,
      seconds: { off: mean('off', 'seconds'), on: mean('on', 'seconds') },
      on: { downed: mean('on', 'downed'), revived: mean('on', 'revived'), bledOut: mean('on', 'bledOut'), knockdowns: mean('on', 'knockdowns'), parries: mean('on', 'parries'), launches: mean('on', 'launches') },
      unfinished: rows.filter((r) => r.off.winner === undefined || r.on.winner === undefined).length,
      rows,
    }
    if (process.env.FULLKIT_OUT) writeFileSync(process.env.FULLKIT_OUT, JSON.stringify(table, null, 1))
    expect(table.unfinished).toBe(0)
  }, 600_000)
})
