import { SIZES } from '../../charter/sizes'
import type { BuildSlot, Effect, Template } from '../../charter/types'
import { ENGINE, ticks } from './calibration'
import { applyEffect, enemiesOf, firePassive, passiveHooks, sumBuff, tickStatuses, type Ctx } from './effects'
import { clampToArena } from './locomotion'
import { PI, add, cos, direction, distance, distanceToSegment, dot, normalize, scale, segmentToCapsuleAxis, sub, type Vec3 } from './maths'
import { capsule, slotBit, type Command, type HeroSetup, type HeroState, type MatchState } from './state'
import type { TickRules } from './tick'

/**
 * Where casts land (U4, KTD3). Every hit is engine geometry: heroes are vertical capsules, and each delivery is
 * sized from its own template numbers, which the effect renderer reads too, so what you see is what can hit you.
 */

const PULL_TAGS = ['pull', 'hook', 'gravity', 'vortex', 'black-hole', 'drag']
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
}

/** The enemies an instant delivery reaches from the caster's current aim, and where it lands. */
export function landing(ctx: Ctx, caster: HeroState, template: Template): Landing {
  const d = template.delivery
  const from = chest(caster)
  const dir = aim(caster)
  const enemies = enemiesOf(ctx.match, caster)
  const reach = SIZES[caster.size].reachBonus
  switch (d.kind) {
    case 'melee': {
      // reach runs from the caster's body, not its chest: surface to surface, the way players and the AI judge it
      const inReach = enemies.filter((e) => gap(from, e) - capsule(caster).radius <= d.range + ENGINE.meleeSlack + reach && inArc(from, dir, e, d.arcDegrees ?? 90))
      return { hit: nearest(from, inReach), at: add(from, scale(dir, d.range)) }
    }
    case 'cone':
      return { hit: enemies.filter((e) => gap(from, e) <= d.range && inArc(from, dir, e, d.arcDegrees ?? 60)), at: add(from, scale(dir, d.range)) }
    case 'beam': {
      const end = add(from, scale(dir, d.range))
      return { hit: enemies.filter((e) => segmentToCapsuleAxis(from, end, e.position, capsule(e).height) <= (d.width ?? 1) / 2 + capsule(e).radius), at: end }
    }
    case 'zone': {
      if (d.range > 0) {
        const centre = add(from, scale(dir, d.range))
        return { hit: enemies.filter((e) => gap(centre, e) <= (d.radius ?? 0)), at: centre }
      }
      // a zone with no range is a disc at the caster's level: heroes flying well above or below escape it
      const p = caster.position
      const flat = (e: HeroState) => distance({ x: e.position.x, y: 0, z: e.position.z }, { x: p.x, y: 0, z: p.z }) - capsule(e).radius
      return { hit: enemies.filter((e) => flat(e) <= (d.radius ?? 0) && Math.abs(e.position.y - p.y) <= ENGINE.groundReach), at: { ...p } }
    }
    case 'aura':
      return { hit: enemies.filter((e) => gap(from, e) <= (d.radius ?? 0)), at: from }
    case 'self':
      return { hit: [], at: from }
    case 'projectile':
      return { hit: [], at: from }
    default: {
      // dashes, blinks and grapples go for the nearest enemy in a narrow arc ahead
      const inReach = enemies.filter((e) => gap(from, e) - capsule(caster).radius <= d.range + reach && inArc(from, dir, e, ENGINE.lungeArc))
      return { hit: nearest(from, inReach), at: add(from, scale(dir, d.range)) }
    }
  }
}

/** Start a knockback or pull as an engine trajectory over a few ticks (KTD3). Walls stop it. */
function displace(ctx: Ctx, caster: HeroState, target: HeroState, template: Template, distanceM: number) {
  const pull = template.delivery.kind === 'grapple' || template.tags.some((t) => PULL_TAGS.includes(t))
  const away = sub(target.position, caster.position)
  const dir = normalize(pull ? scale(away, -1) : { x: away.x, y: away.y + Math.sqrt(away.x * away.x + away.z * away.z) * 0.25, z: away.z })
  const metres = pull ? Math.max(0, Math.min(distanceM, distance(target.position, caster.position) - 1.5)) : distanceM
  const n = ticks(ENGINE.knockbackTime)
  if (metres <= 0 || n <= 0) return
  target.knockback = { step: scale(dir, metres / n), until: ctx.match.tick + n }
  ctx.events.push({ type: 'knockback', hero: target.id, phase: 'start' })
}

/** Apply every effect of a template to what it hit. */
export function resolve(ctx: Ctx, caster: HeroState, template: Template, slot: BuildSlot, hit: HeroState[]) {
  for (const e of template.effects as Effect[]) {
    if (e.kind === 'displace') for (const u of hit) displace(ctx, caster, u, template, e.distance)
    else applyEffect(ctx, caster, template, slot, e, hit)
  }
}

passiveHooks.fire = (ctx, hero, template, target) => resolve(ctx, hero, template, 'passive', target ? [target] : [])

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
      const p = add(caster.position, scale(aim(caster), e.distance))
      caster.position = p
      if (p.y > 0) caster.airborne = true
      clampToArena(caster)
    }
  }
  if (template.delivery.kind === 'projectile') {
    const d = template.delivery
    const speed = d.speed ?? 30
    const from = chest(caster)
    match.projectiles.push({ id: match.nextProjectileId++, owner: index, slot, position: from, step: scale(aim(caster), speed / ENGINE.tickHz), ticksLeft: Math.max(1, ticks(d.range / speed)) })
    ctx.events.push({ type: 'projectile', id: match.nextProjectileId - 1, hero: caster.id, slot, from, radius: d.projectileRadius ?? 0.3, speed })
    return true
  }
  const { hit, at } = landing(ctx, caster, template)
  if (template.delivery.kind !== 'self') impact(ctx, caster, slot, template, at)
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
    const size = template.delivery.projectileRadius ?? 0.3
    const end = add(p.position, p.step)
    const struck = enemiesOf(match, owner).filter((e) => segmentToCapsuleAxis(p.position, end, e.position, capsule(e).height) <= capsule(e).radius + size)
    if (struck.length) {
      const first = struck.reduce((a, b) => (distance(p.position, chest(b)) < distance(p.position, chest(a)) ? b : a))
      const at = chest(first)
      const area = template.delivery.radius
      const hit = area ? enemiesOf(match, owner).filter((e) => gap(at, e) <= area) : [first]
      impact(ctx, owner, p.slot, template, at)
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
    clampToArena(hero)
    if (ctx.match.tick >= kb.until) {
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

