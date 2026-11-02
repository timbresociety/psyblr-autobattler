import type { RoleId } from './types.js'

/**
 * Size classes (R14, KTD8). Players pick any class for any role. Medium is the baseline the catalogue was
 * tuned on, so it changes nothing. Bigger heroes reach further but are slower and easier to hit; smaller ones
 * the reverse. The body is drawn at `scale` and the hit capsule matches it, so what the audience sees is what can be
 * hit (R23). A class's health price depends on the role wearing it (`sizeHealth`), tuned on the 3D arena engine so
 * every role and class pairing sits near 50% against the field; the balance gate still prices each build.
 */
export type SizeClass = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'colossal'

export interface SizeProfile {
  label: string
  /** The body's scale against medium: the model is drawn at this size and its hit capsule grows with it. */
  scale: number
  /** Metres added to the medium hit capsule's 0.4 m radius; always 0.4 × (scale − 1), so hitbox and body agree. */
  hitRadius: number
  /** Metres added to melee reach. */
  reachBonus: number
  /** The health price when no role-specific one is set (colossal, and any role missing from SIZE_HEALTH). */
  healthMul: number
  speedMul: number
}

/** The classes a player can choose (R44). */
export const SIZE_CLASSES: readonly SizeClass[] = ['tiny', 'small', 'medium', 'large', 'huge']

/** Every class, including `colossal`, which only a transformation reaches (R44, KTD14). */
export const ALL_SIZE_CLASSES: readonly SizeClass[] = [...SIZE_CLASSES, 'colossal']

/** A body at `scale`: the hit radius follows from the medium capsule's 0.4 m. */
const body = (scale: number) => ({ scale, hitRadius: Math.round(0.4 * (scale - 1) * 1000) / 1000 })

export const SIZES: Record<SizeClass, SizeProfile> = {
  tiny: { label: 'Tiny', ...body(0.8), reachBonus: -0.5, healthMul: 1, speedMul: 1.16 },
  small: { label: 'Small', ...body(0.9), reachBonus: -0.25, healthMul: 1, speedMul: 1.08 },
  medium: { label: 'Medium', ...body(1), reachBonus: 0, healthMul: 1, speedMul: 1 },
  large: { label: 'Large', ...body(1.15), reachBonus: 0.4, healthMul: 1, speedMul: 0.88 },
  huge: { label: 'Huge', ...body(1.3), reachBonus: 0.75, healthMul: 1, speedMul: 0.78 },
  colossal: { label: 'Colossal', ...body(1.6), reachBonus: 2, healthMul: 1.37, speedMul: 0.85 },
}

/**
 * What each class costs each role in health, tuned so every size of a role does as well in 3v3 skirmishes as the same
 * role at medium. Reach decides blade fights and a small body slips shots, so the same class is worth very different
 * amounts to a tank and a support. Retuned for the kit engine (GAME.md §4, every hero carries a ranged weapon and a
 * melee style): most classes now sit near the role's medium health, a small tank needs nearly twice it, and a support
 * any size off medium pays about half (the old prices left a huge marksman winning 98%).
 */
export const SIZE_HEALTH: Partial<Record<RoleId, Partial<Record<SizeClass, number>>>> = {
  tank: { tiny: 1.244, small: 1.827, large: 1.349, huge: 0.88 },
  fighter: { tiny: 0.978, small: 1.157, large: 0.983, huge: 1.108 },
  assassin: { tiny: 1.075, small: 0.983, large: 1.087, huge: 1.064 },
  mage: { tiny: 0.802, small: 0.841, large: 1.066, huge: 0.992 },
  marksman: { tiny: 1.023, small: 0.971, large: 0.951, huge: 1.077 },
  support: { tiny: 0.957, small: 0.462, large: 0.544, huge: 0.524 },
  controller: { tiny: 0.934, small: 0.974, large: 1.068, huge: 0.904 },
  summoner: { tiny: 0.902, small: 0.751, large: 0.893, huge: 0.877 },
}

/** The health multiplier `role` pays for `size`. */
export const sizeHealth = (role: RoleId | string, size: SizeClass) => SIZE_HEALTH[role as RoleId]?.[size] ?? SIZES[size].healthMul

export function isAnySizeClass(value: unknown): value is SizeClass {
  return typeof value === 'string' && (ALL_SIZE_CLASSES as readonly string[]).includes(value)
}

/** A class a player may choose; `colossal` is reachable only by transforming. */
export function isSizeClass(value: unknown): value is SizeClass {
  return typeof value === 'string' && (SIZE_CLASSES as readonly string[]).includes(value)
}
