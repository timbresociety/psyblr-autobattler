import type { Template } from '../../charter/types.js'
import { DT, ENGINE, ticks } from './calibration.js'
import { floorUnder } from './cover.js'
import { enemiesOf, type Ctx } from './effects.js'
import { KIT } from './kit-tuning.js'
import { add, cos, dot, length, normalize, scale, sin, sub, type Vec3 } from './maths.js'
import { capsule, type HeroState, type ProjectileState } from './state.js'

/**
 * How shots fly when they don't fly straight (GAME.md §4 LMB): lobbed, bouncing, returning, homing and guided. A shot
 * keeps its speed and only turns; a lobbed one falls. Pure vector arithmetic on plain state, so it stays deterministic.
 */

const chestOf = (h: HeroState): Vec3 => ({ x: h.position.x, y: h.position.y + capsule(h).height * ENGINE.chest, z: h.position.z })

/** `u` turned toward `w` (both unit vectors) by at most `angle` radians. */
export function turnToward(u: Vec3, w: Vec3, angle: number): Vec3 {
  const d = dot(u, w)
  if (d >= cos(angle)) return w
  const across = sub(w, scale(u, d))
  const n = length(across)
  // straight behind: turn about the vertical
  const side = n > 1e-6 ? scale(across, 1 / n) : normalize({ x: -u.z, y: 0, z: u.x })
  return normalize(add(scale(u, cos(angle)), scale(side, sin(angle))))
}

/**
 * Where a shot fired from `from` at `target` starts, for its template's flight: a lobbed one thrown along an upward aim,
 * or, aimed level or down at a point, thrown up to come down on it (no steeper than KIT.flight.steepest), a homing one locked on the enemy the crosshair covers or the
 * nearest within KIT.flight.lock degrees of the aim. Returns the first step (metres a tick), the ticks it may fly and
 * its flight state; undefined for a straight shot.
 */
export function startFlight(ctx: Ctx, shooter: HeroState, template: Template, from: Vec3, dir: Vec3, speed: number, aimed?: Vec3): { step: Vec3; ticksLeft: number; flight: NonNullable<ProjectileState['flight']> } | undefined {
  const d = template.delivery
  const kind = d.flight
  if (!kind || kind === 'straight') return undefined
  const range = d.range
  const perTick = speed / ENGINE.tickHz
  const straight = { step: scale(dir, perTick), ticksLeft: Math.max(1, ticks(range / speed)) }
  switch (kind) {
    case 'lobbed': {
      const g = KIT.flight.gravity
      // aimed up, it's thrown along the aim and falls where that takes it: aim higher to throw further
      if (!aimed || aimed.y > from.y + 0.5) return { step: scale(dir, perTick), ticksLeft: ticks(6), flight: { kind, fall: g } }
      // aimed level or down at a spot, it's thrown to come down on it
      const to = aimed
      const dx = to.x - from.x
      const dz = to.z - from.z
      const across = Math.sqrt(dx * dx + dz * dz)
      const time = Math.max(0.2, across / speed)
      let vy = (to.y - from.y) / time + (g * time) / 2
      vy = Math.min(vy, speed * KIT.flight.steepest + Math.max(0, (to.y - from.y) / time))
      const h = across > 1e-6 ? { x: (dx / across) * speed, z: (dz / across) * speed } : { x: dir.x * speed, z: dir.z * speed }
      return { step: { x: h.x / ENGINE.tickHz, y: vy / ENGINE.tickHz, z: h.z / ENGINE.tickHz }, ticksLeft: ticks(time) + ticks(3), flight: { kind, fall: g } }
    }
    case 'bouncing':
      return { ...straight, ticksLeft: straight.ticksLeft * 2, flight: { kind, bounces: d.bounces ?? KIT.flight.bounces } }
    case 'returning':
      return { ...straight, flight: { kind, struck: [] } }
    case 'homing': {
      let target: HeroState | undefined
      let best = cos((KIT.flight.lock * Math.PI) / 180)
      for (const e of enemiesOf(ctx.match, shooter)) {
        const to = sub(chestOf(e), from)
        const far = length(to)
        if (far > range || far < 1e-6) continue
        const c = dot(dir, scale(to, 1 / far))
        if (c > best) ((best = c), (target = e))
      }
      return { ...straight, ticksLeft: Math.ceil(straight.ticksLeft * 1.5), flight: { kind, ...(target ? { target: target.id } : {}) } }
    }
    case 'guided':
      return { ...straight, ticksLeft: Math.ceil(straight.ticksLeft * 1.5), flight: { kind } }
  }
}

/**
 * Turn a shot for this tick before it moves: a lobbed one falls, a homing one turns toward its target, a guided one
 * toward where its owner aims now (`aimNow`), and a returning one, on its way back, toward its owner. Returns false
 * when a returning shot has reached its owner's hand.
 */
export function steer(ctx: Ctx, p: ProjectileState, aimNow: (owner: HeroState) => Vec3): boolean {
  const f = p.flight
  if (!f) return true
  const owner = ctx.match.heroes[p.owner]
  const speed = length(p.step)
  const heading = speed > 1e-9 ? scale(p.step, 1 / speed) : { x: 0, y: 0, z: 1 }
  const toward = (at: Vec3, rate: number) => {
    const to = sub(at, p.position)
    const far = length(to)
    if (far < 1e-6) return
    p.step = scale(turnToward(heading, scale(to, 1 / far), rate * DT), speed)
  }
  switch (f.kind) {
    case 'lobbed':
      p.step = { ...p.step, y: p.step.y - (f.fall ?? KIT.flight.gravity) * DT * DT }
      return true
    case 'homing': {
      const t = f.target !== undefined ? ctx.match.heroes[f.target] : undefined
      if (t?.alive && !t.downed) toward(chestOf(t), KIT.flight.homing)
      return true
    }
    case 'guided':
      if (owner.alive) toward(aimNow(owner), KIT.flight.guided)
      return true
    case 'returning': {
      if (!f.back) return true
      if (!owner.alive) return false
      const hand = chestOf(owner)
      if (length(sub(hand, p.position)) <= speed + capsule(owner).radius) return false
      // a returning shot comes straight home
      p.step = scale(normalize(sub(hand, p.position)), speed)
      p.ticksLeft = Math.max(p.ticksLeft, 2)
      return true
    }
    default:
      return true
  }
}

/** A bouncing shot that struck cover at `at` turns off the face it struck, and loses a bounce. */
export function bounceOffCover(ctx: Ctx, p: ProjectileState, index: number, at: Vec3) {
  const piece = ctx.match.cover!.pieces[index]
  const s = piece.shape
  let n: Vec3
  if (at.y >= piece.top - 0.05) n = { x: 0, y: 1, z: 0 }
  else if (s.kind === 'column') n = normalize({ x: at.x - s.x, y: 0, z: at.z - s.z })
  else {
    const ox = Math.abs(at.x - s.x) - s.hx
    const oz = Math.abs(at.z - s.z) - s.hz
    n = ox > oz ? { x: Math.sign(at.x - s.x) || 1, y: 0, z: 0 } : { x: 0, y: 0, z: Math.sign(at.z - s.z) || 1 }
  }
  reflect(p, n, at)
  ctx.events.push({ type: 'flight', id: p.id, what: 'bounce', at })
}

/** A bouncing shot that reached the floor bounces off it, losing some of its fall. */
export function bounceOffFloor(ctx: Ctx, p: ProjectileState, at: Vec3) {
  reflect(p, { x: 0, y: 1, z: 0 }, at)
  p.step = { ...p.step, y: p.step.y * 0.6 }
  ctx.events.push({ type: 'flight', id: p.id, what: 'bounce', at })
}

function reflect(p: ProjectileState, n: Vec3, at: Vec3) {
  p.step = sub(p.step, scale(n, 2 * dot(p.step, n)))
  p.position = add(at, scale(n, 0.05))
  if (p.flight?.bounces !== undefined) p.flight.bounces--
}

/** The floor under a shot's path this tick, when it passed down through it: the point it met it. */
export function throughFloor(ctx: Ctx, from: Vec3, to: Vec3): Vec3 | undefined {
  if (to.y >= from.y) return undefined
  const cover = ctx.match.cover
  const floor = cover ? floorUnder(cover.pieces, cover.health, to, from.y) : 0
  if (to.y > floor) return undefined
  const t = (from.y - floor) / Math.max(1e-9, from.y - to.y)
  return { x: from.x + (to.x - from.x) * t, y: floor, z: from.z + (to.z - from.z) * t }
}

/** A returning shot turns back for its owner: at the end of its reach, or off the first wall it meets. */
export function turnHome(ctx: Ctx, p: ProjectileState) {
  if (!p.flight || p.flight.back) return
  p.flight.back = true
  p.flight.struck = []
  p.ticksLeft = Math.max(p.ticksLeft, 600)
  ctx.events.push({ type: 'flight', id: p.id, what: 'return', at: { ...p.position } })
}
