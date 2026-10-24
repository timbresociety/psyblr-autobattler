import type { Effect, Template } from './types.js'

/**
 * The skill library's effect families (docs/charter/skill-library.html). Every effect belongs to exactly one, so the
 * families split the whole space with no overlap: what a skill does to enemies (damage, control, debuff), what it does
 * for the caster and allies (buff, protect, state, tempo), and what it changes about the world or the body (construct,
 * transform, mobility). Delivery shape is a separate axis and is not a family.
 */
export type Family = 'damage' | 'control' | 'debuff' | 'buff' | 'protect' | 'state' | 'tempo' | 'construct' | 'transform' | 'mobility'

export const FAMILIES: readonly Family[] = ['damage', 'control', 'debuff', 'buff', 'protect', 'state', 'tempo', 'construct', 'transform', 'mobility']

export const FAMILY_LABEL: Record<Family, string> = {
  damage: 'Damage',
  control: 'Crowd control',
  debuff: 'Debuffs',
  buff: 'Buffs',
  protect: 'Healing and shields',
  state: 'States',
  tempo: 'Cooldowns',
  construct: 'Zones and constructs',
  transform: 'Transformations',
  mobility: 'Movement',
}

export function familyOf(effect: Effect): Family {
  switch (effect.kind) {
    case 'damage':
    case 'execute':
      return 'damage'
    case 'stun':
    case 'slow':
    case 'displace':
    case 'pull':
    case 'knockup':
    case 'control':
      return 'control'
    case 'debuff':
      return 'debuff'
    case 'buff':
      return 'buff'
    case 'heal':
    case 'shield':
      return 'protect'
    case 'state':
      return effect.type === 'cleanse' ? 'protect' : 'state'
    case 'refresh':
      return 'tempo'
    case 'field':
    case 'trap':
    case 'wall':
    case 'turret':
      return 'construct'
    case 'resize':
      return 'transform'
    case 'mobility':
      return 'mobility'
  }
}

/** When a skill does several things, the one it is named for: moving beats building beats changing shape, and so on down to plain damage. */
const PRECEDENCE: readonly Family[] = ['mobility', 'construct', 'transform', 'control', 'state', 'protect', 'debuff', 'tempo', 'buff', 'damage']

export function familiesOf(template: Pick<Template, 'effects'>): Family[] {
  return [...new Set(template.effects.map(familyOf))]
}

export function primaryFamily(template: Pick<Template, 'effects'>): Family {
  const has = new Set(familiesOf(template))
  return PRECEDENCE.find((f) => has.has(f)) ?? 'damage'
}
