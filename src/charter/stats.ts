import type { Attribute, LimitHit, Role, SecondarySheet, SecondaryStat, Spread, Validation } from './types'

export const ATTRIBUTES: readonly Attribute[] = ['strength', 'agility', 'intellect']

export const SECONDARY_STATS: readonly SecondaryStat[] = [
  'maxHealth',
  'armor',
  'magicResist',
  'moveSpeed',
  'attackSpeed',
  'weaponDamage',
  'fireRate',
  'ammo',
  'spiritPower',
  'regen',
  'lifesteal',
  'cooldownReduction',
]

/** Every hero spends the same pool (R12). Tuned against the balance report. */
export const POOL_SIZE = 30

/**
 * What one point in each core attribute adds to the secondary sheet, before the role's weight.
 * Strength is bulk, Agility is weapon tempo and mobility, Intellect is skill power and cooldowns.
 */
export const ATTRIBUTE_GAINS: Record<Attribute, Partial<SecondarySheet>> = {
  strength: { maxHealth: 70, armor: 1.1, regen: 0.2, weaponDamage: 0.6 },
  agility: { moveSpeed: 0.06, attackSpeed: 0.035, fireRate: 0.035, weaponDamage: 1.4, lifesteal: 0.25, ammo: 0.6 },
  intellect: { spiritPower: 2.6, cooldownReduction: 0.9, magicResist: 1.1, regen: 0.15 },
}

export function spentPoints(spread: Spread): number {
  return ATTRIBUTES.reduce((sum, attr) => sum + spread[attr], 0)
}

export function validateSpread(role: Role, spread: Spread): Validation {
  const errors: LimitHit[] = []
  for (const attr of ATTRIBUTES) {
    const value = spread[attr]
    if (value < 0) errors.push({ reason: 'negative', field: attr, requested: value, allowed: 0 })
    if (!Number.isInteger(value)) errors.push({ reason: 'not-integer', field: attr, requested: value, allowed: Math.floor(value) })
    if (value > role.attributeCaps[attr]) {
      errors.push({ reason: 'attribute-cap', field: attr, requested: value, allowed: role.attributeCaps[attr] })
    }
  }
  const spent = spentPoints(spread)
  if (spent > POOL_SIZE) errors.push({ reason: 'pool-exceeded', field: 'pool', requested: spent, allowed: POOL_SIZE })
  return errors.length ? { ok: false, errors } : { ok: true }
}

const round = (value: number) => Math.round(value * 100) / 100

/** Derive the secondary sheet from a role and a spread. Pure and deterministic. */
export function deriveSheet(role: Role, spread: Spread): { sheet: SecondarySheet; capped: SecondaryStat[] } {
  const sheet = { ...role.base }
  for (const attr of ATTRIBUTES) {
    const gains = ATTRIBUTE_GAINS[attr]
    for (const stat of SECONDARY_STATS) {
      const gain = gains[stat]
      if (gain) sheet[stat] += gain * spread[attr] * role.weights[attr]
    }
  }
  const capped: SecondaryStat[] = []
  for (const stat of SECONDARY_STATS) {
    if (sheet[stat] >= role.caps[stat]) {
      sheet[stat] = role.caps[stat]
      capped.push(stat)
    }
    sheet[stat] = round(Math.max(0, sheet[stat]))
  }
  return { sheet, capped }
}
