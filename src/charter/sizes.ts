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
 * amounts to a tank and a marksman: a tiny tank needs twice the health to keep up, and since the canon's melee
 * (2026-11-01) a big body that fights from range is a target that needs up to two and a half times its health.
 */
export const SIZE_HEALTH: Partial<Record<RoleId, Partial<Record<SizeClass, number>>>> = {
  tank: { tiny: 1.858, small: 0.973, large: 0.878, huge: 1.241 },
  fighter: { tiny: 0.978, small: 1.062, large: 1.041, huge: 1.046 },
  assassin: { tiny: 1.015, small: 0.983, large: 1.087, huge: 1.127 },
  mage: { tiny: 1.023, small: 1.057, large: 1.785, huge: 2.088 },
  marksman: { tiny: 1.083, small: 1.043, large: 1.891, huge: 2.653 },
  support: { tiny: 1.513, small: 0.855, large: 1.284, huge: 1.041 },
  controller: { tiny: 0.934, small: 0.974, large: 1.115, huge: 1.239 },
  summoner: { tiny: 0.928, small: 0.944, large: 1.03, huge: 1.135 },
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
