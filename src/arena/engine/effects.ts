import { sizeHealth } from '../../charter/sizes'
import type { BuildSlot, ControlType, DamageType, Effect, Template } from '../../charter/types'
import { DT, ENGINE, ticks } from './calibration'
import type { MatchEvent } from './events'
import { clamp, distance, normalize, scale, sub, type Vec3 } from './maths'
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

/** The strongest of a debuff type on a hero right now (debuffs of one type don't stack; the strongest counts). */
export const strongest = (h: HeroState, type: HeroState['debuffs'][number]['type']) => h.debuffs.reduce((m, d) => (d.type === type && d.amount > m ? d.amount : m), 0)

/** Heal, cut by any wound on the target (anti-heal), and never past full health. */
export function heal(target: HeroState, amount: number) {
  if (!target.alive) return
  const wound = Math.min(ENGINE.woundCap, strongest(target, 'wound') / 100)
  target.hp = Math.min(target.maxHp, target.hp + amount * (1 - wound))
}

/** Unstoppable and untouchable heroes shrug off control and forced movement. */
export const immune = (h: HeroState, now: number) => h.unstoppableUntil > now || h.invulnerableUntil > now

/** Whether a kind of control is holding a hero now. */
export const controlled = (h: HeroState, type: ControlType, now: number) => h.cc[type] > now

export function dealDamage(ctx: Ctx, source: HeroState, target: HeroState, raw: number, type: DamageType, slot: BuildSlot | 'dot', executeBonus = 0) {
  const { match } = ctx
  if (!target.alive || target.invulnerableUntil > match.tick || raw <= 0) return
  // a blinded attacker's basic attacks miss, and evasion turns some aside
  if (slot === 'basic') {
    const evasion = Math.min(ENGINE.evasionCap, sumBuff(target, 'evasion'))
    if (controlled(source, 'blind', match.tick) || (evasion > 0 && next(match.rules) < evasion)) {
      ctx.events.push({ type: 'miss', source: source.id, target: target.id })
      return
    }
  }
  // any hurt wakes a sleeper, and the hit that does it lands harder (the payoff for putting someone to sleep); striking
  // from stealth gives the striker away
  let wake = 1
  if (target.cc.sleep > match.tick) {
    target.cc.sleep = 0
    if (slot !== 'dot') wake = 1 + ENGINE.wakeBonus
  }
  if (slot !== 'dot') source.stealthUntil = Math.min(source.stealthUntil, match.tick)
  const ramp = match.damageRamp && match.tick > match.damageRamp.fromTick ? ((match.tick - match.damageRamp.fromTick) / ENGINE.tickHz) * match.damageRamp.perSecond : 0
  let amount = raw * wake * (1 + source.damageBonus + sumBuff(source, 'damage') + executeBonus + ramp)
  amount *= 1 + (next(match.rules) * 2 - 1) * ENGINE.variance
  const sourceSetup = ctx.setups[source.id]
  const passive = sourceSetup.kit.passive
  const always = (passive.trigger ?? 'always') === 'always'
  for (const e of passive.effects) if (always && e.kind === 'execute' && hpFraction(target) * 100 < e.thresholdPct) amount *= 1 + e.bonusPct / 100
  const sheet = ctx.setups[target.id].sheet
  // shreds take flat points off the resist; vulnerability and the attacker's team's marks add damage taken
  const shred = strongest(target, type === 'physical' ? 'armorShred' : 'spiritShred')
  const resist = clamp((type === 'physical' ? sheet.armor : sheet.magicResist) - shred, ENGINE.resistFloor, 75)
  const marked = target.debuffs.some((d) => d.type === 'mark' && ctx.match.heroes[d.source]?.team === source.team) ? strongest(target, 'mark') : 0
  const exposed = Math.min(ENGINE.vulnerableCap, (strongest(target, 'vulnerable') + marked) / 100)
  amount *= (1 - resist / 100) * (1 - Math.min(0.8, sumBuff(target, 'damageReduction'))) * (1 + exposed)
  const absorbed = Math.min(target.shield, amount)
  target.shield -= absorbed
  const dealt = amount - absorbed
  target.hp -= dealt
  source.damageDealt += amount
  if (slot !== 'dot') ctx.events.push({ type: 'hit', source: source.id, target: target.id, slot, amount, heavy: amount >= target.maxHp * ENGINE.heavyHit })
  // the sheet's lifesteal drinks from physical hits; a lifesteal buff drinks from every hit
  const lifesteal = (type === 'physical' ? sourceSetup.sheet.lifesteal : 0) + sumBuff(source, 'lifesteal') * 100
  if (lifesteal > 0 && slot !== 'dot') heal(source, (dealt * lifesteal) / 100)
  if (target.hp <= 0) {
    target.alive = false
    target.hp = 0
    target.knockback = undefined
    ctx.events.push({ type: 'death', hero: target.id })
    firePassive(ctx, source, 'onKill', undefined)
  }
}

/** Where a lingering field or a trap reaches: its centre and radius. */
export interface Area {
  at: Vec3
  radius: number
}

/** Allies an effect reaches: the caster, the weakest ally in reach, or every ally in its area (or a field's). */
export function friendlyTargets(ctx: Ctx, caster: HeroState, template: Template, who: 'self' | 'ally' | 'allies', area?: Area): HeroState[] {
  if (who === 'self') return [caster]
  const allies = alliesOf(ctx.match, caster)
  if (area) return allies.filter((a) => distance(a.position, area.at) <= area.radius)
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

/** Tell the client a status landed, for icons over heads and effects on bodies. */
function status(ctx: Ctx, hero: HeroState, kind: string, until: number) {
  ctx.events.push({ type: 'status', hero: hero.id, status: kind, until })
}

/** Lift every crowd control off a hero (unstoppable and cleanse). */
function clearControl(hero: HeroState, now: number) {
  for (const k of Object.keys(hero.cc) as ControlType[]) hero.cc[k] = Math.min(hero.cc[k], now)
  hero.stunnedUntil = Math.min(hero.stunnedUntil, now)
  hero.fearFrom = -1
  hero.tauntBy = -1
}

/** Apply one non-movement effect of a template to the enemies it hit (or the allies it reaches, or a field's). */
export function applyEffect(ctx: Ctx, caster: HeroState, template: Template, slot: BuildSlot, e: Effect, hit: HeroState[], area?: Area) {
  const now = ctx.match.tick
  const sheet = ctx.setups[caster.id].sheet
  const executeBonus = (u: HeroState) => template.effects.reduce((b, x) => (x.kind === 'execute' && hpFraction(u) * 100 < x.thresholdPct ? b + x.bonusPct / 100 : b), 0)
  switch (e.kind) {
    case 'damage': {
      // an area hit lands in full on up to three heroes and spreads beyond that, the way area heals share (alliesShare):
      // otherwise one blast into a ten-hero crowd outweighs a whole kit
      const amount = magnitude(e, sheet[e.scaling]) * Math.min(1, ENGINE.areaShare / Math.max(1, hit.length))
      for (const u of hit) {
        if (e.overTime) u.dots.push({ perSecond: amount / e.overTime, type: e.type, until: now + ticks(e.overTime), source: caster.id })
        else dealDamage(ctx, caster, u, amount, e.type, slot, executeBonus(u))
      }
      break
    }
    case 'heal': {
      const targets = friendlyTargets(ctx, caster, template, e.target, area)
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
      const targets = friendlyTargets(ctx, caster, template, e.target, area)
      for (const u of targets) {
        u.shield += magnitude(e, sheet.spiritPower) * share(targets.length)
        u.shieldUntil = Math.max(u.shieldUntil, now + ticks(e.duration))
      }
      break
    }
    case 'stun':
      for (const u of hit) {
        if (immune(u, now)) continue
        u.stunnedUntil = Math.max(u.stunnedUntil, now + ticks(e.duration))
        status(ctx, u, 'stun', u.stunnedUntil)
      }
      break
    case 'slow':
      for (const u of hit) {
        if (u.invulnerableUntil > now) continue
        u.slows.push({ pct: e.pct, until: now + ticks(e.duration), ...(e.stat === 'attack' ? { stat: 'attack' as const } : {}) })
        status(ctx, u, e.stat === 'attack' ? 'cripple' : 'slow', now + ticks(e.duration))
      }
      break
    case 'control':
      for (const u of hit) {
        if (immune(u, now)) continue
        u.cc[e.type] = Math.max(u.cc[e.type], now + ticks(e.duration))
        if (e.type === 'fear') u.fearFrom = caster.id
        if (e.type === 'taunt') u.tauntBy = caster.id
        status(ctx, u, e.type, u.cc[e.type])
      }
      break
    case 'knockup':
      for (const u of hit) {
        if (immune(u, now)) continue
        const n = ticks(e.duration)
        u.knockback = undefined
        u.launch = { from: now, until: now + n, height: e.height, base: u.position.y }
        u.stunnedUntil = Math.max(u.stunnedUntil, now + n)
        u.airborne = true
        status(ctx, u, 'knockup', now + n)
      }
      break
    case 'debuff':
      for (const u of hit) {
        if (u.invulnerableUntil > now) continue
        // the same caster's debuff of one kind refreshes rather than stacks
        u.debuffs = u.debuffs.filter((d) => !(d.type === e.type && d.source === caster.id))
        u.debuffs.push({ type: e.type, amount: e.amount, until: now + ticks(e.duration), source: caster.id })
        // a mark shows its target to the whole team, stealth or not
        if (e.type === 'mark') u.stealthUntil = Math.min(u.stealthUntil, now)
        status(ctx, u, e.type, now + ticks(e.duration))
      }
      break
    case 'state': {
      const targets = e.target === 'self' ? [caster] : friendlyTargets(ctx, caster, template, e.target, area)
      const until = now + ticks(e.duration)
      for (const u of targets) {
        if (e.type === 'unstoppable') {
          u.unstoppableUntil = Math.max(u.unstoppableUntil, until)
          clearControl(u, now)
        } else if (e.type === 'stealth') u.stealthUntil = Math.max(u.stealthUntil, until)
        else if (e.type === 'invulnerable') u.invulnerableUntil = Math.max(u.invulnerableUntil, until)
        else {
          clearControl(u, now)
          u.slows = []
          u.debuffs = []
          u.dots = []
        }
        status(ctx, u, e.type, e.type === 'cleanse' ? now : until)
      }
      break
    }
    case 'refresh':
      // other skills come back sooner; the one that refreshed keeps its own cooldown
      for (const s of ['active1', 'active2', 'movement'] as const) if (s !== slot) caster.cooldowns[s] = Math.max(0, caster.cooldowns[s] - ticks(e.seconds))
      break
    case 'buff': {
      const targets = e.target === 'self' ? [caster] : friendlyTargets(ctx, caster, template, 'allies', area)
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
    case 'pull':
    case 'mobility':
    case 'execute':
    case 'field':
    case 'wall':
    case 'trap':
    case 'turret':
      // movement is resolved by the delivery and `resolve`; execute rides on damage; the rest raise things in the world
      break
  }
}

export type PassiveTrigger = 'onHit' | 'everyThirdHit' | 'lowHealth' | 'onKill'

const PULL_TAGS = ['pull', 'hook', 'gravity', 'vortex', 'black-hole', 'drag']

/**
 * Start a knockback or pull as an engine trajectory over a few ticks (KTD3). Walls stop it. A pull drags toward
 * `origin`: the caster, or a zone's centre for a vortex.
 */
function displace(ctx: Ctx, caster: HeroState, target: HeroState, template: Template, distanceM: number, forcePull = false, origin: Vec3 = caster.position) {
  if (immune(target, ctx.match.tick)) return
  const pull = forcePull || template.delivery.kind === 'grapple' || template.tags.some((t) => PULL_TAGS.includes(t))
  const away = sub(target.position, origin)
  const dir = normalize(pull ? scale(away, -1) : { x: away.x, y: away.y + Math.sqrt(away.x * away.x + away.z * away.z) * 0.25, z: away.z })
  const metres = pull ? clamp(distance(target.position, origin) - 1.5, 0, distanceM) : distanceM
  const n = ticks(ENGINE.knockbackTime)
  if (metres <= 0 || n <= 0) return
  // moveKnockbacks steps in this same tick's after(), so the last step lands on tick + n - 1: n steps in all
  target.knockback = { step: scale(dir, metres / n), until: ctx.match.tick + n - 1, grounded: !target.airborne }
  ctx.events.push({ type: 'knockback', hero: target.id, phase: 'start' })
}

/**
 * Apply every effect of a template to what it hit. `at` is where it landed, so a field, a wall, a trap or a turret
 * can be raised there; a pulse of an existing field or trap passes its `area` instead and raises nothing new.
 */
export function resolve(ctx: Ctx, caster: HeroState, template: Template, slot: BuildSlot, hit: HeroState[], at?: Vec3, area?: Area) {
  const effects = template.effects as Effect[]
  const spawn = at !== undefined && area === undefined
  // a trap keeps its effects for whoever steps in later
  const trap = effects.find((e) => e.kind === 'trap')
  if (trap && spawn) return world.trap(ctx, caster, template, slot, at, trap)
  const vortex = template.delivery.kind === 'zone' && template.delivery.range > 0
  for (const e of effects) {
    if (e.kind === 'displace') for (const u of hit) displace(ctx, caster, u, template, e.distance)
    else if (e.kind === 'pull') for (const u of hit) displace(ctx, caster, u, template, e.distance, true, vortex && at ? at : area?.at ?? caster.position)
    else if (e.kind === 'field') spawn && world.field(ctx, caster, template, slot, at, e)
    else if (e.kind === 'wall') spawn && world.wall(ctx, caster, at, e)
    else if (e.kind === 'turret') spawn && world.turret(ctx, caster, template, slot, at, e)
    else applyEffect(ctx, caster, template, slot, e, hit, area)
  }
}

/**
 * How `resolve` raises things in the world. Filled in by `world.ts` (fields, traps, walls, turrets), which needs
 * `resolve` itself to make fields pulse, so the two meet here instead of importing each other.
 */
export const world = {
  field: (_ctx: Ctx, _caster: HeroState, _template: Template, _slot: BuildSlot, _at: Vec3, _e: Extract<Effect, { kind: 'field' }>) => {},
  trap: (_ctx: Ctx, _caster: HeroState, _template: Template, _slot: BuildSlot, _at: Vec3, _e: Extract<Effect, { kind: 'trap' }>) => {},
  wall: (_ctx: Ctx, _caster: HeroState, _at: Vec3, _e: Extract<Effect, { kind: 'wall' }>) => {},
  turret: (_ctx: Ctx, _caster: HeroState, _template: Template, _slot: BuildSlot, _at: Vec3, _e: Extract<Effect, { kind: 'turret' }>) => {},
}

export function firePassive(ctx: Ctx, hero: HeroState, trigger: PassiveTrigger, target: HeroState | undefined) {
  const passive = ctx.setups[hero.id].kit.passive
  // a broken passive does nothing until the break wears off
  if (!hero.alive || passive.trigger !== trigger || controlled(hero, 'break', ctx.match.tick)) return
  // a triggered passive lands on the hero itself or the target it just hit
  const hit = target && target.alive ? target : undefined
  resolve(ctx, hero, passive, 'passive', hit ? [hit] : [])
}

/** Always-on regeneration and the ultimate's opening cooldown, set once when a hero enters a match. */
export function initHero(hero: HeroState, setup: HeroSetup) {
  hero.cooldowns.ultimate = ticks(ENGINE.ultimateStartCooldown)
  const passive = setup.kit.passive
  if ((passive.trigger ?? 'always') !== 'always') return
  for (const e of passive.effects) if (e.kind === 'heal' && e.target === 'self') hero.passiveRegen += e.amount + e.ratio * setup.sheet.spiritPower
}

/**
 * Always-on passive buffs, renewed every tick while the passive works: on the hero itself, or as an aura on every ally
 * near it. A break stops the renewal, so the buff lapses within a tick and comes back when the break ends.
 */
function passiveBuffs(ctx: Ctx, hero: HeroState) {
  const passive = ctx.setups[hero.id].kit.passive
  const now = ctx.match.tick
  const source = `passive:${hero.id}`
  for (const e of passive.effects) {
    if (e.kind !== 'buff') continue
    const radius = passive.delivery.radius ?? ENGINE.alliesRadius
    const targets = e.target === 'self' ? [hero] : alliesOf(ctx.match, hero).filter((a) => distance(a.position, hero.position) <= radius)
    for (const u of targets) {
      u.buffs = u.buffs.filter((b) => !(b.source === source && b.stat === e.stat))
      u.buffs.push({ stat: e.stat, pct: e.pct, until: now + 2, source })
    }
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
    hero.debuffs = hero.debuffs.filter((d) => d.until > now)
    if (hero.cc.fear <= now) hero.fearFrom = -1
    if (hero.cc.taunt <= now) hero.tauntBy = -1
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
    const broken = controlled(hero, 'break', now)
    heal(hero, (setup.sheet.regen + (broken ? 0 : hero.passiveRegen)) * DT)
    const passive = setup.kit.passive
    if ((passive.trigger ?? 'always') === 'always' && !broken) passiveBuffs(ctx, hero)
    if ((passive.trigger ?? 'always') === 'always' && !broken)
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
