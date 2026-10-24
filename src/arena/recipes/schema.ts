import type { Delivery } from '../../charter/types.js'

/**
 * The effect kit as data (KTD11, R21, R33): a versioned recipe per skill. Layers are primitives placed in timed
 * phases. Every size is a fraction of the skill's own delivery geometry, never metres, so a recipe cannot misstate
 * how big a hit area is (R11): a damaging layer may be at most the real size, and glow beyond it never damages.
 */
export const RECIPE_VERSION = 1

export const PRIMITIVES = ['orb', 'beam', 'ring', 'trail', 'cone', 'aura', 'crack', 'sky', 'form', 'burst', 'sparks', 'gather'] as const
export type Primitive = (typeof PRIMITIVES)[number]

export const PHASES = ['charge', 'travel', 'impact', 'linger'] as const
export type Phase = (typeof PHASES)[number]

export interface RecipeLayer {
  primitive: Primitive
  phase: Phase
  /** Fraction of the delivery's size: radius for areas, width for beams, the projectile for shots. */
  size: number
  /** Index into the palette. */
  color: 0 | 1 | 2
  /** True for the layer that shows the hit area; it must not be drawn bigger than the area (size <= 1). */
  damaging?: boolean
  intensity?: number
}

export interface EffectRecipe {
  version: typeof RECIPE_VERSION
  delivery: Delivery['kind']
  /** Three hex colours: core, glow, accent. */
  palette: [string, string, string]
  intensity: number
  /** Seconds for the charge-up and how long the effect lingers after it lands. */
  charge: number
  linger: number
  layers: RecipeLayer[]
}

/** What the cultural director picks for a skill: colours and the primitives it should feature. */
export interface RecipeLook {
  palette: [string, string, string]
  feature: Primitive[]
  intensity?: number
  /** Gathers energy before release, like a Spirit Bomb. */
  charged?: boolean
}
