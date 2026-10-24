import type { Build } from './build.js'
import type { RoleId, SecondaryStat } from './types.js'

/**
 * Role synergies (traits), the way TFT and Underlords do them: every role is a trait, and fielding 2, 4 or 6 heroes of
 * one role in an army lights its tiers, each stronger than the last. A trait mostly strengthens its own role, and its
 * higher tiers reach the rest of the side too. Traits only exist in army fights: the balance gate measures heroes in
 * 3v3 skirmishes without them, so a hero's own numbers stay balanced however an army is built (src/sim/gate.ts).
 */

export const TRAIT_TIERS = [2, 4, 6] as const

/** What a trait tier changes about a hero: its derived stats, plus a few combat effects the engine reads. */
export interface TraitMods {
  /** Multiplies a derived stat: armor 0.2 is +20% armor. */
  mul?: Partial<Record<SecondaryStat, number>>
  /** Adds to a derived stat: lifesteal 4 is +4 lifesteal. */
  add?: Partial<Record<SecondaryStat, number>>
  /** The heals and shields this hero gives, +X. */
  healPower?: number
  /** How long this hero's stuns, slows and other control last, +X. */
  controlPower?: number
  /** This hero's zones, traps, turrets and walls: their damage and toughness, +X. */
  constructPower?: number
  /** Damage this hero deals to targets under half health, +X. */
  lowHpBonus?: number
  /** Seconds this hero starts the fight stealthed. */
  stealthStart?: number
}

export interface TraitTier {
  /** What the role's own heroes get. */
  members: TraitMods
  /** What the rest of the side gets, if anything. */
  others?: TraitMods
  /** The tier in a line, for panels and tooltips. */
  text: string
}

export interface Trait {
  role: RoleId
  name: string
  /** What the trait is about, in a few words. */
  blurb: string
  tiers: readonly [TraitTier, TraitTier, TraitTier]
}

const both = (pct: number) => ({ armor: pct, magicResist: pct })
const rate = (pct: number) => ({ attackSpeed: pct, fireRate: pct })

export const TRAITS: Record<RoleId, Trait> = {
  tank: {
    role: 'tank',
    name: 'Bulwark',
    blurb: 'Tanks harden, then the whole line does',
    tiers: [
      { members: { mul: both(0.2) }, text: 'Tanks +20% armor and spirit resist' },
      { members: { mul: both(0.4) }, others: { mul: both(0.1) }, text: 'Tanks +40%, everyone else +10%' },
      { members: { mul: both(0.7) }, others: { mul: both(0.2) }, text: 'Tanks +70%, everyone else +20%' },
    ],
  },
  fighter: {
    role: 'fighter',
    name: 'Brawler',
    blurb: 'Fighters get bigger and drink deeper',
    tiers: [
      { members: { mul: { maxHealth: 0.12 }, add: { lifesteal: 4 } }, text: 'Fighters +12% health, +4 lifesteal' },
      { members: { mul: { maxHealth: 0.25 }, add: { lifesteal: 8 } }, text: 'Fighters +25% health, +8 lifesteal' },
      { members: { mul: { maxHealth: 0.4 }, add: { lifesteal: 14 } }, text: 'Fighters +40% health, +14 lifesteal' },
    ],
  },
  assassin: {
    role: 'assassin',
    name: 'Ambush',
    blurb: 'Assassins finish the wounded, unseen',
    tiers: [
      { members: { lowHpBonus: 0.15 }, text: 'Assassins +15% damage to targets under half health' },
      { members: { lowHpBonus: 0.3, stealthStart: 1.5 }, text: '+30%, and they start the fight stealthed for 1.5 s' },
      { members: { lowHpBonus: 0.5, stealthStart: 3 }, text: '+50%, and 3 s of stealth to start' },
    ],
  },
  mage: {
    role: 'mage',
    name: 'Arcana',
    blurb: 'Mages hit harder, then lend their power',
    tiers: [
      { members: { mul: { spiritPower: 0.15 } }, text: 'Mages +15% spirit power' },
      { members: { mul: { spiritPower: 0.35 } }, others: { mul: { spiritPower: 0.08 } }, text: 'Mages +35%, everyone else +8%' },
      { members: { mul: { spiritPower: 0.6 } }, others: { mul: { spiritPower: 0.15 } }, text: 'Mages +60%, everyone else +15%' },
    ],
  },
  marksman: {
    role: 'marksman',
    name: 'Volley',
    blurb: 'Marksmen fire faster',
    tiers: [
      { members: { mul: rate(0.15) }, text: 'Marksmen +15% attack and fire rate' },
      { members: { mul: rate(0.3) }, text: 'Marksmen +30% attack and fire rate' },
      { members: { mul: rate(0.5) }, text: 'Marksmen +50% attack and fire rate' },
    ],
  },
  support: {
    role: 'support',
    name: 'Lifeline',
    blurb: 'Supports heal and shield more',
    tiers: [
      { members: { healPower: 0.2 }, text: "Supports' heals and shields +20%" },
      { members: { healPower: 0.4 }, text: "Supports' heals and shields +40%" },
      { members: { healPower: 0.7 }, text: "Supports' heals and shields +70%" },
    ],
  },
  controller: {
    role: 'controller',
    name: 'Lockdown',
    blurb: "Controllers' stuns and slows last longer",
    tiers: [
      { members: { controlPower: 0.15 }, text: "Controllers' crowd control lasts +15%" },
      { members: { controlPower: 0.3 }, text: "Controllers' crowd control lasts +30%" },
      { members: { controlPower: 0.5 }, text: "Controllers' crowd control lasts +50%" },
    ],
  },
  summoner: {
    role: 'summoner',
    name: 'Legion',
    blurb: "Summoners' zones, traps and turrets grow stronger",
    tiers: [
      { members: { constructPower: 0.25 }, text: "Summoners' turrets, traps and zones +25% damage and toughness" },
      { members: { constructPower: 0.5 }, text: "Summoners' turrets, traps and zones +50%" },
      { members: { constructPower: 0.9 }, text: "Summoners' turrets, traps and zones +90%" },
    ],
  },
}

/** The highest tier a count of heroes lights: -1 below the first, else 0, 1 or 2. */
export function traitTier(count: number): number {
  let tier = -1
  TRAIT_TIERS.forEach((need, i) => {
    if (count >= need) tier = i
  })
  return tier
}

export interface ArmyTrait {
  trait: Trait
  count: number
  /** -1 when the count hasn't reached the first tier. */
  tier: number
}

export function roleCounts(builds: readonly Pick<Build, 'roleId'>[]): Map<RoleId, number> {
  const counts = new Map<RoleId, number>()
  for (const b of builds) counts.set(b.roleId, (counts.get(b.roleId) ?? 0) + 1)
  return counts
}

/** Every role an army fields, as traits: the lit ones first, highest tier first, then by how close they are. */
export function armyTraits(builds: readonly Pick<Build, 'roleId'>[]): ArmyTrait[] {
  return [...roleCounts(builds)]
    .map(([role, count]) => ({ trait: TRAITS[role], count, tier: traitTier(count) }))
    .sort((a, b) => b.tier - a.tier || b.count - a.count || a.trait.name.localeCompare(b.trait.name))
}

function merge(into: TraitMods, add: TraitMods | undefined): TraitMods {
  if (!add) return into
  const out: TraitMods = { ...into }
  for (const key of ['mul', 'add'] as const) {
    const part = add[key]
    if (!part) continue
    const merged = { ...(out[key] ?? {}) }
    for (const [stat, v] of Object.entries(part) as [SecondaryStat, number][]) merged[stat] = (merged[stat] ?? 0) + v
    out[key] = merged
  }
  for (const key of ['healPower', 'controlPower', 'constructPower', 'lowHpBonus'] as const) if (add[key]) out[key] = (out[key] ?? 0) + add[key]!
  if (add.stealthStart) out.stealthStart = Math.max(out.stealthStart ?? 0, add.stealthStart)
  return out
}

/** What one hero gets from its army's lit traits: its own role's tier, plus every other trait's reach to the side. */
export function heroMods(build: Pick<Build, 'roleId'>, traits: readonly ArmyTrait[]): TraitMods {
  let mods: TraitMods = {}
  for (const t of traits) {
    if (t.tier < 0) continue
    const tier = t.trait.tiers[t.tier]
    mods = merge(mods, t.trait.role === build.roleId ? tier.members : tier.others)
  }
  return mods
}

/** Per-hero modifiers for an army fight, in army order: what the engine takes as each combatant's traits. */
export function armyModifiers(builds: Build[]): { build: Build; mods: TraitMods }[] {
  const traits = armyTraits(builds)
  return builds.map((build) => ({ build, mods: heroMods(build, traits) }))
}
