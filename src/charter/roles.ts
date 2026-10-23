import type { Role, RoleId, SecondarySheet } from './types'

/** Units: health points, armor/resist/lifesteal/cooldown reduction in %, speed in m/s, rates per second. */
const sheet = (s: SecondarySheet): SecondarySheet => s

export const ROLES: readonly Role[] = [
  {
    id: 'tank',
    name: 'Tank',
    description: 'Holds the front and soaks the damage meant for the team.',
    base: sheet({ maxHealth: 3800, armor: 16, magicResist: 18, moveSpeed: 5.6, attackSpeed: 0.9, weaponDamage: 49.8, fireRate: 0.9, ammo: 8, spiritPower: 19.8, regen: 2.5, lifesteal: 0, cooldownReduction: 0 }),
    weights: { strength: 1.4, agility: 0.7, intellect: 0.8 },
    caps: sheet({ maxHealth: 7600, armor: 60, magicResist: 50, moveSpeed: 7, attackSpeed: 1.6, weaponDamage: 103.3, fireRate: 1.6, ammo: 20, spiritPower: 129.1, regen: 16, lifesteal: 15, cooldownReduction: 30 }),
    attributeCaps: { strength: 22, agility: 16, intellect: 16 },
    defaultSpread: { strength: 16, agility: 6, intellect: 8 },
  },
  {
    id: 'fighter',
    name: 'Fighter',
    description: 'Wins long close-range brawls: hits hard, heals off its hits, stays in.',
    base: sheet({ maxHealth: 2000, armor: 16, magicResist: 12, moveSpeed: 6.2, attackSpeed: 1.1, weaponDamage: 28.6, fireRate: 1.1, ammo: 10, spiritPower: 10.9, regen: 3, lifesteal: 2, cooldownReduction: 0 }),
    weights: { strength: 1.15, agility: 1.05, intellect: 0.8 },
    caps: sheet({ maxHealth: 4136, armor: 45, magicResist: 40, moveSpeed: 8, attackSpeed: 2, weaponDamage: 72.1, fireRate: 2, ammo: 24, spiritPower: 61.2, regen: 12, lifesteal: 25, cooldownReduction: 30 }),
    attributeCaps: { strength: 20, agility: 20, intellect: 16 },
    defaultSpread: { strength: 12, agility: 12, intellect: 6 },
  },
  {
    id: 'assassin',
    name: 'Assassin',
    description: 'Bursts down isolated or low-health targets, then gets out.',
    base: sheet({ maxHealth: 1700, armor: 8, magicResist: 8, moveSpeed: 6.8, attackSpeed: 1.3, weaponDamage: 82.9, fireRate: 1.3, ammo: 10, spiritPower: 22.5, regen: 2, lifesteal: 6, cooldownReduction: 5 }),
    weights: { strength: 0.75, agility: 1.35, intellect: 0.95 },
    caps: sheet({ maxHealth: 3489, armor: 30, magicResist: 30, moveSpeed: 9, attackSpeed: 2.4, weaponDamage: 171.6, fireRate: 2.4, ammo: 24, spiritPower: 129.3, regen: 8, lifesteal: 25, cooldownReduction: 35 }),
    attributeCaps: { strength: 14, agility: 22, intellect: 18 },
    defaultSpread: { strength: 6, agility: 16, intellect: 8 },
  },
  {
    id: 'mage',
    name: 'Mage',
    description: 'Deals burst and area spell damage from mid range.',
    base: sheet({ maxHealth: 1900, armor: 12, magicResist: 16, moveSpeed: 6, attackSpeed: 0.9, weaponDamage: 61.9, fireRate: 0.9, ammo: 12, spiritPower: 57.9, regen: 2.5, lifesteal: 0, cooldownReduction: 8 }),
    weights: { strength: 0.75, agility: 0.8, intellect: 1.4 },
    caps: sheet({ maxHealth: 3800, armor: 30, magicResist: 45, moveSpeed: 7.6, attackSpeed: 1.6, weaponDamage: 119.9, fireRate: 1.6, ammo: 24, spiritPower: 224.9, regen: 9, lifesteal: 15, cooldownReduction: 40 }),
    attributeCaps: { strength: 14, agility: 16, intellect: 22 },
    defaultSpread: { strength: 6, agility: 6, intellect: 18 },
  },
  {
    id: 'marksman',
    name: 'Marksman',
    description: 'Deals steady weapon damage from long range, behind the front line.',
    base: sheet({ maxHealth: 1700, armor: 8, magicResist: 8, moveSpeed: 6.2, attackSpeed: 1.2, weaponDamage: 58.7, fireRate: 1.3, ammo: 16, spiritPower: 13.3, regen: 2, lifesteal: 5, cooldownReduction: 0 }),
    weights: { strength: 0.75, agility: 1.4, intellect: 0.85 },
    caps: sheet({ maxHealth: 3477, armor: 30, magicResist: 30, moveSpeed: 8, attackSpeed: 2.4, weaponDamage: 136.2, fireRate: 2.6, ammo: 36, spiritPower: 94.7, regen: 8, lifesteal: 25, cooldownReduction: 30 }),
    attributeCaps: { strength: 14, agility: 22, intellect: 16 },
    defaultSpread: { strength: 6, agility: 18, intellect: 6 },
  },
  {
    id: 'support',
    name: 'Support',
    description: 'Keeps allies alive and stronger: heals, shields, buffs and cleanses.',
    base: sheet({ maxHealth: 2000, armor: 10, magicResist: 14, moveSpeed: 6.1, attackSpeed: 0.9, weaponDamage: 64.6, fireRate: 0.9, ammo: 12, spiritPower: 45.7, regen: 2.5, lifesteal: 0, cooldownReduction: 10 }),
    weights: { strength: 0.95, agility: 0.75, intellect: 1.3 },
    caps: sheet({ maxHealth: 4002, armor: 36, magicResist: 45, moveSpeed: 7.6, attackSpeed: 1.6, weaponDamage: 109.7, fireRate: 1.6, ammo: 24, spiritPower: 194.2, regen: 12, lifesteal: 15, cooldownReduction: 40 }),
    attributeCaps: { strength: 16, agility: 16, intellect: 22 },
    defaultSpread: { strength: 10, agility: 4, intellect: 16 },
  },
  {
    id: 'controller',
    name: 'Controller',
    description: 'Takes enemies out of the fight: stuns, roots, silences, pulls and walls them off.',
    base: sheet({ maxHealth: 1900, armor: 12, magicResist: 16, moveSpeed: 6, attackSpeed: 0.9, weaponDamage: 57.1, fireRate: 0.9, ammo: 12, spiritPower: 51.3, regen: 2.5, lifesteal: 0, cooldownReduction: 10 }),
    weights: { strength: 0.85, agility: 0.75, intellect: 1.35 },
    caps: sheet({ maxHealth: 3800, armor: 34, magicResist: 45, moveSpeed: 7.6, attackSpeed: 1.6, weaponDamage: 108.4, fireRate: 1.6, ammo: 24, spiritPower: 213.9, regen: 10, lifesteal: 15, cooldownReduction: 45 }),
    attributeCaps: { strength: 16, agility: 14, intellect: 22 },
    defaultSpread: { strength: 8, agility: 4, intellect: 18 },
  },
  {
    id: 'summoner',
    name: 'Summoner',
    description: 'Fights through what it leaves on the field: turrets, traps, totems and walls.',
    base: sheet({ maxHealth: 1800, armor: 10, magicResist: 14, moveSpeed: 6, attackSpeed: 1, weaponDamage: 62.6, fireRate: 1, ammo: 14, spiritPower: 56.5, regen: 2.5, lifesteal: 0, cooldownReduction: 8 }),
    weights: { strength: 0.8, agility: 0.9, intellect: 1.3 },
    caps: sheet({ maxHealth: 3600, armor: 30, magicResist: 40, moveSpeed: 7.6, attackSpeed: 1.8, weaponDamage: 130.9, fireRate: 1.8, ammo: 28, spiritPower: 238, regen: 9, lifesteal: 15, cooldownReduction: 40 }),
    attributeCaps: { strength: 14, agility: 18, intellect: 22 },
    defaultSpread: { strength: 6, agility: 8, intellect: 16 },
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
