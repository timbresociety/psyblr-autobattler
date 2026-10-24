import type { BuildSlot, Effect, Template } from '../../charter/types.js'
import { ENGINE, ticks } from './calibration.js'
import type { CoverPiece } from './cover.js'
import { coverHit } from './cover.js'
import { dealDamage, enemiesOf, resolve, world, type Area, type Ctx } from './effects.js'
import { keepOut } from './locomotion.js'
import { distance, type Vec3 } from './maths.js'
import { capsule, type HeroState, type MatchState } from './state.js'

/**
 * Things skills raise in the world (the skill library's zones, terrain and constructs): lingering fields, traps,
 * walls that are real cover, and turrets. All plain match state, ticked in a fixed order, so matches stay
 * deterministic and snapshot like everything else.
 */

const nextId = (m: MatchState) => (m.nextEntityId = (m.nextEntityId ?? 1) + 1) - 1
const ground = (at: Vec3): Vec3 => ({ x: at.x, y: 0, z: at.z })
const chestOf = (h: HeroState): Vec3 => ({ x: h.position.x, y: h.position.y + capsule(h).height * ENGINE.chest, z: h.position.z })

/** Enemies of `owner` standing in a disc on the floor: within `radius` across, and low enough to be in it. */
function inside(m: MatchState, owner: HeroState, area: Area): HeroState[] {
  return enemiesOf(m, owner).filter((e) => {
    const dx = e.position.x - area.at.x
    const dz = e.position.z - area.at.z
    return Math.sqrt(dx * dx + dz * dz) <= area.radius + capsule(e).radius && e.position.y <= area.at.y + ENGINE.fieldHeight
  })
}

const templateOf = (ctx: Ctx, owner: number, slot: BuildSlot): Template => ctx.setups[owner].kit[slot]

world.field = (ctx, caster, template, slot, at, e) => {
  const m = ctx.match
  const radius = template.delivery.radius ?? 2
  const follow = template.delivery.kind === 'aura' || template.delivery.kind === 'self'
  const field = { id: nextId(m), owner: caster.id, slot, at: ground(follow ? caster.position : at), radius, until: m.tick + ticks(e.duration), next: m.tick + ticks(e.interval), interval: Math.max(1, ticks(e.interval)), trap: false, follow }
  ;(m.fields ??= []).push(field)
  ctx.events.push({ type: 'field', id: field.id, owner: caster.id, slot, phase: 'start', at: field.at, radius, trap: false })
}

world.trap = (ctx, caster, template, slot, at, e) => {
  const m = ctx.match
  const radius = template.delivery.radius ?? 1.5
  const trap = { id: nextId(m), owner: caster.id, slot, at: ground(at), radius, until: m.tick + ticks(e.lifetime), next: m.tick + ticks(e.arm), interval: 0, trap: true, follow: false }
  ;(m.fields ??= []).push(trap)
  ctx.events.push({ type: 'field', id: trap.id, owner: caster.id, slot, phase: 'start', at: trap.at, radius, trap: true })
}

/**
 * A wall across the caster's aim at the landing point. The ruins' cover is axis-aligned boxes, so the wall runs along
 * whichever axis is nearer square to the aim. It joins the cover: it blocks movement, sight and shots, and breaks.
 */
world.wall = (ctx, caster, at, e) => {
  const m = ctx.match
  if (!m.cover) m.cover = { pieces: [], health: [] }
  const ax = Math.abs(at.x - caster.position.x)
  const az = Math.abs(at.z - caster.position.z)
  const acrossX = az >= ax
  const half = e.length / 2
  const piece: CoverPiece = { shape: { kind: 'block', x: at.x, z: at.z, hx: acrossX ? half : 0.35, hz: acrossX ? 0.35 : half }, base: 0, top: e.height, look: 'barricade', health: e.health }
  // a new array, so the cover's cached bounds are rebuilt for it
  m.cover = { pieces: [...m.cover.pieces, piece], health: [...m.cover.health, e.health] }
  const index = m.cover.pieces.length - 1
  ;(m.walls ??= []).push({ index, until: m.tick + ticks(e.duration) })
  // anyone standing where it rose is pushed out to its side
  for (const h of m.heroes) if (h.alive) keepOut(h, m)
  const s = piece.shape as Extract<CoverPiece['shape'], { kind: 'block' }>
  ctx.events.push({ type: 'wall', index, owner: caster.id, phase: 'up', at: ground(at), hx: s.hx, hz: s.hz, top: e.height })
}

world.turret = (ctx, caster, _template, slot, at, e) => {
  const m = ctx.match
  const turret = { id: nextId(m), owner: caster.id, slot, at: ground(at), until: m.tick + ticks(e.duration), next: m.tick + ticks(e.interval), interval: Math.max(1, ticks(e.interval)), range: e.range }
  ;(m.turrets ??= []).push(turret)
  ctx.events.push({ type: 'turret', id: turret.id, owner: caster.id, phase: 'start', at: turret.at })
}

/** The turret's own shot: the template's turret effect, at its owner's numbers. */
function turretShot(ctx: Ctx, owner: number, slot: BuildSlot) {
  const e = templateOf(ctx, owner, slot).effects.find((x): x is Extract<Effect, { kind: 'turret' }> => x.kind === 'turret')
  if (!e) return undefined
  return { amount: e.amount + e.ratio * ctx.setups[owner].sheet[e.scaling], type: e.type }
}

/** Run everything skills raised, once per tick after heroes act: knock-ups, fields, traps, turrets and walls. */
export function tickWorld(ctx: Ctx) {
  const m = ctx.match
  const now = m.tick
  // knock-ups: a parabola up and back down, no trig in the engine
  for (const h of m.heroes) {
    const l = h.launch
    if (!l) continue
    const t = Math.min(1, (now - l.from) / Math.max(1, l.until - l.from))
    h.position.y = l.base + 4 * l.height * t * (1 - t)
    if (now >= l.until || !h.alive) {
      h.position.y = l.base
      if (l.base <= 0) {
        h.airborne = false
        h.landedAt = now
      }
      h.launch = undefined
    }
  }
  if (m.fields?.length) {
    const left: NonNullable<MatchState['fields']> = []
    for (const f of m.fields) {
      const owner = m.heroes[f.owner]
      if (f.follow && owner.alive) f.at = ground(owner.position)
      const area = { at: f.at, radius: f.radius }
      if (f.trap) {
        const caught = now >= f.next && now < f.until ? inside(m, owner, area) : []
        if (caught.length) resolve(ctx, owner, templateOf(ctx, f.owner, f.slot), f.slot, caught, f.at, area)
        if (caught.length || now >= f.until) {
          ctx.events.push({ type: 'field', id: f.id, owner: f.owner, slot: f.slot, phase: 'end', at: f.at, radius: f.radius, trap: true, sprung: caught.length > 0 })
          continue
        }
      } else {
        // a field lands on every beat up to and including its last tick, then it's gone
        if (now >= f.next && f.next <= f.until) {
          f.next += f.interval
          resolve(ctx, owner, templateOf(ctx, f.owner, f.slot), f.slot, inside(m, owner, area), f.at, area)
          ctx.events.push({ type: 'field', id: f.id, owner: f.owner, slot: f.slot, phase: 'pulse', at: f.at, radius: f.radius, trap: false })
        }
        if (now >= f.until) {
          ctx.events.push({ type: 'field', id: f.id, owner: f.owner, slot: f.slot, phase: 'end', at: f.at, radius: f.radius, trap: false })
          continue
        }
      }
      left.push(f)
    }
    m.fields = left
  }
  if (m.turrets?.length) {
    const left: NonNullable<MatchState['turrets']> = []
    for (const t of m.turrets) {
      const owner = m.heroes[t.owner]
      if (now >= t.until) {
        ctx.events.push({ type: 'turret', id: t.id, owner: t.owner, phase: 'end', at: t.at })
        continue
      }
      if (now >= t.next) {
        t.next += t.interval
        const muzzle = { x: t.at.x, y: 1.4, z: t.at.z }
        // the nearest enemy it can see, and that isn't hidden in stealth
        let target: HeroState | undefined
        let best = Infinity
        for (const e of enemiesOf(m, owner)) {
          const d = distance(muzzle, chestOf(e))
          if (d > t.range || d >= best || e.stealthUntil > now) continue
          if (m.cover && coverHit(m.cover.pieces, m.cover.health, muzzle, chestOf(e))) continue
          target = e
          best = d
        }
        const shot = turretShot(ctx, t.owner, t.slot)
        if (target && shot) {
          ctx.events.push({ type: 'turret', id: t.id, owner: t.owner, phase: 'shot', at: muzzle, to: chestOf(target) })
          dealDamage(ctx, owner, target, shot.amount, shot.type, t.slot)
        }
      }
      left.push(t)
    }
    m.turrets = left
  }
  if (m.walls?.length && m.cover) {
    const cover = m.cover
    m.walls = m.walls.filter((w) => {
      const standing = cover.health[w.index] > 0
      if (standing && now < w.until) return true
      if (standing) {
        cover.health[w.index] = 0
        const p = cover.pieces[w.index]
        const s = p.shape as Extract<CoverPiece['shape'], { kind: 'block' }>
        ctx.events.push({ type: 'wall', index: w.index, owner: -1, phase: 'down', at: { x: s.x, y: 0, z: s.z }, hx: s.hx, hz: s.hz, top: p.top })
      }
      return false
    })
  }
}
