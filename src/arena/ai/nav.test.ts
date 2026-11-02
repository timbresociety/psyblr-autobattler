import { describe, expect, it } from 'vitest'
import type { RoleId } from '../../charter/types.js'
import type { SizeClass } from '../../charter/sizes.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { STARTERS, starterBuild } from '../starters.js'
import { ENGINE } from '../engine/calibration.js'
import { initialCoverHealth } from '../engine/cover.js'
import type { MatchEvent } from '../engine/events.js'
import { HOUSE, HOUSE_LINES, LEVEL } from '../engine/house.js'
import { createMatch, LIVE_PROFILE, matchRules } from '../engine/match.js'
import { createHero, emptyMatch, MOVES, prepareHero, type MatchState } from '../engine/state.js'
import { tick } from '../engine/tick.js'
import { aiCommands } from './brain.js'
import { findPath, followRoute, navFor, nodeAt, type Route } from './nav.js'

/**
 * The bots' nav graph of the House of Instinct (GAME.md §8: "an AI navmesh with jump, mantle and drop links") and the
 * two §7 design rules it checks: baseline movement reaches every major platform (rule 1), walked for real in the
 * engine, and every strong position has more than one way in (rule 2).
 */

const g = navFor(HOUSE, HOUSE_LINES)
const regions = [...new Set(g.nodes.map((n) => n.region))]
const BLUE = { x: 0, y: LEVEL.main, z: -38 }
const RED = { x: 0, y: LEVEL.main, z: 38 }

/** The node nearest the middle of a region: where a hero sent "onto" that platform heads. */
function middleOf(region: number): number {
  const ids = g.nodes.flatMap((n, i) => (n.region === region ? [i] : []))
  const cx = ids.reduce((s, i) => s + g.nodes[i].x, 0) / ids.length
  const cz = ids.reduce((s, i) => s + g.nodes[i].z, 0) / ids.length
  const d = (i: number) => (g.nodes[i].x - cx) * (g.nodes[i].x - cx) + (g.nodes[i].z - cz) * (g.nodes[i].z - cz)
  return ids.reduce((a, b) => (d(b) < d(a) ? b : a))
}

/** Drive one hero along routes to `goal` in the real engine; the moves it made, or undefined when it never got there. */
function walk(start: { x: number; y: number; z: number }, goal: number, role: RoleId = 'fighter', size?: SizeClass, seconds = 40) {
  const setup = prepareHero({ ...defaultBuild(role), ...(size ? { sizeClass: size } : {}) })
  const m: MatchState = emptyMatch(1)
  m.cover = { pieces: HOUSE, health: initialCoverHealth(HOUSE) }
  m.lines = HOUSE_LINES
  const h = createHero(setup, 0, 0, { ...start })
  m.heroes.push(h)
  const events: MatchEvent[] = []
  let route: Route | undefined
  const target = g.nodes[goal]
  for (let t = 0; t < seconds * ENGINE.tickHz; t++) {
    if (!route || (!h.airborne && !h.zip && !h.mantle && t % 60 === 0)) {
      const path = findPath(g, nodeAt(g, h.position), goal, { jumpScale: ENGINE.move.jumpScale[setup.build.sizeClass ?? 'medium'] })
      if (!path) return undefined
      route = { path, at: 0 }
    }
    if (!h.airborne && Math.abs(h.position.y - target.y) < 0.3 && (h.position.x - target.x) ** 2 + (h.position.z - target.z) ** 2 < 1.44) return { at: { ...h.position }, moves: events.flatMap((e) => (e.type === 'move' ? [e.move] : [])) }
    const f = followRoute(g, h, route, m, setup.sheet.moveSpeed)
    events.push(...tick(m, [setup], [{ moveX: f.x, moveZ: f.z, moves: f.jump ? MOVES.jump : 0, aimYaw: 0, aimPitch: 0, buttons: 0 }]))
  }
  return undefined
}

describe('the nav graph of the House of Instinct (§8)', () => {
  it('is built from the map in well under a second, with jump, double jump, drop and zipline links', () => {
    const t0 = performance.now()
    const fresh = navFor([...HOUSE], HOUSE_LINES)
    expect(performance.now() - t0).toBeLessThan(1500)
    expect(fresh.nodes.length).toBe(g.nodes.length)
    const kinds = new Set(g.links.flat().map((l) => l.kind))
    for (const k of ['walk', 'jump', 'jump2', 'drop', 'zip'] as const) expect(kinds.has(k)).toBe(true)
    expect(regions.length).toBeGreaterThan(30)
  })

  it('rule 1: from either muster, every platform is reachable and you can get back, at every size', () => {
    for (const muster of [BLUE, RED]) {
      const home = nodeAt(g, muster)
      for (const scale of Object.values(ENGINE.move.jumpScale))
        for (const r of regions) {
          const there = middleOf(r)
          expect(findPath(g, home, there, { jumpScale: scale }), `region ${r} at scale ${scale}`).toBeDefined()
          expect(findPath(g, there, home, { jumpScale: scale }), `back from region ${r} at scale ${scale}`).toBeDefined()
        }
    }
  })

  it('rule 1, in the engine: a hero walks, jumps, mantles and rides from the blue muster onto every platform', () => {
    const home = BLUE
    for (const [role, size] of [['fighter', undefined], ['assassin', 'tiny'], ['tank', 'huge']] as const) {
      const missed = regions.filter((r) => !walk(home, middleOf(r), role, size))
      expect(missed.map((r) => `${role} ${size ?? 'medium'}: region ${r} at (${g.nodes[middleOf(r)].x}, ${g.nodes[middleOf(r)].y}, ${g.nodes[middleOf(r)].z})`)).toEqual([])
    }
  })

  it('the first deliverable in order: Roulette Court → Chip Stacks → Card Ramp → VIP Balcony → Chandelier', () => {
    const stops = [
      { x: 0, y: LEVEL.main + 2.5, z: 0 },
      { x: 16.5, y: LEVEL.main + 4.8, z: -16.6 },
      { x: -32, y: LEVEL.up, z: -30 },
      { x: 0, y: LEVEL.up, z: -32 },
      { x: 0, y: LEVEL.air, z: 0 },
    ]
    let at: { x: number; y: number; z: number } = BLUE
    const moves: string[] = []
    for (const stop of stops) {
      const goal = nodeAt(g, stop)
      expect(Math.abs(g.nodes[goal].y - stop.y)).toBeLessThan(0.1)
      const got = walk(at, goal)
      expect(got, `on to (${stop.x}, ${stop.y}, ${stop.z})`).toBeDefined()
      at = got!.at
      moves.push(...got!.moves)
    }
    for (const m of ['jump', 'mantle', 'zip-on', 'zip-off'] as const) expect(moves).toContain(m)
  })

  it('destruction never removes the only route to a position (§6b): with every breakable piece down, every platform is still reachable', () => {
    const breakable = HOUSE.flatMap((p, i) => (p.health !== undefined ? [i] : []))
    expect(HOUSE.filter((p) => p.look === 'card').length).toBeGreaterThanOrEqual(2)
    expect(HOUSE.filter((p) => p.look === 'glass').length).toBeGreaterThanOrEqual(2)
    // the card bridges carry nodes, so a route can take them while they stand
    const onBridge = g.nodes.flatMap((n, i) => (n.on !== undefined ? [i] : []))
    expect(onBridge.length).toBeGreaterThan(0)
    const broken = initialCoverHealth(HOUSE).map((h, i) => (breakable.includes(i) ? 0 : h))
    const standing = regions.filter((r) => g.nodes.some((n) => n.region === r && n.on === undefined))
    for (const muster of [BLUE, RED]) {
      const home = nodeAt(g, muster)
      for (const scale of Object.values(ENGINE.move.jumpScale))
        for (const r of standing) {
          const ids = g.nodes.flatMap((n, i) => (n.region === r && n.on === undefined ? [i] : []))
          const there = ids.reduce((a, b) => (Math.abs(g.nodes[b].x) + Math.abs(g.nodes[b].z) < Math.abs(g.nodes[a].x) + Math.abs(g.nodes[a].z) ? b : a))
          const path = findPath(g, home, there, { jumpScale: scale, health: broken })
          expect(path, `region ${r} at scale ${scale} with everything broken`).toBeDefined()
          expect(path!.some((i) => g.nodes[i].on !== undefined)).toBe(false)
        }
    }
  })

  it('rule 2: every strong position has more than one way in', () => {
    const inside = {
      'raised court': (n: (typeof g.nodes)[number]) => n.x * n.x + n.z * n.z <= 25 && Math.abs(n.y - (LEVEL.main + 2.5)) < 0.1,
      'balcony loop': (n: (typeof g.nodes)[number]) => Math.abs(n.y - LEVEL.up) < 0.1 && Math.max(Math.abs(n.x), Math.abs(n.z)) >= 19 && Math.max(Math.abs(n.x), Math.abs(n.z)) <= 23 && Math.abs(n.z) <= 23,
      'lounge pad': (n: (typeof g.nodes)[number]) => Math.abs(n.y - LEVEL.up) < 0.1 && n.x >= 22 && n.x <= 32 && n.z >= 26 && n.z <= 36,
      chandelier: (n: (typeof g.nodes)[number]) => Math.abs(n.y - LEVEL.air) < 0.1 && n.x * n.x + n.z * n.z <= 16,
    }
    for (const [name, isIn] of Object.entries(inside)) {
      // the outside nodes a link into the position starts from, gathered into ways in at least 6 m apart
      const from = g.links.flatMap((ls, i) => (isIn(g.nodes[i]) ? [] : ls.filter((l) => isIn(g.nodes[l.to])).map(() => g.nodes[i])))
      const ways: { x: number; z: number }[] = []
      for (const n of from) if (!ways.some((w) => (w.x - n.x) ** 2 + (w.z - n.z) ** 2 < 36)) ways.push(n)
      expect(ways.length, name).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('bots on the House of Instinct', () => {
  it('a 5 v 5 between AI squads fights it out across the levels, with no stall', () => {
    const squad = (name: 'vanguard' | 'outlaws') => STARTERS.filter((s) => s.squad === name).slice(0, 5).map((s) => ({ build: starterBuild(s) }))
    const moves = new Set<string>()
    for (const seed of [1, 2]) {
      const arena = createMatch(squad('vanguard'), squad('outlaws'), seed, { profile: LIVE_PROFILE, map: 'house' })
      const rules = matchRules(arena)
      let hits = 0
      let t = 0
      let lastHit = 0
      while (arena.match.winner === undefined) {
        for (const e of tick(arena.match, arena.setups, aiCommands(arena), rules)) {
          if (e.type === 'move') moves.add(e.move)
          if (e.type === 'hit') (hits++, (lastHit = t))
        }
        t++
      }
      // a wipe, or the clock with the last two still trading blows (the closing house edge of §8 comes in M7)
      expect(hits).toBeGreaterThan(50)
      expect(t - lastHit, `seed ${seed}: ${arena.match.endReason}`).toBeLessThan(5 * ENGINE.tickHz)
    }
    // the bots take the map's moves, not just the floor
    for (const m of ['jump', 'mantle', 'land'] as const) expect(moves).toContain(m)
  })
})
