import { ENGINE } from '../engine/calibration.js'
import { ceilingOver, coverHit, floorUnder, initialCoverHealth, pushOut, type CoverHealth, type CoverPiece, type MapLine } from '../engine/cover.js'
import type { Vec3 } from '../engine/maths.js'
import { bodyRadius, type HeroState, type MatchState } from '../engine/state.js'

/**
 * The bots' map of a vertical arena (GAME.md §8, "an AI navmesh with jump, mantle and drop links"), built once from
 * the map's own geometry so it always matches what the engine collides with. Walkable ground is sampled on a 2 m grid
 * (plus the centre of every small platform), neighbours a hero walks between are linked, and the edges of walkable
 * regions are linked to other regions by the baseline moves: a jump (a mantle finishes it when the top is out of the
 * jump's reach), a double jump, a drop, and the map's ziplines and rails. Costs are seconds at a jog. Pure arithmetic,
 * deterministic, and never needs a physics step.
 */

export type LinkKind = 'walk' | 'drop' | 'jump' | 'jump2' | 'zip'

export interface NavNode {
  x: number
  y: number
  z: number
  /** The walkable region (connected by walking) the node is in. */
  region: number
  /** The breakable piece the node stands on (a card bridge, §6b): once it is broken the node is gone. */
  on?: number
}

export interface NavLink {
  to: number
  kind: LinkKind
  /** Seconds at a jog. */
  cost: number
  /** For a jump: the height its arc has to reach before a mantle pulls the hero up the rest. */
  need: number
  /** For a jump: how far across it goes. */
  span?: number
  /** For a zip: the line ridden. */
  line?: number
}

export interface NavGraph {
  nodes: NavNode[]
  links: NavLink[][]
  /** Node ids by grid column. */
  columns: Map<number, number[]>
}

const M = ENGINE.move
const CELL = 2
/** The body the graph is built for: a medium hero with a little room to spare. */
const RADIUS = ENGINE.capsule.radius + 0.05
const HEIGHT = ENGINE.capsule.height
/** The jog every timing is measured at, m/s. */
const JOG = 6.5
/** The slowest jog a jump's length is planned for, so heavy heroes make the same jumps. */
const CARRY = 5.5
/** How far apart, at their start, two jump or drop links between the same pair of regions must be. */
const SPREAD = 5
const REACH = 7.5

const key = (ix: number, iz: number) => ix * 4096 + iz
const cellOf = (v: number) => Math.round(v / CELL)

/** Seconds to rise to `h` and fall back to it from a jump of height `jump`, at gravity. */
function hang(jump: number, h: number): number {
  const v0 = Math.sqrt(2 * M.gravity * jump)
  const d = v0 * v0 - 2 * M.gravity * Math.max(0, h)
  return d < 0 ? 0 : (v0 + Math.sqrt(d)) / M.gravity
}

/**
 * Whether a hero of jump scale `scale` makes a jump `span` metres across whose arc has to reach `need` metres up (a
 * mantle does the rest), with one jump or with the air jump at the top of it, carried at the slowest planned jog.
 */
export function jumpable(span: number, need: number, scale: number, double: boolean): boolean {
  const jump = M.jump * scale
  if (!double) return need <= jump - 0.5 && span <= CARRY * hang(jump, need) + CELL * 0.5
  const air = M.airJump * scale
  return need <= jump + air - 1 && span <= CARRY * (Math.sqrt(2 * M.gravity * jump) / M.gravity + hang(air, need - jump)) + CELL * 0.5
}
/** The biggest jump scale any size has: the graph keeps every jump some hero makes, and each route checks its own. */
const LIGHTEST = Math.max(...Object.values(M.jumpScale))

const graphs = new WeakMap<readonly CoverPiece[], NavGraph>()

/** The graph for a map's pieces and lines, built on first use. */
export function navFor(pieces: readonly CoverPiece[], lines: readonly MapLine[] = []): NavGraph {
  let g = graphs.get(pieces)
  if (!g) graphs.set(pieces, (g = buildNav(pieces, lines)))
  return g
}

export function buildNav(pieces: readonly CoverPiece[], lines: readonly MapLine[] = []): NavGraph {
  const health = initialCoverHealth(pieces)
  // breakable barricades and glass are walls to the graph: their tops are no place to stand once they're gone. A card
  // bridge is a floor until it falls, and the nodes on it say so
  const solid = (i: number) => pieces[i].health === undefined || pieces[i].look === 'card'
  const over = (p: CoverPiece, x: number, z: number) => {
    const s = p.shape
    return s.kind === 'block' ? Math.abs(x - s.x) <= s.hx && Math.abs(z - s.z) <= s.hz : (x - s.x) * (x - s.x) + (z - s.z) * (z - s.z) <= s.r * s.r
  }
  const nodes: NavNode[] = []
  const columns = new Map<number, number[]>()
  const add = (x: number, y: number, z: number) => {
    const k = key(cellOf(x), cellOf(z))
    const col = columns.get(k) ?? []
    if (col.some((n) => Math.abs(nodes[n].y - y) < 0.5 && Math.abs(nodes[n].x - x) < 0.8 && Math.abs(nodes[n].z - z) < 0.8)) return
    col.push(nodes.length)
    columns.set(k, col)
    const on = pieces.findIndex((p) => p.health !== undefined && Math.abs(p.top - y) < 0.02 && over(p, x, z))
    nodes.push({ x, y, z, region: -1, ...(on >= 0 ? { on } : {}) })
  }
  // a floor under the body's middle and all round it (not the top of a glass partition or a lip)
  const floorAt = (x: number, y: number, z: number) => Math.abs(floorUnder(pieces, health, { x, y, z }, y + 0.01) - y) <= 0.02 || Math.abs(floorUnder(pieces, health, { x, y, z }, y + M.step) - y) <= M.step
  const standable = (x: number, y: number, z: number) => {
    if (Math.abs(floorUnder(pieces, health, { x, y, z }, y + 0.01) - y) > 0.02) return false
    if (![[0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]].every(([ox, oz]) => floorAt(x + ox, y, z + oz))) return false
    if (pushOut(pieces, health, { x, y, z }, RADIUS, HEIGHT, M.step)) return false
    return ceilingOver(pieces, health, { x, y, z }, RADIUS, y + 0.05, y + HEIGHT) === undefined
  }
  const { halfWidth, halfLength } = ENGINE.arena
  const heightsAt = (x: number, z: number) => {
    const ys = [0]
    pieces.forEach((p, i) => {
      if (solid(i) && over(p, x, z)) ys.push(floorUnder(pieces, health, { x, y: 0, z }, p.top + 0.001))
    })
    return [...new Set(ys.map((y) => Math.round(y * 1000) / 1000))]
  }
  for (let ix = cellOf(-halfWidth + 1); ix <= cellOf(halfWidth - 1); ix++)
    for (let iz = cellOf(-halfLength + 1); iz <= cellOf(halfLength - 1); iz++) {
      const [x, z] = [ix * CELL, iz * CELL]
      for (const y of heightsAt(x, z)) if (standable(x, y, z)) add(x, y, z)
    }
  // small platforms (chips, candlesticks, gantries) get a node at their centre, wherever the grid falls
  pieces.forEach((p, i) => {
    const s = p.shape
    if (!solid(i) || p.slope || (s.kind === 'block' && Math.min(s.hx, s.hz) > CELL)) return
    if (standable(s.x, p.top, s.z)) add(s.x, p.top, s.z)
  })

  const links: NavLink[][] = nodes.map(() => [])
  const near = (n: NavNode, r: number) => {
    const out: number[] = []
    const c = Math.ceil(r / CELL)
    for (let dx = -c; dx <= c; dx++) for (let dz = -c; dz <= c; dz++) for (const j of columns.get(key(cellOf(n.x) + dx, cellOf(n.z) + dz)) ?? []) out.push(j)
    return out
  }
  const flat = (a: NavNode, b: NavNode) => Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z))

  // walking: each step of the way stays on a floor no more than a step from the last, and nothing stands in the way
  const walks = (a: NavNode, b: NavNode) => {
    const d = flat(a, b)
    const n = Math.max(2, Math.ceil(d / 0.4))
    let y = a.y
    for (let k = 1; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n
      const z = a.z + ((b.z - a.z) * k) / n
      const f = floorUnder(pieces, health, { x, y, z }, y + M.step)
      if (Math.abs(f - y) > M.step) return false
      y = f
      if (pushOut(pieces, health, { x, y, z }, RADIUS, HEIGHT, M.step)) return false
    }
    return Math.abs(y - b.y) < 0.05
  }
  nodes.forEach((a, i) => {
    for (const j of near(a, CELL * 1.5)) {
      if (j === i) continue
      const b = nodes[j]
      const d = flat(a, b)
      if (d > CELL * 1.5 || Math.abs(b.y - a.y) > d * 0.5 + M.step || !walks(a, b)) continue
      links[i].push({ to: j, kind: 'walk', cost: Math.sqrt(d * d + (b.y - a.y) * (b.y - a.y)) / JOG, need: 0 })
    }
  })

  // regions: what walking alone connects
  let regions = 0
  nodes.forEach((n, i) => {
    if (n.region >= 0) return
    const stack = [i]
    n.region = regions
    while (stack.length) {
      const k = stack.pop()!
      for (const l of links[k])
        if (nodes[l.to].region < 0) {
          nodes[l.to].region = regions
          stack.push(l.to)
        }
    }
    regions++
  })
  const walkOut = links.map((l) => l.length)
  const edge = (i: number) => walkOut[i] < 8

  // the space a body passes through, swept at feet, waist and head height
  const sweep = (ax: number, az: number, bx: number, bz: number, feet: number) =>
    [0.25, 0.95, 1.65].every((h) => !coverHit(pieces, health, { x: ax, y: feet + h, z: az }, { x: bx, y: feet + h, z: bz }, 0.3))
  const open = (n: NavNode, from: number, to: number) => ceilingOver(pieces, health, n, 0.3, from, to) === undefined
  // overhangs above a floor: only pieces hanging clear of it, so the ledge a mantle pulls up onto never counts
  const overhangs = new Map<number, number[]>()
  const above = (y: number) => {
    const k = Math.round(y * 10)
    let h = overhangs.get(k)
    if (!h) overhangs.set(k, (h = pieces.map((p, i) => (p.base > y + M.step ? health[i] : 0))))
    return h
  }
  // a body moving from `p` to `q` (feet), swept at feet, waist and head height, against what hangs over `floor`: it
  // may run into the side of a ledge a mantle pulls it up onto, never under one
  const body = (p: Vec3, q: Vec3, floor: number) =>
    [0.25, 0.95, 1.65].every((h) => {
      const hit = coverHit(pieces, above(floor), { x: p.x, y: p.y + h, z: p.z }, { x: q.x, y: q.y + h, z: q.z }, 0.3)
      return !hit || pieces[hit.index].top <= p.y + (q.y - p.y) * hit.t + M.mantle.height
    })
  // a jump's arc lies between straight up then across, and a straight line from the take-off to over the landing (a
  // hero running at it): the box has to be clear, and nothing may hang over the straight line or a steeper rise
  const clearArc = (a: NavNode, b: NavNode, kind: LinkKind) => {
    if (kind === 'drop') return sweep(a.x, a.z, b.x, b.z, a.y + M.step + 0.05) && open(b, b.y + 0.05, a.y + HEIGHT + 0.3)
    const peak = Math.max(a.y, b.y) + 0.3
    const third = { x: a.x + (b.x - a.x) / 3, y: peak, z: a.z + (b.z - a.z) / 3 }
    const over = { x: b.x, y: peak, z: b.z }
    if (!open(a, a.y + 0.05, peak + HEIGHT) || !sweep(a.x, a.z, b.x, b.z, peak) || !open(b, b.y + 0.05, peak + HEIGHT)) return false
    const start = { x: a.x, y: a.y + M.step, z: a.z }
    return body(start, over, a.y) && body(start, third, a.y) && body(third, over, a.y)
  }
  // what a move between two regions takes, or undefined when the baseline can't make it
  const moveFor = (a: NavNode, b: NavNode): { kind: LinkKind; need: number; time: number } | undefined => {
    const d = flat(a, b)
    const rise = b.y - a.y
    if (rise < -M.step) {
      // walking off the edge: over the gap at a jog while falling
      const fall = Math.sqrt((2 * -rise) / M.gravity)
      if (d > CARRY * fall + CELL * 0.75) return undefined
      return { kind: 'drop', need: 0, time: d / JOG + fall + 0.15 }
    }
    // the arc only has to clear the ledge's lip less what a mantle pulls up
    const need = Math.max(0, rise - M.mantle.height + 0.3)
    if (jumpable(d, need, 1, false)) return { kind: 'jump', need, time: d / JOG + 0.3 }
    if (jumpable(d, need, LIGHTEST, true)) return { kind: 'jump2', need, time: d / JOG + 0.6 }
    return undefined
  }
  // for each pair of regions, the shortest valid moves, spread along the edges: no two start and land near each other
  const chosen = new Map<number, [NavNode, NavNode][]>()
  const pairs: { i: number; j: number; d: number }[] = []
  nodes.forEach((a, i) => {
    if (!edge(i)) return
    for (const j of near(a, REACH)) {
      const b = nodes[j]
      if (b.region === a.region || !edge(j)) continue
      const d = flat(a, b)
      if (d <= REACH) pairs.push({ i, j, d })
    }
  })
  pairs.sort((p, q) => p.d - q.d || p.i - q.i || p.j - q.j)
  for (const { i, j } of pairs) {
    const [a, b] = [nodes[i], nodes[j]]
    const pair = a.region * 65536 + b.region
    const kept = chosen.get(pair)
    if (kept && kept.some(([ka, kb]) => flat(ka, a) < SPREAD && flat(kb, b) < SPREAD && Math.abs(kb.y - b.y) < 1)) continue
    const move = moveFor(a, b)
    if (!move || !clearArc(a, b, move.kind)) continue
    links[i].push({ to: j, kind: move.kind, cost: move.time, need: move.need, span: flat(a, b) })
    if (kept) kept.push([a, b])
    else chosen.set(pair, [[a, b]])
  }

  // ziplines and rails, ridden from their high end: caught by a jump from below it, let go over the far end
  lines.forEach((l, li) => {
    const [hi, lo] = l.a.y >= l.b.y ? [l.a, l.b] : [l.b, l.a]
    const len = Math.sqrt((hi.x - lo.x) * (hi.x - lo.x) + (hi.y - lo.y) * (hi.y - lo.y) + (hi.z - lo.z) * (hi.z - lo.z))
    const under = (p: { x: number; y: number; z: number }, below: [number, number]) => {
      let best = -1
      let bestD = Infinity
      for (const j of near({ ...p, region: 0 }, 3)) {
        const n = nodes[j]
        const drop = p.y - n.y
        const d = flat(n, { ...p, region: 0 })
        if (drop < below[0] || drop > below[1] || d > 2.5) continue
        if (d + drop * 0.1 < bestD) [best, bestD] = [j, d + drop * 0.1]
      }
      return best
    }
    const start = under(hi, l.kind === 'zip' ? [1.5, M.jump + HEIGHT - 0.2] : [-0.5, M.jump - 0.5])
    // let go at the far end, the hero carries on the way the line ran: it lands where that carries it
    const grip = l.kind === 'zip' ? HEIGHT + M.zip.hang : 0
    const along = { x: (lo.x - hi.x) / len, z: (lo.z - hi.z) / len }
    let end = -1
    let miss = 2
    for (const j of near({ ...lo, region: 0 }, 9)) {
      const n = nodes[j]
      const h = lo.y - grip - n.y
      if (h < 0) continue
      const t = Math.sqrt((2 * h) / M.gravity)
      const x = lo.x + along.x * M.zip.speed * t
      const z = lo.z + along.z * M.zip.speed * t
      const d = Math.sqrt((x - n.x) * (x - n.x) + (z - n.z) * (z - n.z))
      if (d < miss) [end, miss] = [j, d]
    }
    if (start < 0 || end < 0) return
    links[start].push({ to: end, kind: 'zip', cost: len / M.zip.speed + 0.8, need: 0, line: li })
  })
  return { nodes, links, columns }
}

/** The node a hero at `p` stands on or over: the nearest one at or below its feet. */
export function nodeAt(g: NavGraph, p: { x: number; y: number; z: number }): number {
  let best = -1
  let bestD = Infinity
  const [cx, cz] = [cellOf(p.x), cellOf(p.z)]
  for (let r = 1; r <= 3 && best < 0; r++)
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++)
        for (const j of g.columns.get(key(cx + dx, cz + dz)) ?? []) {
          const n = g.nodes[j]
          const below = p.y - n.y
          if (below < -M.step - 0.1) continue
          const d = (n.x - p.x) * (n.x - p.x) + (n.z - p.z) * (n.z - p.z) + below * below * 4
          if (d < bestD) [best, bestD] = [j, d]
        }
  return best
}

/** What a hero can take: the jumps its size reaches, and double jumps only with a stamina pip to spend. */
export interface Mover {
  jumpScale: number
  /** The map's cover health now: nodes on a broken piece are no way through. */
  health?: readonly CoverHealth[]
}

/** The cheapest route from `from` to `to` (node ids, `from` first), or undefined when there is none. */
export function findPath(g: NavGraph, from: number, to: number, mover: Mover = { jumpScale: 1 }): number[] | undefined {
  if (from < 0 || to < 0) return undefined
  if (from === to) return [from]
  const n = g.nodes.length
  const cost = new Float64Array(n).fill(Infinity)
  const prev = new Int32Array(n).fill(-1)
  const goal = g.nodes[to]
  const h = (i: number) => {
    const a = g.nodes[i]
    return Math.sqrt((a.x - goal.x) * (a.x - goal.x) + (a.y - goal.y) * (a.y - goal.y) + (a.z - goal.z) * (a.z - goal.z)) / M.zip.speed
  }
  // a binary heap of [estimate, node]
  const heap: number[] = []
  const push = (f: number, i: number) => {
    heap.push(f, i)
    let c = heap.length / 2 - 1
    while (c > 0) {
      const p = (c - 1) >> 1
      if (heap[p * 2] <= heap[c * 2]) break
      ;[heap[p * 2], heap[c * 2]] = [heap[c * 2], heap[p * 2]]
      ;[heap[p * 2 + 1], heap[c * 2 + 1]] = [heap[c * 2 + 1], heap[p * 2 + 1]]
      c = p
    }
  }
  const pop = () => {
    const i = heap[1]
    const lastF = heap[heap.length - 2]
    const lastI = heap[heap.length - 1]
    heap.length -= 2
    if (heap.length) {
      heap[0] = lastF
      heap[1] = lastI
      let c = 0
      const size = heap.length / 2
      for (;;) {
        const l = c * 2 + 1
        const r = l + 1
        let m = c
        if (l < size && heap[l * 2] < heap[m * 2]) m = l
        if (r < size && heap[r * 2] < heap[m * 2]) m = r
        if (m === c) break
        ;[heap[m * 2], heap[c * 2]] = [heap[c * 2], heap[m * 2]]
        ;[heap[m * 2 + 1], heap[c * 2 + 1]] = [heap[c * 2 + 1], heap[m * 2 + 1]]
        c = m
      }
    }
    return i
  }
  cost[from] = 0
  push(h(from), from)
  const done = new Uint8Array(n)
  while (heap.length) {
    const i = pop()
    if (done[i]) continue
    done[i] = 1
    if (i === to) break
    for (const l of g.links[i]) {
      const on = g.nodes[l.to].on
      if (on !== undefined && mover.health?.[on] === 0) continue
      if ((l.kind === 'jump' || l.kind === 'jump2') && mover.jumpScale !== 1 && !jumpable(l.span ?? 0, l.need, mover.jumpScale, false) && !jumpable(l.span ?? 0, l.need, mover.jumpScale, true)) continue
      if (l.kind === 'jump2' && mover.jumpScale === 1 && !jumpable(l.span ?? 0, l.need, 1, true)) continue
      const c = cost[i] + l.cost
      if (c < cost[l.to]) {
        cost[l.to] = c
        prev[l.to] = i
        push(c + h(l.to), l.to)
      }
    }
  }
  if (prev[to] < 0) return undefined
  const path = [to]
  while (path[path.length - 1] !== from) path.push(prev[path[path.length - 1]])
  return path.reverse()
}

/** The link a route takes from one node to the next. */
export const linkOf = (g: NavGraph, from: number, to: number) => g.links[from].find((l) => l.to === to)

/** A route being followed: the nodes, and how far along it the hero is. */
export interface Route {
  path: number[]
  /** Index into `path` of the node being headed for. */
  at: number
}

/**
 * Steer along a route for one tick: the direction to walk and whether to press jump. The node being headed for is
 * reached once the hero stands near it. A jump starts from its node: a hero on the ground anywhere else (one that
 * missed a landing) goes back to it first; there it runs at the landing and jumps once it has the speed, a second
 * jump near the top of the first. In the air it eases off as it nears the landing, so a fast hero stops over a small
 * platform instead of flying past it. A zipline is caught by running and jumping under it. `speed` is the hero's jog.
 */
export function followRoute(g: NavGraph, hero: HeroState, route: Route, match: MatchState, speed: number): { x: number; z: number; jump: boolean } {
  const p = hero.position
  if (hero.zip || hero.mantle) return { x: 0, z: 0, jump: false }
  // arrived nodes are passed; a hero standing anywhere further along skips ahead
  while (route.at < route.path.length) {
    const n = g.nodes[route.path[route.at]]
    const d = Math.sqrt((n.x - p.x) * (n.x - p.x) + (n.z - p.z) * (n.z - p.z))
    if (d > 0.9 || Math.abs(p.y - n.y) > 0.6 || hero.airborne) break
    route.at++
  }
  if (route.at >= route.path.length) return { x: 0, z: 0, jump: false }
  const target = g.nodes[route.path[route.at]]
  const prev = route.at > 0 ? route.path[route.at - 1] : -1
  const link = prev >= 0 ? linkOf(g, prev, route.path[route.at]) : undefined
  let dx = target.x - p.x
  let dz = target.z - p.z
  let jump = false
  // landed on the far side's level already (short of its node): walk the rest
  const landed = !hero.airborne && Math.abs(p.y - target.y) < 0.3 && dx * dx + dz * dz < 9
  const kind = landed ? 'walk' : (link?.kind ?? 'walk')
  if (kind !== 'walk' && kind !== 'drop' && prev >= 0) {
    const from = g.nodes[prev]
    if (kind === 'zip' && link?.line !== undefined && match.lines) {
      // onto the line's track and along it toward the far end, at a point a little ahead of the hero
      const l = match.lines[link.line]
      const [hi, lo] = l.a.y >= l.b.y ? [l.a, l.b] : [l.b, l.a]
      const ux = lo.x - hi.x
      const uz = lo.z - hi.z
      const ul = Math.sqrt(ux * ux + uz * uz) || 1
      const t = Math.max(0, ((p.x - hi.x) * ux + (p.z - hi.z) * uz) / ul) + 1.5
      ;[dx, dz] = [hi.x + (ux / ul) * t - p.x, hi.z + (uz / ul) * t - p.z]
    }
    const len = Math.sqrt(dx * dx + dz * dz) || 1
    const off = Math.sqrt((from.x - p.x) * (from.x - p.x) + (from.z - p.z) * (from.z - p.z))
    if (!hero.airborne) {
      if (Math.abs(p.y - from.y) > 0.3 || off > 2.2) {
        // back to where the jump starts
        ;[dx, dz] = [from.x - p.x, from.z - p.z]
      } else {
        // fast enough to carry the gap in the time the arc is up, or already at the foot of the ledge
        const scale = M.jumpScale[hero.size]
        const carry = kind === 'zip' ? 0.6 * speed : Math.min(0.85 * speed, Math.max(2, ((link?.span ?? 0) - 1) / Math.max(0.3, hang(M.jump * scale, link?.need ?? 0))))
        // a double jump waits at the take-off for the stamina its second jump spends
        const ready = kind !== 'jump2' || hero.stamina >= 1
        jump = ready && ((hero.velocity.x * dx + hero.velocity.z * dz) / len >= carry || len <= bodyRadius(hero) + 1.6)
        if (!ready && off < 1) [dx, dz] = [0, 0]
      }
    }
    // the second jump goes near the top of the first, if a mantle can't finish it from there
    if (kind !== 'zip' && hero.airborne && hero.velocity.y < 1.5 && hero.velocity.y > -3 && hero.airJumps === 0 && hero.stamina >= 1 && !(hero.held & 1) && p.y + M.mantle.height - 0.3 < target.y) jump = true
  }
  const len = Math.sqrt(dx * dx + dz * dz)
  if (len < 1e-6) return { x: 0, z: 0, jump }
  // in the air, no faster than it can still stop in over the landing
  const ease = hero.airborne && kind !== 'zip' ? Math.max(0.15, Math.min(1, Math.sqrt(2 * M.airAccel * Math.max(0, len - 0.3)) / Math.max(1, speed))) : 1
  return { x: (dx / len) * ease, z: (dz / len) * ease, jump }
}
