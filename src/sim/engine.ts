import { BUILD_SLOTS, type Build } from '../charter/build'
import { retuneFactor, scaleMagnitudes } from '../charter/budget'
import { getRole } from '../charter/roles'
import { SIZES } from '../charter/sizes'
import { deriveSheet } from '../charter/stats'
import { getTemplate } from '../charter/templates/catalog'
import type { BuildSlot, DamageType, Effect, RoleId, SecondarySheet, Template } from '../charter/types'
import { chooseCast, chooseTarget, preferredDistance } from './ai'
import { CALIBRATION } from './calibration'
import { createRng, type Rng } from './rng'

/**
 * Headless, deterministic, abstract combat model (KTD6): a 2D plane with movement, range, cooldowns,
 * damage over time, control, shields and healing. No 3D physics. Used only for balance.
 */

export interface Combatant {
  build: Build
  /** Scales every magnitude in the kit; army synergy uses it (KTD8). */
  powerScale?: number
  /** Flat bonus to all damage dealt, as a fraction. */
  damageBonus?: number
}

export interface Vec {
  x: number
  y: number
}

type Stat = 'damage' | 'attackSpeed' | 'moveSpeed' | 'damageReduction'

export interface Unit {
  id: number
  team: 0 | 1
  name: string
  roleId: RoleId
  /** Metres added to this unit's hitbox and to its melee reach (size class, KTD8). */
  hitRadius: number
  reachBonus: number
  sheet: SecondarySheet
  kit: Record<BuildSlot, Template>
  maxHp: number
  hp: number
  shield: number
  shieldUntil: number
  position: Vec
  stunnedUntil: number
  invulnerableUntil: number
  slows: { pct: number; until: number }[]
  /** `source` is the template that granted it; the same template refreshes its buff instead of stacking. */
  buffs: { stat: Stat; pct: number; until: number; source: string }[]
  dots: { perSecond: number; type: DamageType; until: number; source: Unit }[]
  hots: { perSecond: number; until: number }[]
  cooldowns: Record<BuildSlot, number>
  nextAttackAt: number
  hitCount: number
  lowHealthFired: boolean
  alive: boolean
  damageDealt: number
  damageBonus: number
  passiveExecute?: { thresholdPct: number; bonusPct: number }
  passiveRegen: number
  /** Health per second an always-on aura gives allies in range (not the owner). */
  auraHeal?: { perSecond: number; radius: number }
  /** Times of recent burst heals received, for diminishing returns. */
  recentHeals: number[]
  casts: Partial<Record<BuildSlot, number>>
}

export interface Battle {
  units: Unit[]
  time: number
  rng: Rng
  maxTime: number
  winner?: 0 | 1 | 'draw'
}

export interface BattleResult {
  winner: 0 | 1 | 'draw'
  time: number
  units: { name: string; team: 0 | 1; alive: boolean; hpFraction: number; damageDealt: number }[]
}

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y)
export const distance = (a: Unit, b: Unit) => dist(a.position, b.position)
export const hpFraction = (u: Unit) => u.hp / u.maxHp
const sumBuff = (u: Unit, stat: Stat) => u.buffs.reduce((s, b) => (b.stat === stat ? s + b.pct / 100 : s), 0)
export const isRanged = (u: Unit) => u.kit.basic.delivery.range > 4

/** A build's sheet and scaled kit never change during fights, so they are prepared once per build and scale. */
const prepared = new WeakMap<Build, Map<number, { sheet: SecondarySheet; kit: Record<BuildSlot, Template> }>>()

function prepare(build: Build, powerScale: number) {
  let byScale = prepared.get(build)
  if (!byScale) prepared.set(build, (byScale = new Map()))
  let entry = byScale.get(powerScale)
  if (!entry) {
    const { sheet } = deriveSheet(getRole(build.roleId), build.spread, build.sizeClass)
    const kit = {} as Record<BuildSlot, Template>
    for (const slot of BUILD_SLOTS) {
      const spec = build.slots[slot]
      kit[slot] = scaleMagnitudes(getTemplate(spec.templateId), retuneFactor(spec.retuneSteps) * powerScale)
    }
    entry = { sheet, kit }
    byScale.set(powerScale, entry)
  }
  return entry
}

function createUnit(c: Combatant, id: number, team: 0 | 1, position: Vec): Unit {
  const { sheet, kit } = prepare(c.build, c.powerScale ?? 1)
  const cooldowns = { basic: 0, active1: 0, active2: 0, passive: 0, ultimate: CALIBRATION.ultimateStartCooldown, movement: 0 }
  const size = SIZES[c.build.sizeClass ?? 'medium']
  const unit: Unit = {
    id, team, name: c.build.heroName, roleId: c.build.roleId, hitRadius: size.hitRadius, reachBonus: size.reachBonus, sheet, kit, maxHp: sheet.maxHealth, hp: sheet.maxHealth, shield: 0, shieldUntil: 0, position,
    stunnedUntil: 0, invulnerableUntil: 0, slows: [], buffs: [], dots: [], hots: [], cooldowns, nextAttackAt: 0, hitCount: 0,
    lowHealthFired: false, alive: true, damageDealt: 0, damageBonus: c.damageBonus ?? 0, passiveRegen: 0, recentHeals: [], casts: {},
  }
  const passive = kit.passive
  if ((passive.trigger ?? 'always') === 'always') {
    for (const e of passive.effects) {
      if (e.kind === 'buff') unit.buffs.push({ stat: e.stat, pct: e.pct, until: Infinity, source: passive.id })
      if (e.kind === 'heal') {
        const perSecond = e.amount + e.ratio * sheet.spiritPower
        unit.passiveRegen += perSecond
        if (e.target === 'allies') unit.auraHeal = { perSecond, radius: passive.delivery.radius ?? CALIBRATION.alliesRadius }
      }
      if (e.kind === 'execute') unit.passiveExecute = { thresholdPct: e.thresholdPct, bonusPct: e.bonusPct }
    }
  }
  return unit
}

export function createBattle(teamA: Combatant[], teamB: Combatant[], seed: number): Battle {
  const rng = createRng(seed)
  const units: Unit[] = []
  const place = (team: Combatant[], side: 0 | 1) =>
    team.forEach((c, i) => {
      const x = (side === 0 ? -1 : 1) * (CALIBRATION.startDistance / 2 + rng() * 2)
      const y = (i - (team.length - 1) / 2) * CALIBRATION.lineSpacing + (rng() - 0.5)
      units.push(createUnit(c, units.length, side, { x, y }))
    })
  place(teamA, 0)
  place(teamB, 1)
  const maxTime = teamA.length + teamB.length > 2 ? CALIBRATION.maxTime.team : CALIBRATION.maxTime.duel
  return { units, time: 0, rng, maxTime }
}

export const enemiesOf = (battle: Battle, u: Unit) => battle.units.filter((o) => o.alive && o.team !== u.team)
export const alliesOf = (battle: Battle, u: Unit) => battle.units.filter((o) => o.alive && o.team === u.team)

function heal(target: Unit, amount: number) {
  if (target.alive) target.hp = Math.min(target.maxHp, target.hp + amount)
}

function dealDamage(battle: Battle, source: Unit, target: Unit, raw: number, type: DamageType, executeBonus = 0) {
  if (!target.alive || target.invulnerableUntil > battle.time || raw <= 0) return
  const overtime = Math.max(0, battle.time - CALIBRATION.overtimeStart) * CALIBRATION.overtimeRamp
  let amount = raw * (1 + source.damageBonus + sumBuff(source, 'damage') + executeBonus + overtime)
  amount *= 1 + (battle.rng() * 2 - 1) * CALIBRATION.variance
  if (source.passiveExecute && hpFraction(target) * 100 < source.passiveExecute.thresholdPct) amount *= 1 + source.passiveExecute.bonusPct / 100
  const resist = Math.min(75, type === 'physical' ? target.sheet.armor : target.sheet.magicResist)
  amount *= (1 - resist / 100) * (1 - Math.min(0.8, sumBuff(target, 'damageReduction')))
  const absorbed = Math.min(target.shield, amount)
  target.shield -= absorbed
  const dealt = amount - absorbed
  target.hp -= dealt
  source.damageDealt += amount
  if (type === 'physical' && source.sheet.lifesteal) heal(source, (dealt * source.sheet.lifesteal) / 100)
  if (target.hp <= 0) {
    target.alive = false
    target.hp = 0
    firePassive(battle, source, 'onKill', undefined)
  }
}

function magnitude(e: { amount: number; ratio: number }, stat: number) {
  return e.amount + e.ratio * stat
}

function moveToward(u: Unit, to: Vec, maxStep: number, stopAt = 0) {
  const d = dist(u.position, to)
  if (d <= stopAt || d === 0) return
  const step = Math.min(maxStep, d - stopAt)
  u.position = { x: u.position.x + ((to.x - u.position.x) / d) * step, y: u.position.y + ((to.y - u.position.y) / d) * step }
}

function moveAway(u: Unit, from: Vec, step: number) {
  const d = dist(u.position, from) || 1
  u.position = {
    x: Math.max(-30, Math.min(30, u.position.x + ((u.position.x - from.x) / d) * step)),
    y: Math.max(-30, Math.min(30, u.position.y + ((u.position.y - from.y) / d) * step)),
  }
}

const PULL_TAGS = ['pull', 'hook', 'gravity', 'vortex', 'black-hole', 'drag']

function distanceToSegment(p: Vec, a: Vec, b: Vec) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len))
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy })
}

/** Which enemies a cast reaches. */
export function enemiesHit(battle: Battle, caster: Unit, template: Template, target: Unit | undefined): Unit[] {
  const { delivery } = template
  const enemies = enemiesOf(battle, caster)
  switch (delivery.kind) {
    case 'aura':
      return enemies.filter((e) => distance(caster, e) <= (delivery.radius ?? 0) + e.hitRadius)
    case 'self':
      return []
    case 'zone':
      return target ? enemies.filter((e) => dist(e.position, delivery.range ? target.position : caster.position) <= (delivery.radius ?? 0) + e.hitRadius) : []
    case 'cone':
      return target ? enemies.filter((e) => distance(caster, e) <= delivery.range + e.hitRadius && distance(target, e) <= (delivery.radius ?? 0) + e.hitRadius) : []
    case 'beam': {
      if (!target) return []
      const d = distance(caster, target) || 1
      const far = { x: caster.position.x + ((target.position.x - caster.position.x) / d) * delivery.range, y: caster.position.y + ((target.position.y - caster.position.y) / d) * delivery.range }
      return enemies.filter((e) => distanceToSegment(e.position, caster.position, far) <= 1.5 + e.hitRadius)
    }
    case 'projectile':
      if (!target) return []
      return delivery.radius ? enemies.filter((e) => distance(target, e) <= (delivery.radius ?? 0) + e.hitRadius) : [target]
    default:
      return target && distance(caster, target) <= Math.max(delivery.range, caster.kit.basic.delivery.range) + 1 + caster.reachBonus + target.hitRadius ? [target] : []
  }
}

function friendlyTargets(battle: Battle, caster: Unit, template: Template, who: 'self' | 'ally' | 'allies'): Unit[] {
  if (who === 'self') return [caster]
  const allies = alliesOf(battle, caster)
  if (who === 'ally') {
    const reach = Math.max(template.delivery.range, CALIBRATION.alliesRadius)
    const inReach = allies.filter((a) => distance(caster, a) <= reach)
    const others = inReach.filter((a) => a !== caster)
    const pool = others.length ? others : inReach
    return pool.length ? [pool.reduce((low, a) => (hpFraction(a) < hpFraction(low) ? a : low))] : []
  }
  const radius = template.delivery.radius ?? CALIBRATION.alliesRadius
  const center = template.delivery.kind === 'zone' && template.delivery.range ? undefined : caster.position
  return allies.filter((a) => (center ? dist(a.position, center) <= radius : distance(caster, a) <= radius + template.delivery.range))
}

/** Apply a template's effects. `escape` moves away from the target instead of toward it. */
export function applyTemplate(battle: Battle, caster: Unit, template: Template, target: Unit | undefined, escape = false) {
  const now = battle.time
  for (const e of template.effects) {
    if (e.kind !== 'mobility') continue
    if (e.invulnerable) caster.invulnerableUntil = Math.max(caster.invulnerableUntil, now + e.invulnerable)
    if (!e.distance) continue
    if (escape && target) moveAway(caster, target.position, e.distance)
    else if (target) moveToward(caster, target.position, e.distance, caster.kit.basic.delivery.range * 0.9)
  }
  const hit = enemiesHit(battle, caster, template, target)
  const executeBonus = (u: Unit) =>
    template.effects.reduce((bonus, e) => (e.kind === 'execute' && hpFraction(u) * 100 < e.thresholdPct ? bonus + e.bonusPct / 100 : bonus), 0)
  for (const e of template.effects) applyEffect(battle, caster, template, e, hit, executeBonus, now)
}

/** Area support effects share a fixed total across the allies they reach. */
const share = (count: number) => Math.min(1, CALIBRATION.alliesShare / Math.max(1, count))

function applyEffect(battle: Battle, caster: Unit, template: Template, e: Effect, hit: Unit[], executeBonus: (u: Unit) => number, now: number) {
  switch (e.kind) {
    case 'damage': {
      const amount = magnitude(e, caster.sheet[e.scaling])
      for (const u of hit) {
        if (e.overTime) u.dots.push({ perSecond: amount / e.overTime, type: e.type, until: now + e.overTime, source: caster })
        else dealDamage(battle, caster, u, amount, e.type, executeBonus(u))
      }
      break
    }
    case 'heal': {
      const targets = friendlyTargets(battle, caster, template, e.target)
      const amount = magnitude(e, caster.sheet.spiritPower) * share(targets.length)
      for (const u of targets) {
        if (e.overTime) u.hots.push({ perSecond: amount / e.overTime, until: now + e.overTime })
        else if (u === caster) heal(u, amount)
        else {
          u.recentHeals = u.recentHeals.filter((t) => t > now - CALIBRATION.healWindow)
          heal(u, amount / (1 + CALIBRATION.healFalloff * u.recentHeals.length))
          u.recentHeals.push(now)
        }
      }
      break
    }
    case 'shield': {
      const targets = friendlyTargets(battle, caster, template, e.target)
      for (const u of targets) {
        u.shield += magnitude(e, caster.sheet.spiritPower) * share(targets.length)
        u.shieldUntil = Math.max(u.shieldUntil, now + e.duration)
      }
      break
    }
    case 'stun':
      for (const u of hit) if (u.invulnerableUntil <= now) u.stunnedUntil = Math.max(u.stunnedUntil, now + e.duration)
      break
    case 'slow':
      for (const u of hit) u.slows.push({ pct: e.pct, until: now + e.duration })
      break
    case 'displace': {
      const pull = template.delivery.kind === 'grapple' || template.tags.some((t) => PULL_TAGS.includes(t))
      for (const u of hit) {
        if (pull) moveToward(u, caster.position, e.distance, 1.5)
        else moveAway(u, caster.position, e.distance)
      }
      break
    }
    case 'buff': {
      const targets = e.target === 'self' ? [caster] : friendlyTargets(battle, caster, template, 'allies')
      for (const u of targets) {
        u.buffs = u.buffs.filter((b) => !(b.source === template.id && b.stat === e.stat))
        u.buffs.push({ stat: e.stat, pct: e.pct * share(targets.length), until: now + e.duration, source: template.id })
      }
      break
    }
    case 'mobility':
    case 'execute':
      break
  }
}

/** Apply a triggered passive (onHit, everyThirdHit, lowHealth, onKill). */
function firePassive(battle: Battle, unit: Unit, trigger: 'onHit' | 'everyThirdHit' | 'lowHealth' | 'onKill', target: Unit | undefined) {
  const passive = unit.kit.passive
  if (!unit.alive || passive.trigger !== trigger) return
  applyTemplate(battle, unit, passive, target && target.alive ? target : undefined)
}

function basicAttack(battle: Battle, unit: Unit, target: Unit) {
  const tempo = isRanged(unit) ? unit.sheet.fireRate : unit.sheet.attackSpeed
  unit.nextAttackAt = battle.time + 1 / Math.max(0.2, tempo * (1 + sumBuff(unit, 'attackSpeed')))
  applyTemplate(battle, unit, unit.kit.basic, target)
  unit.hitCount++
  firePassive(battle, unit, 'onHit', target)
  if (unit.hitCount % 3 === 0) firePassive(battle, unit, 'everyThirdHit', target)
}

function tickStatuses(battle: Battle, unit: Unit, dt: number) {
  const now = battle.time
  unit.slows = unit.slows.filter((s) => s.until > now)
  unit.buffs = unit.buffs.filter((b) => b.until > now)
  if (unit.shieldUntil <= now) unit.shield = 0
  for (const dot of unit.dots) dealDamage(battle, dot.source, unit, dot.perSecond * dt, dot.type)
  unit.dots = unit.dots.filter((d) => d.until > now)
  for (const hot of unit.hots) heal(unit, hot.perSecond * dt)
  unit.hots = unit.hots.filter((h) => h.until > now)
  if (!unit.alive) return
  heal(unit, (unit.sheet.regen + unit.passiveRegen) * dt)
  if (unit.auraHeal) {
    const { perSecond, radius } = unit.auraHeal
    const near = alliesOf(battle, unit).filter((a) => a !== unit && distance(unit, a) <= radius)
    for (const a of near) heal(a, perSecond * dt * share(near.length))
  }
  if (!unit.lowHealthFired && hpFraction(unit) < CALIBRATION.lowHealth) {
    unit.lowHealthFired = true
    firePassive(battle, unit, 'lowHealth', undefined)
  }
}

export function moveSpeed(unit: Unit): number {
  const slow = unit.slows.reduce((m, s) => Math.max(m, s.pct / 100), 0)
  return unit.sheet.moveSpeed * (1 + sumBuff(unit, 'moveSpeed')) * (1 - slow)
}

function act(battle: Battle, unit: Unit, dt: number) {
  const target = chooseTarget(battle, unit)
  if (!target) return
  const cast = chooseCast(battle, unit, target)
  if (cast) {
    const template = unit.kit[cast.slot]
    unit.cooldowns[cast.slot] = template.cooldown * (1 - Math.min(40, unit.sheet.cooldownReduction) / 100)
    unit.casts[cast.slot] = (unit.casts[cast.slot] ?? 0) + 1
    applyTemplate(battle, unit, template, cast.target, cast.escape)
    return
  }
  const want = preferredDistance(unit)
  const d = distance(unit, target)
  const step = moveSpeed(unit) * dt
  if (d > want) moveToward(unit, target.position, step, want)
  if (d <= unit.kit.basic.delivery.range + 0.5 + unit.reachBonus + target.hitRadius && battle.time >= unit.nextAttackAt) basicAttack(battle, unit, target)
}

/** Advance the battle by one step. */
export function step(battle: Battle) {
  if (battle.winner !== undefined) return
  const dt = CALIBRATION.dt
  battle.time = Math.round((battle.time + dt) * 1000) / 1000
  for (const unit of battle.units) if (unit.alive) tickStatuses(battle, unit, dt)
  // a fresh seeded order each step, so neither side always moves first
  const order = battle.units.map((u) => ({ u, k: battle.rng() })).sort((a, b) => a.k - b.k).map((x) => x.u)
  for (const unit of order) {
    if (!unit.alive) continue
    for (const slot of BUILD_SLOTS) unit.cooldowns[slot] = Math.max(0, unit.cooldowns[slot] - dt)
    if (unit.stunnedUntil > battle.time) continue
    act(battle, unit, dt)
  }
  const aliveA = battle.units.some((u) => u.alive && u.team === 0)
  const aliveB = battle.units.some((u) => u.alive && u.team === 1)
  if (!aliveA || !aliveB) battle.winner = aliveA ? 0 : aliveB ? 1 : 'draw'
  else if (battle.time >= battle.maxTime) battle.winner = 'draw'
}

export function simulate(teamA: Combatant[], teamB: Combatant[], seed: number): BattleResult {
  const battle = createBattle(teamA, teamB, seed)
  while (battle.winner === undefined) step(battle)
  return {
    winner: battle.winner,
    time: battle.time,
    units: battle.units.map((u) => ({ name: u.name, team: u.team, alive: u.alive, hpFraction: Math.round(hpFraction(u) * 1000) / 1000, damageDealt: Math.round(u.damageDealt) })),
  }
}

export function duel(a: Build, b: Build, seed: number): BattleResult {
  return simulate([{ build: a }], [{ build: b }], seed)
}
