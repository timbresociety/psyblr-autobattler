import type { BuildSlot, Effect, Template } from '../../charter/types.js'
import { DT, ENGINE, ticks } from './calibration.js'
import { coverHit, floorUnder, type MapLine } from './cover.js'
import { displace, resolve, type Ctx } from './effects.js'
import { KIT } from './kit-tuning.js'
import { keepOut, ledgeAhead, moveSpeed, standOn, traverseHook, wallFace } from './locomotion.js'
import { cos, direction, dot, normalize, sin, sub, type Vec3 } from './maths.js'
import { knockDown } from './moveset.js'
import { teamUpLands } from './systems.js'
import { MOVES, capsule, standing, type Command, type HeroSetup, type HeroState, type MatchState } from './state.js'

/**
 * The E row's ways of moving (GAME.md §4 E, the `traverse` effect): teleport, swap, a homing dash, a swing, flight, a
 * glide, crawling up walls, burrowing, riding an ally, and the four shared moves done better (Wall Run, Combat Roll,
 * Power Slide, Zipline). The held ones take a hero's movement over for a while (`hero.traverse`, through
 * `traverseHook`); the moving ones carry it with a skill's travel or put it somewhere at once.
 */

type Traverse = Extract<Effect, { kind: 'traverse' }>
const T = KIT.traverse
const M = ENGINE.move

const chest = (h: HeroState): Vec3 => ({ x: h.position.x, y: h.position.y + capsule(h).height * ENGINE.chest, z: h.position.z })
const eye = (h: HeroState): Vec3 => ({ x: h.position.x, y: h.position.y + capsule(h).height * 0.9, z: h.position.z })
const aimOf = (h: HeroState) => direction(h.yaw, h.pitch)
const floorAt = (m: MatchState, p: Vec3, reach = p.y + M.step) => (m.cover ? floorUnder(m.cover.pieces, m.cover.health, p, reach) : 0)

/** The hero the crosshair covers within `range` and `degrees` of the aim (enemies when `enemy`, else anyone), nearest the aim first. */
function underAim(m: MatchState, hero: HeroState, range: number, degrees: number, enemy?: boolean): HeroState | undefined {
  const from = eye(hero)
  const dir = aimOf(hero)
  let best = cos((degrees * Math.PI) / 180)
  let found: HeroState | undefined
  for (const o of m.heroes) {
    if (o === hero || !standing(o) || (enemy && o.team === hero.team) || o.stealthUntil > m.tick) continue
    const to = sub(chest(o), from)
    const far = Math.sqrt(dot(to, to))
    if (far > range || far < 1e-6) continue
    const c = dot(dir, { x: to.x / far, y: to.y / far, z: to.z / far })
    if (c <= best) continue
    if (m.cover && coverHit(m.cover.pieces, m.cover.health, from, chest(o))) continue
    best = c
    found = o
  }
  return found
}

/** Where the aim meets cover within `range`, or undefined when it meets none. */
function aimedWall(m: MatchState, hero: HeroState, range: number): Vec3 | undefined {
  if (!m.cover) return undefined
  const from = eye(hero)
  const dir = aimOf(hero)
  const to = { x: from.x + dir.x * range, y: from.y + dir.y * range, z: from.z + dir.z * range }
  const hit = coverHit(m.cover.pieces, m.cover.health, from, to)
  return hit ? { x: from.x + (to.x - from.x) * hit.t, y: from.y + (to.y - from.y) * hit.t, z: from.z + (to.z - from.z) * hit.t } : undefined
}

/** The way a hero steers (or, with no command, runs), flat and unit, or the way it faces when it does neither. */
function steerOf(hero: HeroState, command?: Command): { x: number; z: number } {
  const mx = command ? command.moveX : hero.velocity.x
  const mz = command ? command.moveZ : hero.velocity.z
  const n = Math.sqrt(mx * mx + mz * mz)
  return n > (command ? 0.1 : 0.5) ? { x: mx / n, z: mz / n } : { x: sin(hero.yaw), z: cos(hero.yaw) }
}

/** Carry a hero along a straight line over `seconds` with a skill's travel, landing nothing (or the rest of the skill) on arrival. */
function carry(ctx: Ctx, hero: HeroState, to: Vec3, seconds: number, slot: BuildSlot, land: 'none' | 'rest', target?: number) {
  const now = ctx.match.tick
  const p = hero.position
  hero.travel = { from: now, until: now + Math.max(1, ticks(seconds)), x0: p.x, y0: p.y, z0: p.z, x1: to.x, y1: to.y, z1: to.z, arc: 0, startY: p.y, slot, recovery: 0, land, ...(target !== undefined ? { target } : {}) }
  hero.roll = undefined
  hero.slide = undefined
}

/** A straight run of `metres` along flat (x, z), stopped short of the first wall in the way. */
function runTo(m: MatchState, hero: HeroState, dx: number, dz: number, metres: number): Vec3 {
  const p = hero.position
  let t = 1
  if (m.cover)
    for (const lift of [0.1, capsule(hero).height / 2]) {
      const hit = coverHit(m.cover.pieces, m.cover.health, { ...p, y: p.y + lift }, { x: p.x + dx * metres, y: p.y + lift, z: p.z + dz * metres }, capsule(hero).radius)
      if (hit && hit.t < t) t = hit.t
    }
  const far = Math.max(0, metres * t - 0.1)
  return { x: p.x + dx * far, y: p.y, z: p.z + dz * far }
}

/** Put a hero down on the floor under `at`, out of any cover it landed in. */
function placeAt(m: MatchState, hero: HeroState, at: Vec3) {
  hero.position = { x: at.x, y: Math.max(at.y, floorAt(m, at, at.y + 1)), z: at.z }
  hero.velocity = { x: 0, y: 0, z: 0 }
  keepOut(hero, m)
  standOn(hero, m, hero.position.y)
}

export function startTraverse(ctx: Ctx, hero: HeroState, template: Template, slot: BuildSlot, e: Traverse) {
  const m = ctx.match
  const now = m.tick
  const until = now + ticks(e.duration)
  const say = (move: 'teleport' | 'swap' | 'homing' | 'swing' | 'flight' | 'glide' | 'wall-crawl' | 'burrow' | 'ride' | 'roll' | 'power-slide' | 'zip-on') => ctx.events.push({ type: 'move', hero: hero.id, move })
  switch (e.how) {
    case 'teleport': {
      // behind the hero the crosshair covers, or to where the aim meets the world
      const o = underAim(m, hero, e.distance, T.lock)
      if (o) {
        const back = capsule(o).radius + capsule(hero).radius + 0.4
        placeAt(m, hero, { x: o.position.x - sin(o.yaw) * back, y: o.position.y, z: o.position.z - cos(o.yaw) * back })
        hero.yaw = o.yaw
      } else {
        const wall = aimedWall(m, hero, e.distance)
        const d = aimOf(hero)
        const at = wall ? { x: wall.x - d.x * 0.6, y: wall.y, z: wall.z - d.z * 0.6 } : { x: hero.position.x + d.x * e.distance, y: hero.position.y + Math.max(0, d.y * e.distance), z: hero.position.z + d.z * e.distance }
        placeAt(m, hero, { ...at, y: Math.max(0, at.y - capsule(hero).height * 0.9) })
      }
      return say('teleport')
    }
    case 'swap': {
      const o = underAim(m, hero, e.distance, T.lock)
      if (!o || (o.team !== hero.team && o.unstoppableUntil > now)) return
      const mine = { ...hero.position }
      hero.position = { ...o.position }
      o.position = mine
      o.knockback = undefined
      for (const h of [hero, o]) (keepOut(h, m), standOn(h, m, h.position.y))
      return say('swap')
    }
    case 'homing': {
      // onto the enemy the crosshair is near, its blow landing there; straight ahead when there is none
      const o = underAim(m, hero, e.distance, T.homingLock, true)
      if (!o) {
        const s = steerOf(hero)
        carry(ctx, hero, runTo(m, hero, s.x, s.z, e.distance), e.distance / M.travel.dash, slot, 'none')
        return say('homing')
      }
      const dx = o.position.x - hero.position.x
      const dz = o.position.z - hero.position.z
      const flat = Math.sqrt(dx * dx + dz * dz) || 1
      const stop = capsule(o).radius + capsule(hero).radius + 0.3
      const to = { x: o.position.x - (dx / flat) * stop, y: o.position.y, z: o.position.z - (dz / flat) * stop }
      carry(ctx, hero, to, Math.max(M.travel.least, (flat - stop) / M.travel.dash), slot, 'rest', o.id)
      return say('homing')
    }
    case 'swing': {
      // from where the aim meets the world, or a point up ahead when it meets nothing
      const d = aimOf(hero)
      const anchor = aimedWall(m, hero, e.distance) ?? { x: hero.position.x + d.x * e.distance * 0.6, y: hero.position.y + e.distance * 0.6, z: hero.position.z + d.z * e.distance * 0.6 }
      const grip = { ...hero.position, y: hero.position.y + capsule(hero).height }
      const r = sub(grip, anchor)
      const len = Math.sqrt(dot(r, r))
      if (anchor.y < grip.y + 1 || len < 2) return
      hero.traverse = { how: 'swing', from: now, until, slot, anchor, len }
      hero.airborne = true
      hero.velocity = { x: hero.velocity.x + d.x * T.swingKick, y: Math.max(hero.velocity.y, 0), z: hero.velocity.z + d.z * T.swingKick }
      return say('swing')
    }
    case 'flight':
      hero.traverse = { how: 'flight', from: now, until, slot }
      hero.airborne = true
      hero.velocity.y = Math.max(hero.velocity.y, T.flightRise)
      return say('flight')
    case 'glide':
      hero.traverse = { how: 'glide', from: now, until, slot }
      // from the ground it hops up first
      if (!hero.airborne) ((hero.velocity.y = Math.sqrt(2 * M.gravity * M.jump * M.jumpScale[hero.size])), (hero.airborne = true))
      return say('glide')
    case 'wallCrawl':
      hero.traverse = { how: 'wallCrawl', from: now, until, slot }
      return say('wall-crawl')
    case 'burrow':
      hero.traverse = { how: 'burrow', from: now, until, slot }
      hero.invulnerableUntil = Math.max(hero.invulnerableUntil, until)
      hero.stealthUntil = Math.max(hero.stealthUntil, until)
      hero.stance = 'prone'
      return say('burrow')
    case 'ride': {
      let ally: HeroState | undefined
      let best = e.distance
      for (const o of m.heroes) {
        if (o === hero || o.team !== hero.team || !standing(o) || o.traverse?.how === 'ride') continue
        const d = Math.sqrt((o.position.x - hero.position.x) * (o.position.x - hero.position.x) + (o.position.z - hero.position.z) * (o.position.z - hero.position.z))
        if (d <= best) ((best = d), (ally = o))
      }
      if (!ally) return
      hero.traverse = { how: 'ride', from: now, until, slot, ally: ally.id }
      return say('ride')
    }
    case 'wallRun':
      hero.anyWallUntil = until
      return
    case 'combatRoll': {
      // the roll the way it steers, untouchable all the way, its gun reloaded as it comes up
      const s = steerOf(hero)
      carry(ctx, hero, runTo(m, hero, s.x, s.z, e.distance), T.rollTime, slot, 'none')
      hero.roll = { from: now, until: hero.travel!.until, x: s.x, z: s.z }
      hero.invulnerableUntil = Math.max(hero.invulnerableUntil, hero.travel!.until)
      hero.ammo = Math.max(hero.ammo, ctx.setups[hero.id].magazine)
      hero.reloadUntil = 0
      return say('roll')
    }
    case 'powerSlide': {
      const s = steerOf(hero)
      carry(ctx, hero, runTo(m, hero, s.x, s.z, e.distance), e.distance / T.slideSpeed, slot, 'none')
      hero.slide = { from: now, until: hero.travel!.until, x: s.x, z: s.z }
      hero.traverse = { how: 'powerSlide', from: now, until: hero.travel!.until, slot, struck: [] }
      return say('power-slide')
    }
    case 'zipline': {
      // a line from its hand to where the aim meets the world (or as far as it reaches), ridden at once
      const d = aimOf(hero)
      const a = { ...hero.position, y: hero.position.y + capsule(hero).height + M.zip.hang }
      const wall = aimedWall(m, hero, e.distance)
      const b = wall ? { x: wall.x - d.x * 0.5, y: wall.y, z: wall.z - d.z * 0.5 } : { x: a.x + d.x * e.distance, y: a.y + d.y * e.distance, z: a.z + d.z * e.distance }
      const line: MapLine = { kind: 'zip', a, b }
      m.lines = [...(m.lines ?? []), line]
      ;(m.ownLines ??= []).push({ index: m.lines.length - 1, until: now + ticks(Math.max(e.duration, 3)) })
      hero.zip = { line: m.lines.length - 1, t: 0.001, dir: 1, hang: true }
      hero.airJumps = 0
      hero.travel = undefined
      ctx.events.push({ type: 'line', index: m.lines.length - 1, owner: hero.id, phase: 'up', a, b })
      return say('zip-on')
    }
  }
}

const rests = new WeakMap<Template, Template>()
/** The rest of a traverse skill: what it lands once the move is done. */
const restOf = (t: Template): Template => {
  let r = rests.get(t)
  if (!r) rests.set(t, (r = { ...t, effects: t.effects.filter((e) => e.kind !== 'traverse') }))
  return r
}

/** A traverse skill's travel has arrived: a homing dash lands the rest of its skill on its target, if it's in reach. */
export function arrive(ctx: Ctx, hero: HeroState, tr: NonNullable<HeroState['travel']>) {
  if (tr.land === 'teamup') return teamUpLands(ctx, hero)
  if (tr.land !== 'rest') return
  const template = ctx.setups[hero.id].kit[tr.slot]
  const o = tr.target !== undefined ? ctx.match.heroes[tr.target] : undefined
  const reach = o ? capsule(o).radius + capsule(hero).radius + 1.2 : 0
  const near = o && standing(o) && Math.sqrt((o.position.x - hero.position.x) * (o.position.x - hero.position.x) + (o.position.z - hero.position.z) * (o.position.z - hero.position.z)) <= reach
  resolve(ctx, hero, restOf(template), tr.slot, near ? [o] : [], o ? chest(o) : chest(hero))
}

/** One tick of a held traverse in place of walking. Returns false when the hero walks as usual this tick. */
traverseHook.move = (hero: HeroState, setup: HeroSetup, command: Command, match: MatchState, pressed: number) => {
  const tr = hero.traverse!
  const now = match.tick
  const v = hero.velocity
  const p = hero.position
  const speed = moveSpeed(hero, setup)
  const mx = command.moveX
  const mz = command.moveZ
  const steering = Math.sqrt(mx * mx + mz * mz) > 0.1
  const controlled = hero.stunnedUntil <= now && hero.cc.root <= now && hero.cc.grounded <= now && !hero.launch
  if (!controlled && tr.how !== 'ride' && tr.how !== 'powerSlide') {
    hero.traverse = undefined
    return false
  }
  switch (tr.how) {
    case 'flight': {
      // flies the way it steers; jump held climbs, crouch held sinks, neither hovers
      const fast = speed * T.flightSpeed
      v.x = steering ? mx * fast : v.x * 0.85
      v.z = steering ? mz * fast : v.z * 0.85
      v.y = command.moves & MOVES.jump ? T.flightRise : command.moves & MOVES.crouch ? -T.flightRise : 0
      p.x += v.x * DT
      p.y += v.y * DT
      p.z += v.z * DT
      hero.airborne = true
      keepOut(hero, match)
      const floor = floorAt(match, p)
      if (p.y < floor) p.y = floor
      return true
    }
    case 'glide': {
      if (!hero.airborne && now > tr.from + 2) return void (hero.traverse = undefined), false
      // a slow fall, carried forward the way it steers
      const s = steerOf(hero, command)
      const fast = speed * T.glideSpeed
      v.x += (s.x * fast - v.x) * Math.min(1, DT * 3)
      v.z += (s.z * fast - v.z) * Math.min(1, DT * 3)
      v.y = Math.max(v.y - M.gravity * DT, -T.glideSink)
      const was = p.y
      p.x += v.x * DT
      p.y += v.y * DT
      p.z += v.z * DT
      keepOut(hero, match)
      if (v.y <= 0) standOn(hero, match, was)
      if (!hero.airborne) hero.traverse = undefined
      return true
    }
    case 'swing': {
      // a pendulum on the line: gravity, a little steering, and the line taut at its length
      const s = steerOf(hero, command)
      if (steering) ((v.x += s.x * T.swingPull * DT), (v.z += s.z * T.swingPull * DT))
      v.y -= M.gravity * DT
      p.x += v.x * DT
      p.y += v.y * DT
      p.z += v.z * DT
      const grip = { x: p.x, y: p.y + capsule(hero).height, z: p.z }
      const r = sub(grip, tr.anchor!)
      const d = Math.sqrt(dot(r, r))
      if (d > tr.len!) {
        const n = normalize(r)
        p.x = tr.anchor!.x + n.x * tr.len!
        p.y = tr.anchor!.y + n.y * tr.len! - capsule(hero).height
        p.z = tr.anchor!.z + n.z * tr.len!
        const out = dot(v, n)
        if (out > 0) ((v.x -= n.x * out), (v.y -= n.y * out), (v.z -= n.z * out))
      }
      keepOut(hero, match)
      hero.airborne = true
      const floor = floorAt(match, p)
      // a jump lets go, flung on with its speed; the ground or the time ends it too
      if (pressed & MOVES.jump) v.y = Math.max(v.y, 0) + T.swingRelease
      if (pressed & MOVES.jump || p.y <= floor || now >= tr.until) {
        if (p.y <= floor) p.y = floor
        hero.traverse = undefined
        standOn(hero, match, p.y)
      }
      return true
    }
    case 'wallCrawl': {
      if (!match.cover || !steering) return false
      const face = wallFace(hero, match, true)
      // pushed into a wall it climbs it, and over the top onto it
      if (!face || mx * -face.nx + mz * -face.nz < 0.3) return false
      const ledge = ledgeAhead(hero, match, -face.nx, -face.nz)
      if (ledge && ledge.y - p.y <= capsule(hero).height * 0.6) {
        hero.position = { ...ledge }
        hero.velocity = { x: 0, y: 0, z: 0 }
        hero.airborne = false
        return true
      }
      v.x = 0
      v.z = 0
      v.y = speed * T.climb
      p.y += v.y * DT
      hero.airborne = true
      return true
    }
    case 'burrow':
      // underground it goes the way it steers, a little quicker than it walks
      hero.stance = 'prone'
      v.x = steering ? mx * speed * T.burrowSpeed : 0
      v.z = steering ? mz * speed * T.burrowSpeed : 0
      p.x += v.x * DT
      p.z += v.z * DT
      keepOut(hero, match)
      standOn(hero, match, p.y + M.step)
      return true
    case 'ride': {
      const ally = match.heroes[tr.ally!]
      if (pressed & MOVES.jump || !standing(ally)) {
        hero.traverse = undefined
        hero.airborne = true
        v.y = Math.sqrt(2 * M.gravity * M.jump * M.jumpScale[hero.size])
        return true
      }
      // up on its shoulders, carried wherever it goes
      p.x = ally.position.x - sin(ally.yaw) * 0.15
      p.z = ally.position.z - cos(ally.yaw) * 0.15
      p.y = ally.position.y + capsule(ally).height * T.rideHeight
      hero.velocity = { ...ally.velocity }
      hero.airborne = false
      return true
    }
    default:
      return false
  }
}

/** Once a tick after everyone moved: held moves running out, a burrow coming up, a power slide bowling over whoever it meets, and lines coming down. */
export function tickTraverse(ctx: Ctx) {
  const m = ctx.match
  const now = m.tick
  for (const h of m.heroes) {
    const tr = h.traverse
    if (!tr) continue
    if (!h.alive || h.downed) {
      h.traverse = undefined
      continue
    }
    if (tr.how === 'powerSlide') {
      for (const o of m.heroes) {
        if (o.team === h.team || !standing(o) || tr.struck!.includes(o.id) || o.unstoppableUntil > now) continue
        const dx = o.position.x - h.position.x
        const dz = o.position.z - h.position.z
        if (Math.sqrt(dx * dx + dz * dz) > capsule(o).radius + capsule(h).radius + 0.3 || Math.abs(o.position.y - h.position.y) > 1) continue
        tr.struck!.push(o.id)
        resolve(ctx, h, restOf(ctx.setups[h.id].kit[tr.slot]), tr.slot, [o], chest(o))
        if (o.alive && !o.downed) knockDown(ctx, o)
      }
      if (!h.travel) h.traverse = undefined
      continue
    }
    if (now < tr.until) continue
    h.traverse = undefined
    if (tr.how === 'burrow') {
      // it comes up under whoever is over it: the rest of the skill lands on them
      h.stance = 'stand'
      const template = ctx.setups[h.id].kit[tr.slot]
      const radius = template.delivery.radius ?? 2.5
      const over = m.heroes.filter((o) => o.team !== h.team && standing(o) && Math.sqrt((o.position.x - h.position.x) * (o.position.x - h.position.x) + (o.position.z - h.position.z) * (o.position.z - h.position.z)) <= radius)
      resolve(ctx, h, restOf(template), tr.slot, over, { ...h.position })
      for (const o of over) displace(ctx, h, o, template, 2)
      ctx.events.push({ type: 'move', hero: h.id, move: 'emerge' })
    }
  }
  if (m.ownLines?.length && m.lines) {
    m.ownLines = m.ownLines.filter((l) => {
      if (now < l.until) return true
      const line = m.lines![l.index]
      // a spent line folds to nothing where it was hung, so no index moves
      m.lines = m.lines!.map((x, i) => (i === l.index ? { ...x, b: { ...x.a } } : x))
      for (const h of m.heroes) if (h.zip?.line === l.index) h.zip = undefined
      ctx.events.push({ type: 'line', index: l.index, owner: -1, phase: 'down', a: line.a, b: line.b })
      return false
    })
  }
}
