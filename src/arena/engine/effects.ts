import { sizeHealth } from '../../charter/sizes'
import type { BuildSlot, DamageType, Effect, Template } from '../../charter/types'
import { DT, ENGINE, ticks } from './calibration'
import type { MatchEvent } from './events'
import { clamp, distance, normalize, scale, sub } from './maths'
import { next } from './rng'
import type { HeroSetup, HeroState, MatchState, Stat } from './state'

/**
 * Effects and statuses (U4), ported from the 2D balance model with the same numbers, in ticks. Damage, healing,
 * shields, control, buffs, transformations and passives all live here; where a cast lands is `deliveries.ts`.
 */

export interface Ctx {
  match: MatchState
  setups: readonly HeroSetup[]
  events: MatchEvent[]
}

export const hpFraction = (h: HeroState) => h.hp / h.maxHp
export const enemiesOf = (m: MatchState, h: HeroState) => m.heroes.filter((o) => o.alive && o.team !== h.team)
export const alliesOf = (m: MatchState, h: HeroState) => m.heroes.filter((o) => o.alive && o.team === h.team)
export const sumBuff = (h: HeroState, stat: Stat) => h.buffs.reduce((s, b) => (b.stat === stat ? s + b.pct / 100 : s), 0)
const magnitude = (e: { amount: number; ratio: number }, stat: number) => e.amount + e.ratio * stat
/** Area support effects share a fixed total across the allies they reach. */
const share = (count: number) => Math.min(1, ENGINE.alliesShare / Math.max(1, count))

export function heal(target: HeroState, amount: number) {
  if (target.alive) target.hp = Math.min(target.maxHp, target.hp + amount)
}

export function dealDamage(ctx: Ctx, source: HeroState, target: HeroState, raw: number, type: DamageType, slot: BuildSlot | 'dot', executeBonus = 0) {
  const { match } = ctx
  if (!target.alive || target.invulnerableUntil > match.tick || raw <= 0) return
  const ramp = match.damageRamp && match.tick > match.damageRamp.fromTick ? ((match.tick - match.damageRamp.fromTick) / ENGINE.tickHz) * match.damageRamp.perSecond : 0
  let amount = raw * (1 + source.damageBonus + sumBuff(source, 'damage') + executeBonus + ramp)
  amount *= 1 + (next(match.rules) * 2 - 1) * ENGINE.variance
  const sourceSetup = ctx.setups[source.id]
  const passive = sourceSetup.kit.passive
  const always = (passive.trigger ?? 'always') === 'always'
  for (const e of passive.effects) if (always && e.kind === 'execute' && hpFraction(target) * 100 < e.thresholdPct) amount *= 1 + e.bonusPct / 100
  const sheet = ctx.setups[target.id].sheet
  const resist = Math.min(75, type === 'physical' ? sheet.armor : sheet.magicResist)
  amount *= (1 - resist / 100) * (1 - Math.min(0.8, sumBuff(target, 'damageReduction')))
  const absorbed = Math.min(target.shield, amount)
  target.shield -= absorbed
  const dealt = amount - absorbed
  target.hp -= dealt
  source.damageDealt += amount
  if (slot !== 'dot') ctx.events.push({ type: 'hit', source: source.id, target: target.id, slot, amount, heavy: amount >= target.maxHp * ENGINE.heavyHit })
  if (type === 'physical' && sourceSetup.sheet.lifesteal) heal(source, (dealt * sourceSetup.sheet.lifesteal) / 100)
  if (target.hp <= 0) {
    target.alive = false
    target.hp = 0
    target.knockback = undefined
    ctx.events.push({ type: 'death', hero: target.id })
    firePassive(ctx, source, 'onKill', undefined)
  }
}

/** Allies an effect reaches: the caster, the weakest ally in reach, or every ally in its area. */
export function friendlyTargets(ctx: Ctx, caster: HeroState, template: Template, who: 'self' | 'ally' | 'allies'): HeroState[] {
  if (who === 'self') return [caster]
  const allies = alliesOf(ctx.match, caster)
  if (who === 'ally') {
    const reach = Math.max(template.delivery.range, ENGINE.alliesRadius)
    const inReach = allies.filter((a) => distance(caster.position, a.position) <= reach)
    const others = inReach.filter((a) => a !== caster)
    const pool = others.length ? others : inReach
    return pool.length ? [pool.reduce((low, a) => (hpFraction(a) < hpFraction(low) ? a : low))] : []
  }
  const radius = template.delivery.radius ?? ENGINE.alliesRadius
  return allies.filter((a) => distance(caster.position, a.position) <= radius + (template.delivery.kind === 'aura' ? 0 : template.delivery.range))
}

function setSize(ctx: Ctx, hero: HeroState, size: HeroState['size']) {
  // a transformation changes the body, so health scales with it and keeps its fraction
  const role = ctx.setups[hero.id].build.roleId
  const ratio = sizeHealth(role, size) / sizeHealth(role, hero.size)
  hero.maxHp *= ratio
  hero.hp *= ratio
  hero.size = size
}

/** Apply one non-movement effect of a template to the enemies it hit (or the allies it reaches). */
export function applyEffect(ctx: Ctx, caster: HeroState, template: Template, slot: BuildSlot, e: Effect, hit: HeroState[]) {
  const now = ctx.match.tick
  const sheet = ctx.setups[caster.id].sheet
  const executeBonus = (u: HeroState) => template.effects.reduce((b, x) => (x.kind === 'execute' && hpFraction(u) * 100 < x.thresholdPct ? b + x.bonusPct / 100 : b), 0)
  switch (e.kind) {
    case 'damage': {
      const amount = magnitude(e, sheet[e.scaling])
      for (const u of hit) {
        if (e.overTime) u.dots.push({ perSecond: amount / e.overTime, type: e.type, until: now + ticks(e.overTime), source: caster.id })
        else dealDamage(ctx, caster, u, amount, e.type, slot, executeBonus(u))
      }
      break
    }
    case 'heal': {
      const targets = friendlyTargets(ctx, caster, template, e.target)
      const amount = magnitude(e, sheet.spiritPower) * share(targets.length)
      for (const u of targets) {
        if (e.overTime) u.hots.push({ perSecond: amount / e.overTime, until: now + ticks(e.overTime) })
        else if (u === caster) heal(u, amount)
        else {
          u.recentHeals = u.recentHeals.filter((t) => t > now - ticks(ENGINE.healWindow))
          heal(u, amount / (1 + ENGINE.healFalloff * u.recentHeals.length))
          u.recentHeals.push(now)
        }
      }
      break
    }
    case 'shield': {
      const targets = friendlyTargets(ctx, caster, template, e.target)
      for (const u of targets) {
        u.shield += magnitude(e, sheet.spiritPower) * share(targets.length)
        u.shieldUntil = Math.max(u.shieldUntil, now + ticks(e.duration))
      }
      break
    }
    case 'stun':
      for (const u of hit) if (u.invulnerableUntil <= now) u.stunnedUntil = Math.max(u.stunnedUntil, now + ticks(e.duration))
      break
    case 'slow':
      for (const u of hit) u.slows.push({ pct: e.pct, until: now + ticks(e.duration) })
      break
    case 'buff': {
      const targets = e.target === 'self' ? [caster] : friendlyTargets(ctx, caster, template, 'allies')
      for (const u of targets) {
        u.buffs = u.buffs.filter((b) => !(b.source === template.id && b.stat === e.stat))
        u.buffs.push({ stat: e.stat, pct: e.pct * share(targets.length), until: now + ticks(e.duration), source: template.id })
      }
      break
    }
    case 'resize':
      setSize(ctx, caster, e.sizeClass)
      caster.resizeUntil = now + ticks(e.duration)
      ctx.events.push({ type: 'resize', hero: caster.id, phase: 'start', size: e.sizeClass })
      break
    case 'displace':
    case 'mobility':
    case 'execute':
      // movement is resolved by the delivery; execute rides on damage
      break
  }
}

export type PassiveTrigger = 'onHit' | 'everyThirdHit' | 'lowHealth' | 'onKill'

const PULL_TAGS = ['pull', 'hook', 'gravity', 'vortex', 'black-hole', 'drag']

/** Start a knockback or pull as an engine trajectory over a few ticks (KTD3). Walls stop it. */
function displace(ctx: Ctx, caster: HeroState, target: HeroState, template: Template, distanceM: number) {
  const pull = template.delivery.kind === 'grapple' || template.tags.some((t) => PULL_TAGS.includes(t))
  const away = sub(target.position, caster.position)
  const dir = normalize(pull ? scale(away, -1) : { x: away.x, y: away.y + Math.sqrt(away.x * away.x + away.z * away.z) * 0.25, z: away.z })
  const metres = pull ? clamp(distance(target.position, caster.position) - 1.5, 0, distanceM) : distanceM
  const n = ticks(ENGINE.knockbackTime)
  if (metres <= 0 || n <= 0) return
  // moveKnockbacks steps in this same tick's after(), so the last step lands on tick + n - 1: n steps in all
  target.knockback = { step: scale(dir, metres / n), until: ctx.match.tick + n - 1, grounded: !target.airborne }
  ctx.events.push({ type: 'knockback', hero: target.id, phase: 'start' })
}

/** Apply every effect of a template to what it hit. */
export function resolve(ctx: Ctx, caster: HeroState, template: Template, slot: BuildSlot, hit: HeroState[]) {
  for (const e of template.effects as Effect[]) {
    if (e.kind === 'displace') for (const u of hit) displace(ctx, caster, u, template, e.distance)
    else applyEffect(ctx, caster, template, slot, e, hit)
  }
}

export function firePassive(ctx: Ctx, hero: HeroState, trigger: PassiveTrigger, target: HeroState | undefined) {
  const passive = ctx.setups[hero.id].kit.passive
  if (!hero.alive || passive.trigger !== trigger) return
  // a triggered passive lands on the hero itself or the target it just hit
  const hit = target && target.alive ? target : undefined
  resolve(ctx, hero, passive, 'passive', hit ? [hit] : [])
}

/** Always-on passives and the ultimate's opening cooldown, set once when a hero enters a match. */
export function initHero(hero: HeroState, setup: HeroSetup) {
  hero.cooldowns.ultimate = ticks(ENGINE.ultimateStartCooldown)
  const passive = setup.kit.passive
  if ((passive.trigger ?? 'always') !== 'always') return
  for (const e of passive.effects) {
    if (e.kind === 'buff') hero.buffs.push({ stat: e.stat, pct: e.pct, until: Number.MAX_SAFE_INTEGER, source: passive.id })
    if (e.kind === 'heal') hero.passiveRegen += e.amount + e.ratio * setup.sheet.spiritPower
  }
}

/** Expire statuses and run damage and healing over time, once per tick before anyone acts. */
export function tickStatuses(ctx: Ctx) {
  const { match, setups } = ctx
  const now = match.tick
  for (const hero of match.heroes) {
    if (!hero.alive) continue
    hero.slows = hero.slows.filter((s) => s.until > now)
    hero.buffs = hero.buffs.filter((b) => b.until > now)
    if (hero.size !== hero.chosenSize && hero.resizeUntil <= now) {
      setSize(ctx, hero, hero.chosenSize)
      ctx.events.push({ type: 'resize', hero: hero.id, phase: 'end', size: hero.chosenSize })
    }
    if (hero.shieldUntil <= now) hero.shield = 0
    for (const dot of hero.dots) dealDamage(ctx, match.heroes[dot.source], hero, dot.perSecond * DT, dot.type, 'dot')
    hero.dots = hero.dots.filter((d) => d.until > now)
    for (const hot of hero.hots) heal(hero, hot.perSecond * DT)
    hero.hots = hero.hots.filter((h) => h.until > now)
    if (!hero.alive) continue
    const setup = setups[hero.id]
    heal(hero, (setup.sheet.regen + hero.passiveRegen) * DT)
    const passive = setup.kit.passive
    if ((passive.trigger ?? 'always') === 'always')
      for (const e of passive.effects) {
        if (e.kind !== 'heal' || e.target !== 'allies') continue
        const perSecond = e.amount + e.ratio * setup.sheet.spiritPower
        const radius = passive.delivery.radius ?? ENGINE.alliesRadius
        const near = alliesOf(match, hero).filter((a) => a !== hero && distance(hero.position, a.position) <= radius)
        for (const a of near) heal(a, perSecond * DT * share(near.length))
      }
    if (!hero.lowHealthFired && hpFraction(hero) < ENGINE.lowHealth) {
      hero.lowHealthFired = true
      firePassive(ctx, hero, 'lowHealth', undefined)
    }
  }
}
