import type { BuildSlot, LimitHit, SecondaryStat } from '../../charter/types'

export const STAT_LABEL: Record<SecondaryStat, string> = {
  maxHealth: 'Health',
  armor: 'Armor',
  magicResist: 'Spirit resist',
  moveSpeed: 'Move speed',
  attackSpeed: 'Attack speed',
  weaponDamage: 'Weapon damage',
  fireRate: 'Fire rate',
  ammo: 'Ammo',
  spiritPower: 'Spirit power',
  regen: 'Regen',
  lifesteal: 'Lifesteal',
  cooldownReduction: 'Cooldown reduction',
}

export const SLOT_LABEL: Record<BuildSlot, string> = {
  basic: 'Basic attack',
  active1: 'Active 1',
  active2: 'Active 2',
  passive: 'Passive',
  ultimate: 'Ultimate',
  movement: 'Movement',
}

const fmt = (n: number) => String(Math.round(n * 10) / 10)

/** One plain sentence per limit the engine applied (R4, AE2, AE4). */
export function describeLimit(limit: LimitHit): string {
  const field = STAT_LABEL[limit.field as SecondaryStat] ?? limit.field
  switch (limit.reason) {
    case 'stat-cap':
      return `${field} tops out at ${fmt(limit.allowed)} for this role.`
    case 'attribute-cap':
      return `${field[0].toUpperCase()}${field.slice(1)} is at its limit (${fmt(limit.allowed)} points).`
    case 'pool-exceeded':
      return limit.field === 'pool' ? `Only ${fmt(limit.allowed)} points in the pool.` : `${field} can reach ${fmt(limit.allowed)} with the points available.`
    default:
      return `${field} was adjusted to ${fmt(limit.allowed)}.`
  }
}
