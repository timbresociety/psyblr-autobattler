/**
 * Size classes (R14, KTD8). Players pick any class for any role. Medium is the baseline the catalogue was
 * tuned on, so it changes nothing. Bigger heroes reach further but are slower and easier to hit; smaller ones
 * the reverse. Health multipliers were tuned on the 3D arena engine so each choosable class averages about 50%
 * against the field; the balance gate still prices each individual build at its size.
 */
export type SizeClass = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'colossal'

export interface SizeProfile {
  label: string
  /** Metres added to the hitbox when area effects check who they hit. */
  hitRadius: number
  /** Metres added to melee reach. */
  reachBonus: number
  healthMul: number
  speedMul: number
}

/** The classes a player can choose (R44). */
export const SIZE_CLASSES: readonly SizeClass[] = ['tiny', 'small', 'medium', 'large', 'huge']

/** Every class, including `colossal`, which only a transformation reaches (R44, KTD14). */
export const ALL_SIZE_CLASSES: readonly SizeClass[] = [...SIZE_CLASSES, 'colossal']

export const SIZES: Record<SizeClass, SizeProfile> = {
  tiny: { label: 'Tiny', hitRadius: -0.6, reachBonus: -0.5, healthMul: 1.055, speedMul: 1.16 },
  small: { label: 'Small', hitRadius: -0.3, reachBonus: -0.25, healthMul: 0.945, speedMul: 1.08 },
  medium: { label: 'Medium', hitRadius: 0, reachBonus: 0, healthMul: 1, speedMul: 1 },
  large: { label: 'Large', hitRadius: 0.9, reachBonus: 0.5, healthMul: 1.115, speedMul: 0.88 },
  huge: { label: 'Huge', hitRadius: 1.8, reachBonus: 1, healthMul: 1.155, speedMul: 0.78 },
  colossal: { label: 'Colossal', hitRadius: 2.4, reachBonus: 2, healthMul: 1.37, speedMul: 0.85 },
}

export function isAnySizeClass(value: unknown): value is SizeClass {
  return typeof value === 'string' && (ALL_SIZE_CLASSES as readonly string[]).includes(value)
}

/** A class a player may choose; `colossal` is reachable only by transforming. */
export function isSizeClass(value: unknown): value is SizeClass {
  return typeof value === 'string' && (SIZE_CLASSES as readonly string[]).includes(value)
}
