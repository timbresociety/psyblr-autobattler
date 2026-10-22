import { geometryOf } from '../../charter/geometry'
import { SIZES } from '../../charter/sizes'
import type { BuildSlot, Effect, Template } from '../../charter/types'
import { ENGINE, ticks } from './calibration'
import { enemiesOf, firePassive, resolve, sumBuff, tickStatuses, type Ctx } from './effects'
import { coverHit, coverInDisc } from './cover'
import { keepOut } from './locomotion'
import { PI, add, cos, direction, distance, distanceToSegment, dot, normalize, scale, segmentToCapsuleAxis, sub, type Vec3 } from './maths'
import { bodyRadius, capsule, slotBit, type Command, type HeroSetup, type HeroState, type MatchState } from './state'
import type { TickRules } from './tick'

/**
 * Where casts land (U4, KTD3). Every hit is engine geometry: heroes are vertical capsules, and each delivery is
 * sized from its own template numbers, which the effect renderer reads too, so what you see is what can hit you.
 */

const CAST_ORDER: BuildSlot[] = ['movement', 'ultimate', 'active1', 'active2', 'basic']

export const chest = (h: HeroState): Vec3 => ({ x: h.position.x, y: h.position.y + capsule(h).height * ENGINE.chest, z: h.position.z })
export const aim = (h: HeroState) => direction(h.yaw, h.pitch)
const top = (h: HeroState): Vec3 => ({ x: h.position.x, y: h.position.y + capsule(h).height, z: h.position.z })
/** Gap from a point to the surface of a hero's capsule. */
const gap = (p: Vec3, h: HeroState) => distanceToSegment(p, h.position, top(h)) - capsule(h).radius
const inArc = (from: Vec3, d: Vec3, h: HeroState, degrees: number) => dot(d, normalize(sub(chest(h), from))) >= cos((degrees / 2) * (PI / 180))
const nearest = (from: Vec3, hs: HeroState[]) => (hs.length ? [hs.reduce((a, b) => (gap(from, b) < gap(from, a) ? b : a))] : [])
export const isRanged = (setup: HeroSetup) => setup.kit.basic.delivery.range > 4

export interface Landing {
  hit: HeroState[]
  at: Vec3
  /** Cover the delivery struck, and where: a wall in the way, or every barrier inside a blast. */
  cover?: { index: number; at: Vec3 }[]
}

/** True when no standing ruin blocks the straight line between two points (R25). */
export function canSee(match: MatchState, a: Vec3, b: Vec3): boolean {
  return !match.cover || !coverHit(match.cover.pieces, match.cover.health, a, b)
}

/** The first piece of cover along a→b, with the point it is struck, if any. */
function firstCover(match: MatchState, a: Vec3, b: Vec3, radius = 0): { index: number; at: Vec3; t: number } | undefined {
  if (!match.cover) return undefined
  const hit = coverHit(match.cover.pieces, match.cover.health, a, b, radius)
  return hit ? { index: hit.index, t: hit.t, at: add(a, scale(sub(b, a), hit.t)) } : undefined
}

/** Every barrier inside a blast of `radius` around `at`. */
function coverInBlast(match: MatchState, at: Vec3, radius: number): { index: number; at: Vec3 }[] {
  return match.cover ? coverInDisc(match.cover.pieces, match.cover.health, at, radius).map((index) => ({ index, at })) : []
}

/** What one hit of a template does to a barrier: its direct damage at the caster's numbers. */
function barrierDamage(setup: HeroSetup, template: Template): number {
  let total = 0
  for (const e of template.effects as Effect[]) if (e.kind === 'damage' && !e.overTime) total += e.amount + e.ratio * setup.sheet[e.scaling]
  return total
}

/** Wear a barrier down; unbreakable ruins just report the hit so the client can show it. */
function strikeCover(ctx: Ctx, caster: HeroState, template: Template, struck: { index: number; at: Vec3 }[] = []) {
  const cover = ctx.match.cover
  if (!cover) return
  const amount = barrierDamage(ctx.setups[caster.id], template)
  for (const { index, at } of struck) {
    const before = cover.health[index]
    if (before > 0 && amount > 0) cover.health[index] = Math.max(0, before - amount)
    ctx.events.push({ type: 'cover-hit', index, at, health: cover.health[index] })
    if (before > 0 && cover.health[index] === 0) ctx.events.push({ type: 'cover-broken', index, at })
  }
}

/** The enemies an instant delivery reaches from the caster's current aim, and where it lands. */
export function landing(ctx: Ctx, caster: HeroState, template: Template): Landing {
  const d = template.delivery
  const from = chest(caster)
  const dir = aim(caster)
  const enemies = enemiesOf(ctx.match, caster)
  const reach = SIZES[caster.size].reachBonus
  const m = ctx.match
  // cover blocks anything aimed straight at a body; area blasts and auras land wherever they land
  const seen = (e: HeroState) => canSee(m, from, chest(e))
  // a swing or a lunge that reaches no hero can still strike the wall in front of it
  const swing = (hit: HeroState[], range: number): Landing => {
    const end = add(from, scale(dir, range))
    const wall = hit.length ? undefined : firstCover(m, from, end)
    return { hit, at: wall?.at ?? end, cover: wall ? [wall] : undefined }
  }
  switch (d.kind) {
    case 'melee': {
      // reach runs from the caster's body, not its chest: surface to surface, the way players and the AI judge it
      const inReach = enemies.filter((e) => gap(from, e) - capsule(caster).radius <= d.range + ENGINE.meleeSlack + reach && inArc(from, dir, e, geometryOf(d).arcDegrees) && seen(e))
      return swing(nearest(from, inReach), d.range)
    }
    case 'cone':
      return swing(
        enemies.filter((e) => gap(from, e) <= d.range && inArc(from, dir, e, geometryOf(d).arcDegrees) && seen(e)),
        d.range,
      )
    case 'beam': {
      // a beam stops at the first wall it meets
      const full = add(from, scale(dir, d.range))
      const wall = firstCover(m, from, full, geometryOf(d).width / 2)
      const end = wall?.at ?? full
      return { hit: enemies.filter((e) => segmentToCapsuleAxis(from, end, e.position, capsule(e).height) <= geometryOf(d).width / 2 + capsule(e).radius), at: end, cover: wall ? [wall] : undefined }
    }
    case 'zone': {
      if (d.range > 0) {
        const centre = add(from, scale(dir, d.range))
        return { hit: enemies.filter((e) => gap(centre, e) <= (d.radius ?? 0)), at: centre, cover: coverInBlast(m, centre, d.radius ?? 0) }
      }
      // a zone with no range is a disc at the caster's level: heroes flying well above or below escape it
      const p = caster.position
      const flat = (e: HeroState) => distance({ x: e.position.x, y: 0, z: e.position.z }, { x: p.x, y: 0, z: p.z }) - capsule(e).radius
      return { hit: enemies.filter((e) => flat(e) <= (d.radius ?? 0) && Math.abs(e.position.y - p.y) <= ENGINE.groundReach), at: { ...p }, cover: coverInBlast(m, p, d.radius ?? 0) }
    }
    case 'aura':
      return { hit: enemies.filter((e) => gap(from, e) <= (d.radius ?? 0) && seen(e)), at: from }
    case 'self':
      return { hit: [], at: from }
    case 'projectile':
      return { hit: [], at: from }
    default: {
      // dashes, blinks and grapples go for the nearest enemy in a narrow arc ahead
      const inReach = enemies.filter((e) => gap(from, e) - capsule(caster).radius <= d.range + reach && inArc(from, dir, e, ENGINE.lungeArc) && seen(e))
      return swing(nearest(from, inReach), d.range)
    }
  }
}


function impact(ctx: Ctx, caster: HeroState, slot: BuildSlot, template: Template, at: Vec3) {
  const d = template.delivery
  ctx.events.push({ type: 'impact', hero: caster.id, slot, at, radius: d.radius ?? 0, range: d.range, ...(d.arcDegrees ? { arcDegrees: d.arcDegrees } : {}), ...(d.width ? { width: d.width } : {}) })
}

/** Cast a slot if it is ready: mobility first, then the delivery, then its effects (U4). Returns whether it fired. */
export function cast(ctx: Ctx, index: number, slot: BuildSlot): boolean {
  const { match, setups } = ctx
  const caster = match.heroes[index]
  const setup = setups[index]
  const template = setup.kit[slot]
  if (slot === 'basic') {
    if (match.tick < caster.nextAttackAt) return false
    const tempo = isRanged(setup) ? setup.sheet.fireRate : setup.sheet.attackSpeed
    caster.nextAttackAt = match.tick + ticks(1 / Math.max(0.2, tempo * (1 + sumBuff(caster, 'attackSpeed'))))
  } else {
    if (slot === 'passive' || caster.cooldowns[slot] > 0) return false
    caster.cooldowns[slot] = ticks(template.cooldown * (1 - Math.min(40, setup.sheet.cooldownReduction) / 100))
  }
  ctx.events.push({ type: 'cast', hero: caster.id, slot, templateId: template.id })
  for (const e of template.effects) {
    if (e.kind !== 'mobility') continue
    if (e.invulnerable) caster.invulnerableUntil = Math.max(caster.invulnerableUntil, match.tick + ticks(e.invulnerable))
    if (e.distance) {
      let p = add(caster.position, scale(aim(caster), e.distance))
      // a dash stops at the wall in its way; a blink jumps past it
      if (template.delivery.kind !== 'blink') {
        const wall = firstCover(match, caster.position, p, bodyRadius(caster))
        if (wall) p = add(caster.position, scale(sub(p, caster.position), Math.max(0, wall.t - 0.02)))
      }
      caster.position = p
      if (p.y > 0) caster.airborne = true
      keepOut(caster, match)
    }
  }
  if (template.delivery.kind === 'projectile') {
    const d = template.delivery
    const { speed, projectileRadius } = geometryOf(d)
    const from = chest(caster)
    match.projectiles.push({ id: match.nextProjectileId++, owner: index, slot, position: from, step: scale(aim(caster), speed / ENGINE.tickHz), ticksLeft: Math.max(1, ticks(d.range / speed)) })
    ctx.events.push({ type: 'projectile', id: match.nextProjectileId - 1, hero: caster.id, slot, from, radius: projectileRadius, speed })
    return true
  }
  const { hit, at, cover } = landing(ctx, caster, template)
  if (template.delivery.kind !== 'self') impact(ctx, caster, slot, template, at)
  strikeCover(ctx, caster, template, cover)
  resolve(ctx, caster, template, slot, hit)
  if (slot === 'basic') afterBasic(ctx, caster, hit[0])
  return true
}

function afterBasic(ctx: Ctx, hero: HeroState, target: HeroState | undefined) {
  hero.hitCount++
  firePassive(ctx, hero, 'onHit', target)
  if (hero.hitCount % 3 === 0) firePassive(ctx, hero, 'everyThirdHit', target)
}

/** Move every projectile one tick, sweeping its path so a fast shot cannot skip through a hero. */
function flyProjectiles(ctx: Ctx) {
  const { match, setups } = ctx
  const left: MatchState['projectiles'] = []
  for (const p of match.projectiles) {
    const owner = match.heroes[p.owner]
    const template = setups[p.owner].kit[p.slot]
    const size = geometryOf(template.delivery).projectileRadius
    const end = add(p.position, p.step)
    const struck = enemiesOf(match, owner).filter((e) => segmentToCapsuleAxis(p.position, end, e.position, capsule(e).height) <= capsule(e).radius + size)
    const first = struck.length ? struck.reduce((a, b) => (distance(p.position, chest(b)) < distance(p.position, chest(a)) ? b : a)) : undefined
    const wall = firstCover(match, p.position, end, size)
    const stepLength = distance(p.position, end) || 1
    // the shot meets whichever comes first along its path: a hero, or the cover in front of one
    if (wall && (!first || wall.t < distance(p.position, chest(first)) / stepLength)) {
      const area = template.delivery.radius
      impact(ctx, owner, p.slot, template, wall.at)
      strikeCover(ctx, owner, template, area ? coverInBlast(match, wall.at, area) : [wall])
      // a blast against a wall still catches heroes beside it
      if (area) resolve(ctx, owner, template, p.slot, enemiesOf(match, owner).filter((e) => gap(wall.at, e) <= area))
      continue
    }
    if (first) {
      const at = chest(first)
      const area = template.delivery.radius
      const hit = area ? enemiesOf(match, owner).filter((e) => gap(at, e) <= area) : [first]
      impact(ctx, owner, p.slot, template, at)
      if (area) strikeCover(ctx, owner, template, coverInBlast(match, at, area))
      resolve(ctx, owner, template, p.slot, hit)
      if (p.slot === 'basic') afterBasic(ctx, owner, first)
      continue
    }
    p.position = end
    if (--p.ticksLeft > 0) left.push(p)
  }
  match.projectiles = left
}

function moveKnockbacks(ctx: Ctx) {
  for (const hero of ctx.match.heroes) {
    const kb = hero.knockback
    if (!kb || !hero.alive) continue
    hero.position = add(hero.position, kb.step)
    if (hero.position.y > 0) hero.airborne = true
    keepOut(hero, ctx.match)
    if (ctx.match.tick >= kb.until) {
      // the lift is a launch, not a switch into flight: a hero knocked off the ground comes back down
      if (kb.grounded) {
        hero.position = { ...hero.position, y: 0 }
        hero.airborne = false
      }
      hero.knockback = undefined
      ctx.events.push({ type: 'knockback', hero: hero.id, phase: 'end' })
    }
  }
}

/** The combat rules for `tick`: statuses, casts from pressed buttons, then projectiles and knockback. */
export const COMBAT_RULES: TickRules = {
  statuses: (match, setups, events) => tickStatuses({ match, setups, events }),
  act: (match, setups, hero, command: Command, events) => {
    if (!command.buttons) return
    const ctx = { match, setups, events }
    for (const slot of CAST_ORDER) if (command.buttons & slotBit(slot) && cast(ctx, hero, slot)) return
  },
  after: (match, setups, events) => {
    const ctx = { match, setups, events }
    flyProjectiles(ctx)
    moveKnockbacks(ctx)
  },
}

