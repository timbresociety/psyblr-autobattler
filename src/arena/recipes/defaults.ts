import type { Delivery } from '../../charter/types'
import { RECIPE_VERSION, type EffectRecipe, type Primitive, type RecipeLayer, type RecipeLook } from './schema'

/** Each delivery kind's core layers: what shows the hit area, and where. */
const CORE: Record<Delivery['kind'], RecipeLayer[]> = {
  melee: [{ primitive: 'cone', phase: 'impact', size: 1, color: 0, damaging: true }, { primitive: 'burst', phase: 'impact', size: 0.4, color: 1 }],
  projectile: [{ primitive: 'orb', phase: 'travel', size: 1, color: 0, damaging: true }, { primitive: 'trail', phase: 'travel', size: 0.8, color: 1 }, { primitive: 'burst', phase: 'impact', size: 1, color: 1 }],
  beam: [{ primitive: 'beam', phase: 'impact', size: 1, color: 0, damaging: true }, { primitive: 'beam', phase: 'impact', size: 1.6, color: 1 }],
  cone: [{ primitive: 'cone', phase: 'impact', size: 1, color: 0, damaging: true }, { primitive: 'sparks', phase: 'impact', size: 0.8, color: 2 }],
  zone: [{ primitive: 'ring', phase: 'impact', size: 1, color: 0, damaging: true }, { primitive: 'crack', phase: 'linger', size: 0.9, color: 1 }, { primitive: 'burst', phase: 'impact', size: 0.6, color: 2 }],
  aura: [{ primitive: 'aura', phase: 'impact', size: 1, color: 0, damaging: true }, { primitive: 'ring', phase: 'impact', size: 1, color: 1 }],
  self: [{ primitive: 'aura', phase: 'impact', size: 0.6, color: 0 }, { primitive: 'sparks', phase: 'linger', size: 0.5, color: 1 }],
  dash: [{ primitive: 'trail', phase: 'travel', size: 1, color: 0 }, { primitive: 'burst', phase: 'impact', size: 0.6, color: 1, damaging: true }],
  blink: [{ primitive: 'burst', phase: 'charge', size: 0.6, color: 1 }, { primitive: 'burst', phase: 'impact', size: 0.6, color: 0, damaging: true }],
  leap: [{ primitive: 'trail', phase: 'travel', size: 0.8, color: 0 }, { primitive: 'ring', phase: 'impact', size: 0.8, color: 1, damaging: true }],
  grapple: [{ primitive: 'beam', phase: 'travel', size: 0.3, color: 0 }, { primitive: 'burst', phase: 'impact', size: 0.5, color: 1, damaging: true }],
}

/** Neutral looks per delivery, for skills with no look of their own (v1 heroes, AE7). */
const DEFAULT_PALETTES: Record<Delivery['kind'], [string, string, string]> = {
  melee: ['#ffffff', '#ffd27a', '#ff8a3d'],
  projectile: ['#bfe8ff', '#4fb2ff', '#ffffff'],
  beam: ['#ffffff', '#7ad0ff', '#2a6cff'],
  cone: ['#ffe2a6', '#ff9a3d', '#ffffff'],
  zone: ['#ffcf8a', '#ff6b2d', '#5a3a2a'],
  aura: ['#d6fff0', '#5affc4', '#ffffff'],
  self: ['#fff6c2', '#ffd93d', '#ffffff'],
  dash: ['#ffffff', '#9ad8ff', '#4fb2ff'],
  blink: ['#e6d6ff', '#9a6bff', '#ffffff'],
  leap: ['#ffe2a6', '#ffb347', '#ffffff'],
  grapple: ['#ffffff', '#c0c0c0', '#ffb84d'],
}

const EXTRA: Partial<Record<Primitive, RecipeLayer>> = {
  sky: { primitive: 'sky', phase: 'charge', size: 1, color: 1 },
  gather: { primitive: 'gather', phase: 'charge', size: 1.5, color: 1 },
  sparks: { primitive: 'sparks', phase: 'impact', size: 0.8, color: 2 },
  crack: { primitive: 'crack', phase: 'linger', size: 0.9, color: 2 },
  aura: { primitive: 'aura', phase: 'charge', size: 0.6, color: 1 },
  form: { primitive: 'form', phase: 'linger', size: 1, color: 0 },
  trail: { primitive: 'trail', phase: 'travel', size: 0.8, color: 2 },
  ring: { primitive: 'ring', phase: 'impact', size: 1.3, color: 2 },
  burst: { primitive: 'burst', phase: 'impact', size: 1, color: 2 },
}

/**
 * Build a skill's recipe from its delivery and a look (R33). The delivery's core layers always come first and carry
 * the hit area at its true size; the look only adds colour and extra layers, which never damage.
 */
export function composeRecipe(kind: Delivery['kind'], look?: RecipeLook): EffectRecipe {
  const layers = CORE[kind].map((l) => ({ ...l }))
  for (const p of look?.feature ?? []) {
    const extra = EXTRA[p]
    if (extra && !layers.some((l) => l.primitive === p && l.phase === extra.phase)) layers.push({ ...extra })
  }
  // a charged skill gathers energy and darkens the sky before release
  if (look?.charged) for (const p of ['gather', 'sky'] as const) if (!layers.some((l) => l.primitive === p)) layers.push({ ...EXTRA[p]! })
  if (look?.charged) {
    const core = layers.find((l) => l.damaging)
    if (core && kind === 'projectile') core.intensity = 1.6
  }
  return {
    version: RECIPE_VERSION,
    delivery: kind,
    palette: look?.palette ?? DEFAULT_PALETTES[kind],
    intensity: look?.intensity ?? 1,
    charge: look?.charged ? 1.2 : kind === 'beam' || kind === 'zone' ? 0.3 : 0.1,
    linger: kind === 'zone' || kind === 'aura' ? 1.2 : 0.4,
    layers,
  }
}

export const defaultRecipe = (kind: Delivery['kind']) => composeRecipe(kind)

/** The passive's look: a cloak around the body, or a glowing element on it. */
export function passiveRecipe(visual: 'aura' | 'body-element', look?: RecipeLook): EffectRecipe {
  const base = composeRecipe('self', look)
  const layers: RecipeLayer[] = visual === 'aura' ? [{ primitive: 'aura', phase: 'linger', size: 1, color: 0 }, { primitive: 'sparks', phase: 'linger', size: 0.6, color: 1 }] : [{ primitive: 'burst', phase: 'linger', size: 0.25, color: 0 }, { primitive: 'trail', phase: 'linger', size: 0.3, color: 1 }]
  return { ...base, layers, charge: 0, linger: 0 }
}
