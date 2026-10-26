import { FORMS, MOTIFS } from '../../charter/skill-look.js'
import type { Delivery } from '../../charter/types.js'

/**
 * The effect kit as data (KTD11, R21, R33): a versioned recipe per skill. Layers are primitives placed in timed
 * phases. Every size is a fraction of the skill's own delivery geometry, never metres, so a recipe cannot misstate
 * how big a hit area is (R11): a damaging layer may be at most the real size, and glow beyond it never damages.
 * Skill looks (src/charter/skill-look.ts) build their recipes from these primitives; the ones after `gather` came
 * with them, and a recipe from before them is still valid.
 */
export const RECIPE_VERSION = 1

export const PRIMITIVES = [
  'orb',
  'beam',
  'ring',
  'trail',
  'cone',
  'aura',
  'crack',
  'sky',
  'form',
  'burst',
  'sparks',
  'gather',
  'arc',
  'helix',
  'crescent',
  'disc',
  'shard',
  'pillar',
  'meteor',
  'dome',
  'afterimage',
  'smoke',
  'chain',
  'motif',
  'swing',
  'rain',
  'vortex',
  'field',
] as const
export type Primitive = (typeof PRIMITIVES)[number]

/** The variants some primitives draw in; a layer without a style draws the first. */
export const STYLES: Partial<Record<Primitive, readonly string[]>> = {
  beam: FORMS.beam,
  cone: FORMS.cone,
  aura: FORMS.aura,
  swing: FORMS.melee,
  shard: ['crystal', 'bolt', 'arrow'],
  dome: ['dome', 'shield'],
  smoke: ['pop', 'rocket'],
  gather: ['gather', 'crackle', 'point'],
  motif: MOTIFS,
}

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
  /** The primitive's variant (STYLES): a beam's profile, a cone's spray, a motif's picture. */
  style?: string
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
