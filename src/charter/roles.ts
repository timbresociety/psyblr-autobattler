import type { Role, RoleId, SecondarySheet } from './types'

/** Units: health points, armor/resist/lifesteal/cooldown reduction in %, speed in m/s, rates per second. */
const sheet = (s: SecondarySheet): SecondarySheet => s

export const ROLES: readonly Role[] = [
  {
    id: 'tank',
    name: 'Tank',
    description: 'Holds the front, absorbs damage and locks enemies down.',
    base: sheet({ maxHealth: 3028, armor: 16, magicResist: 18, moveSpeed: 5.6, attackSpeed: 0.9, weaponDamage: 24, fireRate: 0.9, ammo: 8, spiritPower: 9, regen: 2.5, lifesteal: 0, cooldownReduction: 0 }),
    weights: { strength: 1.4, agility: 0.7, intellect: 0.8 },
    caps: sheet({ maxHealth: 6057, armor: 60, magicResist: 50, moveSpeed: 7, attackSpeed: 1.6, weaponDamage: 50, fireRate: 1.6, ammo: 20, spiritPower: 63, regen: 16, lifesteal: 15, cooldownReduction: 30 }),
    attributeCaps: { strength: 22, agility: 16, intellect: 16 },
    defaultSpread: { strength: 16, agility: 6, intellect: 8 },
  },
  {
    id: 'fighter',
    name: 'Fighter',
    description: 'Dives into close range and wins sustained brawls.',
    base: sheet({ maxHealth: 898, armor: 16, magicResist: 12, moveSpeed: 6.2, attackSpeed: 1.1, weaponDamage: 41, fireRate: 1.1, ammo: 10, spiritPower: 15, regen: 3, lifesteal: 4, cooldownReduction: 0 }),
    weights: { strength: 1.15, agility: 1.05, intellect: 0.8 },
    caps: sheet({ maxHealth: 1858, armor: 45, magicResist: 40, moveSpeed: 8, attackSpeed: 2, weaponDamage: 103, fireRate: 2, ammo: 24, spiritPower: 86, regen: 12, lifesteal: 25, cooldownReduction: 30 }),
    attributeCaps: { strength: 20, agility: 20, intellect: 16 },
    defaultSpread: { strength: 12, agility: 12, intellect: 6 },
  },
  {
    id: 'assassin',
    name: 'Assassin',
    description: 'Picks off isolated or low-health targets, then escapes.',
    base: sheet({ maxHealth: 1512, armor: 8, magicResist: 8, moveSpeed: 6.8, attackSpeed: 1.3, weaponDamage: 55, fireRate: 1.3, ammo: 10, spiritPower: 15, regen: 2, lifesteal: 6, cooldownReduction: 5 }),
    weights: { strength: 0.75, agility: 1.35, intellect: 0.95 },
    caps: sheet({ maxHealth: 3104, armor: 30, magicResist: 30, moveSpeed: 9, attackSpeed: 2.4, weaponDamage: 113, fireRate: 2.4, ammo: 24, spiritPower: 85, regen: 8, lifesteal: 25, cooldownReduction: 35 }),
    attributeCaps: { strength: 14, agility: 22, intellect: 18 },
    defaultSpread: { strength: 6, agility: 16, intellect: 8 },
  },
  {
    id: 'mage',
    name: 'Mage',
    description: 'Wins with skill damage, zones and control from mid range.',
    base: sheet({ maxHealth: 2087, armor: 12, magicResist: 16, moveSpeed: 6, attackSpeed: 0.9, weaponDamage: 25, fireRate: 0.9, ammo: 12, spiritPower: 24, regen: 2.5, lifesteal: 0, cooldownReduction: 8 }),
    weights: { strength: 0.75, agility: 0.8, intellect: 1.4 },
    caps: sheet({ maxHealth: 4173, armor: 30, magicResist: 45, moveSpeed: 7.6, attackSpeed: 1.6, weaponDamage: 49, fireRate: 1.6, ammo: 24, spiritPower: 92, regen: 9, lifesteal: 15, cooldownReduction: 40 }),
    attributeCaps: { strength: 14, agility: 16, intellect: 22 },
    defaultSpread: { strength: 6, agility: 6, intellect: 18 },
  },
  {
    id: 'marksman',
    name: 'Marksman',
    description: 'Deals steady ranged weapon damage from behind the front line.',
    base: sheet({ maxHealth: 1733, armor: 8, magicResist: 8, moveSpeed: 6.2, attackSpeed: 1.2, weaponDamage: 51, fireRate: 1.3, ammo: 16, spiritPower: 12, regen: 2, lifesteal: 5, cooldownReduction: 0 }),
    weights: { strength: 0.75, agility: 1.4, intellect: 0.85 },
    caps: sheet({ maxHealth: 3544, armor: 30, magicResist: 30, moveSpeed: 8, attackSpeed: 2.4, weaponDamage: 117, fireRate: 2.6, ammo: 36, spiritPower: 81, regen: 8, lifesteal: 25, cooldownReduction: 30 }),
    attributeCaps: { strength: 14, agility: 22, intellect: 16 },
    defaultSpread: { strength: 6, agility: 18, intellect: 6 },
  },
  {
    id: 'support',
    name: 'Support',
    description: 'Heals, shields and buffs allies; disrupts enemy dives.',
    base: sheet({ maxHealth: 2159, armor: 10, magicResist: 14, moveSpeed: 6.1, attackSpeed: 0.9, weaponDamage: 41, fireRate: 0.9, ammo: 12, spiritPower: 30, regen: 2.5, lifesteal: 0, cooldownReduction: 10 }),
    weights: { strength: 0.95, agility: 0.75, intellect: 1.3 },
    caps: sheet({ maxHealth: 4319, armor: 36, magicResist: 45, moveSpeed: 7.6, attackSpeed: 1.6, weaponDamage: 70, fireRate: 1.6, ammo: 24, spiritPower: 129, regen: 12, lifesteal: 15, cooldownReduction: 40 }),
    attributeCaps: { strength: 16, agility: 16, intellect: 22 },
    defaultSpread: { strength: 10, agility: 4, intellect: 16 },
  },
]

export const ROLE_IDS: readonly RoleId[] = ROLES.map((role) => role.id)

export function getRole(id: RoleId): Role {
  const role = ROLES.find((r) => r.id === id)
  if (!role) throw new Error(`Unknown role: ${id}`)
  return role
}

export function isRoleId(value: unknown): value is RoleId {
  return typeof value === 'string' && (ROLE_IDS as readonly string[]).includes(value)
}
