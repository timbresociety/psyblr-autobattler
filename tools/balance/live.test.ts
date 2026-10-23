import { it } from 'vitest'
import { aiCommands } from '../../src/arena/ai/brain'
import { DEMO_HEROES, demoBuild } from '../../src/arena/demo/roster'
import { LIVE_PROFILE, createMatch, matchRules } from '../../src/arena/engine/match'
import { tick } from '../../src/arena/engine/tick'
import { armyModifiers } from '../../src/charter/synergy'
import type { Build } from '../../src/charter/build'
import { deployHeroes } from '../../src/ui/arena/staging/formation'

// staging's own deployment: tanks and fighters in the front rank, the back line behind, as a real match starts
const RANK: Record<string, number> = { tank: 0, fighter: 1, assassin: 2, controller: 3, mage: 4, summoner: 5, support: 6, marksman: 7 }
function deployed(builds: Build[], side: 0 | 1): { team: Build[]; spots: { x: number; y: number; z: number }[] } {
  const order = builds.map((_, i) => i).sort((a, b) => RANK[builds[a].roleId] - RANK[builds[b].roleId])
  const f = deployHeroes([[], []], side, order)[side]
  return { team: f.map((p) => builds[p.hero]), spots: f.map((p) => ({ x: p.x, y: 0, z: p.z })) }
}

// throwaway live check: 10v10 demo armies on the live profile, per-role damage, deaths and time alive
it('live', () => {
  const moguls = DEMO_HEROES.filter((h) => h.faction === 'mogul').map(demoBuild)
  const leaders = DEMO_HEROES.filter((h) => h.faction === 'leader').map(demoBuild)
  const seeds = Number(process.env.SEEDS ?? 6)
  const roles = new Map<string, { dmg: number; deaths: number; alive: number; n: number; heal: number }>()
  const heroes = new Map<string, { dmg: number; deaths: number; alive: number; n: number }>()
  const wins = { moguls: 0, leaders: 0, draw: 0 }
  let mirror = [0, 0, 0]
  let longest = 0
  const matchups: [string, typeof moguls, typeof moguls][] = ([['m-l', moguls, leaders], ['l-m', leaders, moguls], ['mirror-m', moguls, moguls], ['mirror-l', leaders, leaders]] as [string, typeof moguls, typeof moguls][]).filter(([l]) => !process.env.CROSS || l === 'm-l' || l === 'l-m')
  for (const [label, a, b] of matchups) {
    for (let seed = 1; seed <= seeds; seed++) {
      const da = deployed(a, 0)
      const db = deployed(b, 1)
      const arena = createMatch(armyModifiers(da.team), armyModifiers(db.team), seed * 7919, { profile: LIVE_PROFILE, formations: [da.spots, db.spots] })
      const rules = matchRules(arena)
      const deathAt = new Array(arena.match.heroes.length).fill(Infinity)
      while (arena.match.winner === undefined) {
        const ev = tick(arena.match, arena.setups, aiCommands(arena), rules)
        for (const e of ev) if (e.type === 'death') deathAt[e.hero] = arena.match.tick
      }
      const end = arena.match.tick
      longest = Math.max(longest, end / 60)
      arena.match.heroes.forEach((h, i) => {
        const role = arena.setups[i].build.roleId
        const r = roles.get(role) ?? { dmg: 0, deaths: 0, alive: 0, n: 0, heal: 0 }
        r.dmg += h.damageDealt
        r.deaths += h.alive ? 0 : 1
        r.alive += Math.min(deathAt[i], end) / end
        r.n++
        roles.set(role, r)
        if (label === 'm-l' || label === 'l-m') {
          const name = arena.setups[i].build.heroName
          const hs = heroes.get(name) ?? { dmg: 0, deaths: 0, alive: 0, n: 0 }
          hs.dmg += h.damageDealt
          hs.deaths += h.alive ? 0 : 1
          hs.alive += Math.min(deathAt[i], end) / end
          hs.n++
          heroes.set(name, hs)
        }
      })
      const w = arena.match.winner
      if (label === 'm-l') w === 0 ? wins.moguls++ : w === 1 ? wins.leaders++ : wins.draw++
      else if (label === 'l-m') w === 0 ? wins.leaders++ : w === 1 ? wins.moguls++ : wins.draw++
      else mirror = mirror.map((x, k) => x + ((k === 0 && w === 0) || (k === 1 && w === 1) || (k === 2 && w !== 0 && w !== 1) ? 1 : 0))
      console.log('MATCH', label, seed, 'winner', w, 'secs', (end / 60).toFixed(0))
    }
  }
  console.log('WINS', JSON.stringify(wins), 'mirror side0/side1/draw', mirror.join('/'), 'longest', longest.toFixed(0))
  for (const [name, h] of heroes) console.log('HERO', name.padEnd(36), 'dmg', Math.round(h.dmg / h.n), 'deaths', (h.deaths / h.n).toFixed(2), 'alive', (h.alive / h.n).toFixed(2))
  for (const [role, r] of roles) console.log('ROLE', role.padEnd(10), 'dmg/hero', Math.round(r.dmg / r.n), 'death rate', (r.deaths / r.n).toFixed(2), 'time alive', (r.alive / r.n).toFixed(2))
}, 3_600_000)
