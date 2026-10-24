import { ELEMENT_LOOKS, FAMILY_OF, formOf, type Charge, type Form, type FormFamily, type Impact, type SkillLook, type Trail } from '../../charter/skill-look.js'
import type { Delivery } from '../../charter/types.js'
import { RECIPE_VERSION, type EffectRecipe, type Primitive, type RecipeLayer } from './schema.js'

const layer = (primitive: Primitive, phase: RecipeLayer['phase'], size: number, color: RecipeLayer['color'], style?: string): RecipeLayer => ({ primitive, phase, size, color, ...(style ? { style } : {}) })
const hit = (primitive: Primitive, phase: RecipeLayer['phase'], style?: string): RecipeLayer => ({ ...layer(primitive, phase, 1, 0, style), damaging: true })

/** What a projectile flies as, by form: the shape is the hit layer, so it is drawn as big as the shot. */
const SHOTS: Partial<Record<Form, [Primitive, string?]>> = {
  orb: ['orb'],
  bolt: ['shard', 'bolt'],
  disc: ['disc'],
  crescent: ['crescent'],
  shard: ['shard', 'crystal'],
  meteor: ['meteor'],
  arrow: ['shard', 'arrow'],
}

/**
 * The layer that shows the hit area, always at its true size: the beam itself, the shot in flight, the swing's arc,
 * the cone, the ring round a zone, the aura. A self-cast has no area. Dashes, blinks and grapples strike one hero
 * ahead, so theirs marks the point the blow lands; a leap that lands on an area rings it.
 */
function hitLayer(kind: Delivery['kind'], form: Form): RecipeLayer | undefined {
  switch (FAMILY_OF[kind]) {
    case 'beam':
      return hit('beam', 'impact', form)
    case 'projectile': {
      const [primitive, style] = SHOTS[form] ?? ['orb']
      return hit(primitive, 'travel', style)
    }
    case 'melee':
      return hit('cone', 'impact')
    case 'cone':
      return hit('cone', 'impact', form)
    case 'zone':
      return hit('ring', 'impact')
    case 'aura':
      return hit('aura', 'impact', form)
    case 'self':
      return undefined
    case 'movement':
      return kind === 'leap' ? hit('ring', 'impact') : hit('burst', 'impact')
  }
}

/** Each form's own decoration beside the hit layer. None of it damages. */
function formLayers(family: FormFamily, form: Form): RecipeLayer[] {
  switch (family) {
    case 'beam':
      // the soft glow around the beam, in the same profile
      return [layer('beam', 'impact', 1.6, 1, form)]
    case 'projectile':
      return [layer('trail', 'travel', 0.8, 1)]
    case 'melee':
      return [layer('swing', 'impact', 1, 1, form), layer('burst', 'impact', 0.4, 1)]
    case 'cone':
      return [layer('sparks', 'impact', 0.8, 2)]
    case 'zone':
      return {
        blast: [layer('burst', 'impact', 0.6, 2), layer('crack', 'linger', 0.9, 1)],
        rain: [layer('rain', 'linger', 1, 1)],
        pillar: [layer('pillar', 'impact', 1, 1)],
        dome: [layer('dome', 'impact', 1, 1)],
        quake: [layer('crack', 'linger', 1, 1), layer('smoke', 'impact', 1, 2, 'pop')],
        vortex: [layer('vortex', 'linger', 1, 1)],
        field: [layer('field', 'linger', 1, 1)],
      }[form as 'blast'] ?? []
    case 'aura':
      return form === 'ring' ? [layer('ring', 'impact', 1, 1)] : []
    case 'self':
      return {
        glow: [layer('aura', 'impact', 0.6, 0), layer('sparks', 'linger', 0.5, 1)],
        flare: [layer('burst', 'impact', 0.8, 0), layer('sparks', 'impact', 0.8, 2)],
        shield: [layer('dome', 'impact', 0.6, 1, 'shield')],
        spiral: [layer('helix', 'impact', 0.6, 1)],
      }[form as 'glow'] ?? []
    case 'movement':
      // drawn along the way from where the hero was to where it lands
      return {
        streak: [layer('trail', 'travel', 1, 0)],
        afterimage: [layer('afterimage', 'travel', 1, 1)],
        smoke: [layer('smoke', 'travel', 1, 2, 'pop')],
        flash: [layer('burst', 'travel', 0.8, 1)],
        rocket: [layer('smoke', 'travel', 1, 2, 'rocket')],
        chain: [layer('chain', 'travel', 1, 0)],
      }[form as 'streak'] ?? []
  }
}

const CHARGE_LAYERS: Record<Charge, RecipeLayer[]> = {
  gather: [layer('gather', 'charge', 1.5, 1)],
  sky: [layer('gather', 'charge', 1.5, 1), layer('sky', 'charge', 1, 1)],
  crackle: [layer('gather', 'charge', 1, 2, 'crackle')],
  point: [layer('gather', 'charge', 0.5, 0, 'point')],
}
const CHARGE_SECONDS: Record<Charge, number> = { gather: 0.6, sky: 1.2, crackle: 0.5, point: 0.4 }

/** How big a landing reads beside the skill's own size: a beam's end blooms well past its width. */
const IMPACT_SCALE: Record<FormFamily, number> = { beam: 2.4, projectile: 1.8, melee: 0.5, cone: 0.5, zone: 1, aura: 1, self: 0, movement: 1 }

function impactLayers(impact: Impact, s: number): RecipeLayer[] {
  switch (impact) {
    case 'burst':
      return [layer('burst', 'impact', s, 2)]
    case 'dome':
      return [layer('dome', 'impact', s, 1)]
    case 'pillar':
      return [layer('pillar', 'impact', s, 1)]
    case 'shatter':
      return [layer('shard', 'impact', s, 0, 'crystal'), layer('crack', 'linger', s * 0.8, 2)]
    case 'splash':
      return [layer('ring', 'impact', s, 1), layer('sparks', 'impact', s, 2)]
    case 'pierce':
      return [layer('arc', 'impact', s, 2), layer('burst', 'impact', s * 0.4, 0)]
  }
}

function trailLayers(trail: Trail, family: FormFamily, motif: string): RecipeLayer[] {
  // shots, beams and movement shed their trail on the way (a beam's way is its length); everything else as it lands
  const phase = family === 'projectile' || family === 'beam' || family === 'movement' ? 'travel' : 'impact'
  switch (trail) {
    case 'ribbon':
      return []
    case 'sparks':
      return [layer('sparks', phase, 0.6, 2)]
    case 'smoke':
      return [layer('smoke', phase, 0.8, 2, 'rocket')]
    case 'motif':
      return [layer('motif', phase, 0.6, 0, motif)]
  }
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

/**
 * Build a skill's recipe from its delivery and its look (R33). The hit layer comes first and carries the hit area at
 * its true size; the look adds its form, charge, landing and trail around it, in its own colours, and none of that
 * damages. Without a look a skill takes its family's plain form in its delivery's neutral colours.
 */
export function composeRecipe(kind: Delivery['kind'], look?: SkillLook): EffectRecipe {
  const family = FAMILY_OF[kind]
  const form = formOf(look, kind)
  const element = look ? ELEMENT_LOOKS[look.element] : undefined
  const layers: RecipeLayer[] = []
  const core = hitLayer(kind, form)
  if (core) layers.push(core)
  layers.push(...formLayers(family, form))
  if (look?.charge) layers.push(...CHARGE_LAYERS[look.charge])
  const impact = look ? (look.impact ?? element!.impact) : family === 'projectile' ? 'burst' : undefined
  if (impact && family !== 'self') layers.push(...impactLayers(impact, family === 'projectile' && !look ? 1 : IMPACT_SCALE[family]))
  if (look) layers.push(...trailLayers(look.trail ?? element!.trail, family, look.motif ?? element!.motif))
  const lingers = family === 'zone' || family === 'aura'
  return {
    version: RECIPE_VERSION,
    delivery: kind,
    palette: look?.palette ? [...look.palette] : DEFAULT_PALETTES[kind],
    intensity: look?.intensity ?? 1,
    charge: look?.charge ? CHARGE_SECONDS[look.charge] : kind === 'beam' || kind === 'zone' ? 0.3 : 0.1,
    linger: lingers ? (form === 'rain' || form === 'vortex' || form === 'field' ? 1.6 : 1.2) : 0.4,
    layers,
  }
}

export const defaultRecipe = (kind: Delivery['kind']) => composeRecipe(kind)

/** The passive's look: a cloak around the body, or a glowing element on it. */
export function passiveRecipe(visual: 'aura' | 'body-element', look?: SkillLook): EffectRecipe {
  const base = composeRecipe('self', look)
  const layers: RecipeLayer[] = visual === 'aura' ? [{ primitive: 'aura', phase: 'linger', size: 1, color: 0 }, { primitive: 'sparks', phase: 'linger', size: 0.6, color: 1 }] : [{ primitive: 'burst', phase: 'linger', size: 0.25, color: 0 }, { primitive: 'trail', phase: 'linger', size: 0.3, color: 1 }]
  return { ...base, layers, charge: 0, linger: 0 }
}
