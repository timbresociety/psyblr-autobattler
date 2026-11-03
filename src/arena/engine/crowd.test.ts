import { describe, expect, it } from 'vitest'
import { aiCommands, thinkEvery } from '../ai/brain.js'
import { STARTERS, starterBuild } from '../starters.js'
import { GRIDS, HeroGrid } from './grid.js'
import { createMatch, LIVE_PROFILE, matchRules } from './match.js'
import { tick } from './tick.js'

const squad = (name: 'vanguard' | 'outlaws', per: number) => {
  const base = STARTERS.filter((s) => s.squad === name)
  return Array.from({ length: per }, (_, i) => ({ build: starterBuild(base[i % base.length]) }))
}

/** A whole AI match on the house, every event of every tick written down. */
function play(per: number, seed: number, ticksMax: number) {
  const arena = createMatch(squad('vanguard', per), squad('outlaws', per), seed, { profile: LIVE_PROFILE, map: 'house' })
  const rules = matchRules(arena)
  const log: string[] = []
  // CPU time this worker spent on each tick, in ms: wall time measures whatever else the machine is running
  const times: number[] = []
  for (let t = 0; t < ticksMax && arena.match.winner === undefined; t++) {
    const a = process.cpuUsage()
    const events = tick(arena.match, arena.setups, aiCommands(arena), rules)
    const d = process.cpuUsage(a)
    times.push((d.user + d.system) / 1000)
    log.push(JSON.stringify(events))
  }
  return { log, times, arena }
}

describe('the crowd path (GAME.md §10)', () => {
  it('the spatial grids find exactly what a scan of every piece and hero finds: the same match, tick for tick', () => {
    for (const seed of [3, 11]) {
      const fast = play(10, seed, 2400).log
      GRIDS.on = false
      try {
        const slow = play(10, seed, 2400).log
        expect(fast.length).toBe(slow.length)
        for (let i = 0; i < fast.length; i++) if (fast[i] !== slow[i]) expect(`tick ${i}: ${fast[i]}`).toBe(`tick ${i}: ${slow[i]}`)
      } finally {
        GRIDS.on = true
      }
    }
  }, 120_000)

  it('the hero grid hands back the heroes in a box in index order, and every hero when the box is huge', () => {
    const arena = createMatch(squad('vanguard', 5), squad('outlaws', 5), 1, { profile: LIVE_PROFILE, map: 'house' })
    const heroes = arena.match.heroes
    const grid = new HeroGrid(heroes)
    const h = heroes[3].position
    const near = grid.within(h.x - 1, h.x + 1, h.z - 1, h.z + 1)
    expect(near).toContain(heroes[3])
    expect(near.map((x) => x.id)).toEqual([...near.map((x) => x.id)].sort((a, b) => a - b))
    expect(grid.within(-1e4, 1e4, -1e4, 1e4)).toHaveLength(heroes.length)
  })

  it('a hero far from the player thinks less often', () => {
    const arena = createMatch(squad('vanguard', 2), squad('outlaws', 2), 1, { profile: LIVE_PROFILE, map: 'house' })
    const m = arena.match
    const [a, b] = m.heroes
    m.human = b.id
    a.position = { ...b.position, x: b.position.x + 10 }
    expect(thinkEvery(m, a)).toBe(1)
    a.position = { ...b.position, x: b.position.x + 60 }
    expect(thinkEvery(m, a)).toBe(2)
    a.position = { ...b.position, x: b.position.x + 100 }
    expect(thinkEvery(m, a)).toBe(3)
    // nobody playing (the gate, a watched match): everyone thinks at the full rate
    m.human = undefined
    expect(thinkEvery(m, a)).toBe(1)
  })

  it('a 50 v 50 on the house fits in the 60 Hz tick: AI and engine together well inside a frame', () => {
    const { times } = play(50, 7, 1200)
    const sorted = times.slice(60).sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const p99 = sorted[Math.floor(sorted.length * 0.99)]
    // a 60 Hz frame is 16.7 ms and the renderer needs most of it; on a quiet M1 the simulation takes about 1.2 ms of
    // CPU a tick (p99 2.4 ms). Alongside the whole suite on 8 GB the CPU itself runs about four times slower, so there
    // only a gross regression fails; `npm run bench:crowd` runs it alone against the frame
    if (!process.env.CROWD_BENCH) return expect(median).toBeLessThan(8)
    expect(median).toBeLessThan(4)
    expect(p99).toBeLessThan(1000 / 60)
  }, 120_000)
})
