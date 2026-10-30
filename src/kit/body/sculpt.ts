/**
 * Sculpting a hero's head and face by hand, the way a football game's player creator does: each feature is a slider
 * from -1 to 1 (0 as the face was made, or as the photo fitted it), and each end of a slider is one of the face basis's
 * MakeHuman targets (public/kit/face-basis.json), added on top of whatever the photo gave. A head shape is one more
 * target, from 0 to 1. Cosmetic only, like the rest of the look.
 */

export const SCULPT_REGIONS = ['head', 'eyes', 'nose', 'mouth', 'cheeks', 'jaw'] as const
export type SculptRegion = (typeof SCULPT_REGIONS)[number]

export const REGION_LABEL: Record<SculptRegion, string> = { head: 'Head', eyes: 'Eyes', nose: 'Nose', mouth: 'Mouth', cheeks: 'Cheeks', jaw: 'Jaw and chin' }

export interface SculptFeature {
  id: string
  region: SculptRegion
  label: string
  /** What each end of the slider looks like. */
  low: string
  high: string
  /** The face basis's target at 1, and at -1 (a head shape has no low end: it runs 0 to 1). */
  up: string
  down?: string
}

const pair = (side: string) => `l-${side}+r-${side}`

/** Every sculpted feature, region by region, in the order the creator lists them. */
export const SCULPT_FEATURES: readonly SculptFeature[] = [
  { id: 'head_width', region: 'head', label: 'Width', low: 'Narrow', high: 'Wide', up: 'head-scale-horiz-incr', down: 'head-scale-horiz-decr' },
  { id: 'head_length', region: 'head', label: 'Length', low: 'Short', high: 'Long', up: 'head-scale-vert-incr', down: 'head-scale-vert-decr' },
  { id: 'head_fullness', region: 'head', label: 'Fullness', low: 'Gaunt', high: 'Full', up: 'head-fat-incr', down: 'head-fat-decr' },
  { id: 'forehead', region: 'head', label: 'Forehead', low: 'Low', high: 'High', up: 'forehead-scale-vert-incr', down: 'forehead-scale-vert-decr' },
  { id: 'eye_spacing', region: 'eyes', label: 'Spacing', low: 'Close', high: 'Wide', up: pair('eye-trans-out'), down: pair('eye-trans-in') },
  { id: 'eye_height', region: 'eyes', label: 'Height', low: 'Low', high: 'High', up: pair('eye-trans-up'), down: pair('eye-trans-down') },
  { id: 'eye_size', region: 'eyes', label: 'Size', low: 'Small', high: 'Large', up: pair('eye-scale-incr'), down: pair('eye-scale-decr') },
  { id: 'eye_opening', region: 'eyes', label: 'Opening', low: 'Narrow', high: 'Open', up: pair('eye-height2-incr'), down: pair('eye-height2-decr') },
  { id: 'eye_inner', region: 'eyes', label: 'Inner corners', low: 'Down', high: 'Up', up: pair('eye-corner1-up'), down: pair('eye-corner1-down') },
  { id: 'eye_outer', region: 'eyes', label: 'Outer corners', low: 'Down', high: 'Up', up: pair('eye-corner2-up'), down: pair('eye-corner2-down') },
  { id: 'nose_width', region: 'nose', label: 'Width', low: 'Narrow', high: 'Wide', up: 'nose-scale-horiz-incr', down: 'nose-scale-horiz-decr' },
  { id: 'nose_length', region: 'nose', label: 'Length', low: 'Short', high: 'Long', up: 'nose-scale-vert-incr', down: 'nose-scale-vert-decr' },
  { id: 'nose_height', region: 'nose', label: 'Height', low: 'Low', high: 'High', up: 'nose-trans-up', down: 'nose-trans-down' },
  { id: 'nose_flare', region: 'nose', label: 'Nostrils', low: 'Pinched', high: 'Flared', up: 'nose-flaring-incr', down: 'nose-flaring-decr' },
  { id: 'mouth_width', region: 'mouth', label: 'Width', low: 'Narrow', high: 'Wide', up: 'mouth-scale-horiz-incr', down: 'mouth-scale-horiz-decr' },
  { id: 'mouth_fullness', region: 'mouth', label: 'Fullness', low: 'Thin', high: 'Full', up: 'mouth-scale-vert-incr', down: 'mouth-scale-vert-decr' },
  { id: 'mouth_height', region: 'mouth', label: 'Height', low: 'Low', high: 'High', up: 'mouth-trans-up', down: 'mouth-trans-down' },
  { id: 'lip_upper', region: 'mouth', label: 'Upper lip', low: 'Thin', high: 'Thick', up: 'mouth-upperlip-height-incr', down: 'mouth-upperlip-height-decr' },
  { id: 'lip_lower', region: 'mouth', label: 'Lower lip', low: 'Thin', high: 'Thick', up: 'mouth-lowerlip-height-incr', down: 'mouth-lowerlip-height-decr' },
  { id: 'cheekbones', region: 'cheeks', label: 'Cheekbones', low: 'Soft', high: 'Sharp', up: pair('cheek-bones-incr'), down: pair('cheek-bones-decr') },
  { id: 'cheek_volume', region: 'cheeks', label: 'Volume', low: 'Hollow', high: 'Full', up: pair('cheek-volume-incr'), down: pair('cheek-volume-decr') },
  { id: 'chin_width', region: 'jaw', label: 'Chin width', low: 'Narrow', high: 'Wide', up: 'chin-width-incr', down: 'chin-width-decr' },
  { id: 'chin_height', region: 'jaw', label: 'Chin height', low: 'Short', high: 'Tall', up: 'chin-height-incr', down: 'chin-height-decr' },
  { id: 'chin_prominence', region: 'jaw', label: 'Chin prominence', low: 'Receding', high: 'Strong', up: 'chin-bones-incr', down: 'chin-bones-decr' },
]

/** Head shapes, each a target the head leans toward from 0 to 1. */
export const HEAD_SHAPES = ['oval', 'round', 'square', 'rectangular', 'triangular', 'invertedtriangular', 'diamond'] as const
export type HeadShape = (typeof HEAD_SHAPES)[number]
export const HEAD_SHAPE_LABEL: Record<HeadShape, string> = { oval: 'Oval', round: 'Round', square: 'Square', rectangular: 'Long', triangular: 'Pear', invertedtriangular: 'Heart', diamond: 'Diamond' }
export const shapeId = (shape: HeadShape) => `shape_${shape}`

/** Every slider a sculpt can set: the features, then the head shapes. */
export const SCULPT_IDS: readonly string[] = [...SCULPT_FEATURES.map((f) => f.id), ...HEAD_SHAPES.map(shapeId)]

/** A sculpt: feature id to -1..1 (a head shape 0..1). Absent features are as made. */
export type Sculpt = Partial<Record<string, number>>

const FEATURE = new Map(SCULPT_FEATURES.map((f) => [f.id, f]))
const SHAPE = new Map(HEAD_SHAPES.map((s) => [shapeId(s), s]))

/** A sculpt from untrusted input: known ids only, each held to its range and rounded; undefined when nothing is left. */
export function hydrateSculpt(raw: unknown): Sculpt | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Sculpt = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || (!FEATURE.has(id) && !SHAPE.has(id))) continue
    const held = Math.round(Math.min(1, Math.max(SHAPE.has(id) ? 0 : -1, v)) * 100) / 100
    if (held) out[id] = held
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * The weight a sculpt puts on each of the face basis's groups (`groups`, in file order): a feature's value on its high
 * target, or its size on its low one; undefined when the sculpt moves nothing the basis has.
 */
export function sculptWeights(sculpt: Sculpt | undefined, groups: readonly string[]): number[] | undefined {
  if (!sculpt) return undefined
  const at = new Map(groups.map((g, i) => [g, i]))
  const out = new Array<number>(groups.length).fill(0)
  let any = false
  for (const [id, v] of Object.entries(sculpt)) {
    if (!v) continue
    const feature = FEATURE.get(id)
    const shape = SHAPE.get(id)
    const group = feature ? (v > 0 ? feature.up : feature.down) : shape ? `head-${shape}` : undefined
    const i = group === undefined ? undefined : at.get(group)
    if (i === undefined) continue
    out[i] += Math.abs(v)
    any = true
  }
  return any ? out : undefined
}
