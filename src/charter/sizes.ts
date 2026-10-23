import type { RoleId } from './types'

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
 * What each class costs each role in health. Reach decides blade fights and a small body slips shots, so the same
 * class is worth very different amounts to a fighter and a marksman; one price for all left a tiny marksman winning
 * three duels in four and a tiny assassin almost none.
 */
export const SIZE_HEALTH: Partial<Record<RoleId, Partial<Record<SizeClass, number>>>> = {
  tank: { tiny: 1.366, small: 1.041, large: 1.009, huge: 1.015 },
  fighter: { tiny: 1.062, small: 1.001, large: 1.009, huge: 1.017 },
  assassin: { tiny: 1.318, small: 1.05, large: 0.991, huge: 1.019 },
  mage: { tiny: 1.027, small: 1.012, large: 1.037, huge: 1.038 },
  marksman: { tiny: 1.001, small: 1.004, large: 1.025, huge: 1.019 },
  support: { tiny: 0.957, small: 0.993, large: 1.097, huge: 1.086 },
  controller: { tiny: 0.965, small: 1.018, large: 0.995, huge: 1.034 },
  summoner: { tiny: 0.972, small: 0.995, large: 0.995, huge: 1.01 },
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
