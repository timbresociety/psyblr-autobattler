import { geometryMultiplier, missingGeometry } from './geometry.js'
import { ALL_SIZE_CLASSES } from './sizes.js'
import type { ControlType, DebuffType, Delivery, Effect, SecondarySheet, SlotKind, StateType, Template, Validation, LimitHit } from './types.js'

/**
 * Power budget (KTD2). Every template in a slot is worth the same budget, measured on a reference sheet.
 * Control, mobility and durations are fixed by the author; damage, healing, shields and buff strength
 * are scaled so the whole template lands on its slot budget. So a stun skill hits softer than a pure nuke.
 */

/** Score units: basic and passive are per trigger, the rest per second of cooldown. */
export const SLOT_BUDGETS: Record<SlotKind, number> = {
  basic: 70,
  active: 22,
  passive: 20,
  ultimate: 14,
  movement: 12,
}

export const BUDGET_TOLERANCE = 0.05

/** One retune step lowers every scalable magnitude by this fraction (KTD7). */
export const RETUNE_STEP = 0.06
export const MAX_RETUNE_STEPS = 6

export function retuneFactor(steps: number): number {
  return Math.max(0, 1 - RETUNE_STEP * steps)
}

/** The mid-game sheet every template is priced against. */
export const REFERENCE_SHEET: Pick<SecondarySheet, 'weaponDamage' | 'spiritPower'> = { weaponDamage: 60, spiritPower: 50 }

const PASSIVE_TRIGGER_WEIGHT = { always: 1, onHit: 1, everyThirdHit: 0.4, lowHealth: 0.15, onKill: 0.15 } as const
const BUFF_WEIGHT = { damage: 160, attackSpeed: 140, moveSpeed: 60, damageReduction: 190, lifesteal: 150, evasion: 170 } as const
/** Per second of control on one enemy; a stun is 110. Behaviour control (fear, taunt) costs a little more. */
const CONTROL_WEIGHT: Record<ControlType, number> = { root: 75, silence: 70, disarm: 55, sleep: 70, blind: 45, grounded: 30, fear: 105, taunt: 100, break: 30 }
/** Per point (shreds) or percent (the rest) per second, on one enemy. */
const DEBUFF_WEIGHT: Record<DebuffType, number> = { armorShred: 1.5, spiritShred: 1.5, vulnerable: 2, wound: 0.6, mark: 1.6 }
/** Per second of the state on one hero; cleanse is a flat price. */
const STATE_WEIGHT: Record<StateType, number> = { unstoppable: 80, stealth: 45, invulnerable: 130, cleanse: 45 }
/**
 * What reaching more than one hero is worth. An area heal, shield or buff gives each of up to three allies its full
 * amount (ENGINE.alliesShare), so with the team close it lands two to three times over; 1.6 left team heals so cheap
 * that a support built on them won 63% of skirmishes while one without won 25%.
 */
const TARGET_WEIGHT = { self: 1, ally: 1.1, allies: 2.4 } as const

const AREA_KINDS: Delivery['kind'][] = ['zone', 'cone', 'aura']

function areaMultiplier(delivery: Delivery): number {
  return delivery.radius && AREA_KINDS.includes(delivery.kind) ? 1 + delivery.radius / 5 : 1
}

function rangeMultiplier(delivery: Delivery): number {
  if (delivery.kind === 'self' || delivery.kind === 'aura') return 1
  return 1 + Math.min(delivery.range, 30) / 60
}

function magnitude(amount: number, ratio: number, stat: number): number {
  return amount + ratio * stat
}

export function effectValue(effect: Effect, delivery: Delivery): number {
  const area = areaMultiplier(delivery)
  switch (effect.kind) {
    case 'damage': {
      const value = magnitude(effect.amount, effect.ratio, REFERENCE_SHEET[effect.scaling])
      return value * area * (effect.overTime ? 0.85 : 1)
    }
    case 'heal':
      return magnitude(effect.amount, effect.ratio, REFERENCE_SHEET.spiritPower) * TARGET_WEIGHT[effect.target] * (effect.overTime ? 0.85 : 1)
    case 'shield':
      return magnitude(effect.amount, effect.ratio, REFERENCE_SHEET.spiritPower) * 0.8 * TARGET_WEIGHT[effect.target]
    case 'stun':
      return effect.duration * 110 * area
    case 'slow':
      return (effect.pct / 100) * effect.duration * 45 * area
    case 'displace':
      return effect.distance * 9 * area
    case 'mobility':
      return effect.distance * 9 + (effect.invulnerable ?? 0) * 90
    case 'buff':
      return (effect.pct / 100) * effect.duration * BUFF_WEIGHT[effect.stat] * (effect.target === 'allies' ? TARGET_WEIGHT.allies : 1)
    case 'execute':
      return (effect.thresholdPct / 100) * (effect.bonusPct / 100) * 500
    case 'resize': {
      // size classes are tuned to be even against the field, so a transformation pays a small fee per class it jumps (R29)
      const steps = Math.abs(ALL_SIZE_CLASSES.indexOf(effect.sizeClass) - ALL_SIZE_CLASSES.indexOf('medium'))
      return effect.duration * steps * 2
    }
    case 'control':
      return effect.duration * CONTROL_WEIGHT[effect.type] * area
    case 'knockup':
      return (effect.duration * 115 + effect.height * 3) * area
    case 'pull':
      return effect.distance * 10 * area
    case 'debuff':
      return effect.amount * effect.duration * DEBUFF_WEIGHT[effect.type] * area
    case 'state':
      return (effect.type === 'cleanse' ? STATE_WEIGHT.cleanse : effect.duration * STATE_WEIGHT[effect.type]) * TARGET_WEIGHT[effect.target]
    case 'refresh':
      return effect.seconds * 5
    case 'wall':
      return effect.length * effect.height * effect.duration * 0.45 + effect.health / 60
    case 'turret': {
      // each shot at the reference sheet, most of which find a target
      const shots = effect.duration / Math.max(0.1, effect.interval)
      return magnitude(effect.amount, effect.ratio, REFERENCE_SHEET[effect.scaling]) * shots * 0.7
    }
    case 'field':
    case 'trap':
      // priced in scoreTemplate: they change what the template's other effects are worth
      return 0
  }
}

/**
 * A field lands its effects again on every pulse (people walk out, so each pulse counts a little over half); a trap
 * may never spring, so its effects count for most but not all. Everything else is worth what it says.
 */
function lingerMultiplier(template: Template): number {
  let mul = 1
  for (const e of template.effects) {
    if (e.kind === 'field') mul *= 1 + Math.floor(e.duration / Math.max(0.1, e.interval)) * 0.55
    if (e.kind === 'trap') mul *= 0.8
  }
  return mul
}

export function scoreTemplate(template: Template): number {
  const raw = template.effects.reduce((sum, effect) => sum + effectValue(effect, template.delivery), 0) * lingerMultiplier(template) * rangeMultiplier(template.delivery) * geometryMultiplier(template.delivery)
  switch (template.slot) {
    case 'basic':
      return raw
    case 'passive':
      return raw * PASSIVE_TRIGGER_WEIGHT[template.trigger ?? 'always']
    default:
      return raw / Math.max(template.cooldown, 1)
  }
}

export function targetBudget(template: Template): number {
  return template.override?.budget ?? SLOT_BUDGETS[template.slot]
}

const round = (value: number, places = 2) => {
  const f = 10 ** places
  return Math.round(value * f) / f
}

/** Scale every budget-scalable magnitude (damage, heal, shield, buff strength, execute bonus). Durations stay. */
export function scaleMagnitudes(template: Template, factor: number): Template {
  const effects = template.effects.map((effect): Effect => {
    switch (effect.kind) {
      case 'damage':
      case 'heal':
      case 'shield':
        return { ...effect, amount: round(effect.amount * factor, 1), ratio: round(effect.ratio * factor) }
      case 'buff':
        return { ...effect, pct: round(effect.pct * factor, 1) }
      case 'execute':
        return { ...effect, bonusPct: round(effect.bonusPct * factor, 1) }
      case 'turret':
        return { ...effect, amount: round(effect.amount * factor, 1), ratio: round(effect.ratio * factor) }
      default:
        return effect
    }
  })
  return { ...template, effects }
}

/** Scale the template's magnitudes so its score lands on its slot budget (or its recorded override). */
export function normalizeTemplate(template: Template): Template {
  const target = targetBudget(template)
  const fixed = scoreTemplate(scaleMagnitudes(template, 0))
  const scalable = scoreTemplate(template) - fixed
  if (scalable <= 0) {
    if (Math.abs(fixed - target) / target <= BUDGET_TOLERANCE) return template
    const side = fixed > target ? 'over budget' : 'under budget'
    throw new Error(`${template.id}: nothing to scale and score ${fixed.toFixed(1)} is ${side} (${target})`)
  }
  const factor = (target - fixed) / scalable
  if (factor < 0.05) throw new Error(`${template.id}: control and mobility alone are over budget (${fixed.toFixed(1)} vs ${target})`)
  return scaleMagnitudes(template, factor)
}

const COOLDOWN_SLOTS: SlotKind[] = ['active', 'ultimate', 'movement']

export function validateTemplate(template: Template): Validation {
  const errors: LimitHit[] = []
  const fail = (field: string) => errors.push({ reason: 'stat-cap', field, requested: 0, allowed: 0 })
  if (!template.id) fail('id')
  if (!template.name) fail('name')
  if (!template.roles?.length) fail('roles')
  if (!template.tags?.length) fail('tags')
  if (!template.effects?.length) fail('effects')
  if (!template.ai || !template.ai.use || !Number.isFinite(template.ai.priority)) fail('ai')
  if (COOLDOWN_SLOTS.includes(template.slot) && !(template.cooldown > 0)) fail('cooldown')
  if (!COOLDOWN_SLOTS.includes(template.slot) && template.cooldown !== 0) fail('cooldown')
  if (template.override && !template.override.reason?.trim()) fail('override.reason')
  if (template.override && !(template.override.budget > 0)) fail('override.budget')
  for (const field of missingGeometry(template.delivery)) fail(`delivery.${field}`)
  for (const effect of template.effects ?? []) {
    for (const [key, value] of Object.entries(effect)) {
      if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) fail(`effects.${effect.kind}.${key}`)
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true }
}
