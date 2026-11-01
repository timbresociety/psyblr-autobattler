/**
 * Sculpting a hero's head and face by hand, the way a football game's player creator does: each feature is a slider
 * from -1 to 1 (0 as the face was made, or as the photo fitted it), and each end of a slider is one of the face basis's
 * MakeHuman targets (public/kit/face-basis.json), added on top of whatever the photo gave. A head shape is one more
 * target, from 0 to 1. Cosmetic only, like the rest of the look.
 */

export const SCULPT_REGIONS = ['head', 'forehead', 'brows', 'eyes', 'ears', 'nose', 'cheeks', 'mouth', 'jaw', 'neck'] as const
export type SculptRegion = (typeof SCULPT_REGIONS)[number]

export const REGION_LABEL: Record<SculptRegion, string> = { head: 'Head', forehead: 'Forehead', brows: 'Brows', eyes: 'Eyes', ears: 'Ears', nose: 'Nose', cheeks: 'Cheeks', mouth: 'Mouth', jaw: 'Jaw and chin', neck: 'Neck' }

export interface SculptFeature {
  id: string
  region: SculptRegion
  label: string
  /** What each end of the slider looks like. */
  low: string
  high: string
  /** The face basis's target at 1, and at -1 (a one-way feature has no low end: it runs 0 to 1). */
  up: string
  down?: string
}

const pair = (side: string) => `l-${side}+r-${side}`

/**
 * Every sculpted feature, region by region, in the order the creator lists them: every MakeHuman face target the
 * full face basis carries (public/kit/v2/face-basis.json), paired as a slider with a low and a high end where the
 * targets come in pairs. A feature whose targets a body's basis lacks (the first bodies' 39-group basis) does
 * nothing on that body.
 */
export const SCULPT_FEATURES: readonly SculptFeature[] = [
  { id: 'head_width', region: 'head', label: 'Width', low: 'Narrow', high: 'Wide', up: 'head-scale-horiz-incr', down: 'head-scale-horiz-decr' },
  { id: 'head_length', region: 'head', label: 'Length', low: 'Short', high: 'Long', up: 'head-scale-vert-incr', down: 'head-scale-vert-decr' },
  { id: 'head_depth', region: 'head', label: 'Depth', low: 'Flat', high: 'Deep', up: 'head-scale-depth-incr', down: 'head-scale-depth-decr' },
  { id: 'head_fullness', region: 'head', label: 'Fullness', low: 'Gaunt', high: 'Full', up: 'head-fat-incr', down: 'head-fat-decr' },
  { id: 'head_taper', region: 'head', label: 'Taper', low: 'Jaw out', high: 'Jaw in', up: 'head-angle-in', down: 'head-angle-out' },
  { id: 'head_back', region: 'head', label: 'Back of head', low: 'Flat', high: 'Round', up: 'head-back-scale-depth-incr', down: 'head-back-scale-depth-decr' },
  { id: 'forehead_height', region: 'forehead', label: 'Height', low: 'Low', high: 'High', up: 'forehead-scale-vert-incr', down: 'forehead-scale-vert-decr' },
  { id: 'forehead_slope', region: 'forehead', label: 'Slope', low: 'Sloped back', high: 'Upright', up: 'forehead-trans-forward', down: 'forehead-trans-backward' },
  { id: 'forehead_temples', region: 'forehead', label: 'Temples', low: 'Narrow', high: 'Wide', up: 'forehead-temple-incr', down: 'forehead-temple-decr' },
  { id: 'brow_ridge', region: 'forehead', label: 'Brow ridge', low: 'Smooth', high: 'Heavy', up: 'forehead-nubian-incr', down: 'forehead-nubian-decr' },
  { id: 'brow_height', region: 'brows', label: 'Height', low: 'Low', high: 'High', up: 'eyebrows-trans-up', down: 'eyebrows-trans-down' },
  { id: 'brow_angle', region: 'brows', label: 'Angle', low: 'Arched down', high: 'Arched up', up: 'eyebrows-angle-up', down: 'eyebrows-angle-down' },
  { id: 'brow_depth', region: 'brows', label: 'Prominence', low: 'Set back', high: 'Forward', up: 'eyebrows-trans-forward', down: 'eyebrows-trans-backward' },
  { id: 'eye_spacing', region: 'eyes', label: 'Spacing', low: 'Close', high: 'Wide', up: pair('eye-trans-out'), down: pair('eye-trans-in') },
  { id: 'eye_height', region: 'eyes', label: 'Height', low: 'Low', high: 'High', up: pair('eye-trans-up'), down: pair('eye-trans-down') },
  { id: 'eye_size', region: 'eyes', label: 'Size', low: 'Small', high: 'Large', up: pair('eye-scale-incr'), down: pair('eye-scale-decr') },
  { id: 'eye_opening', region: 'eyes', label: 'Opening', low: 'Narrow', high: 'Open', up: pair('eye-height2-incr'), down: pair('eye-height2-decr') },
  { id: 'eye_upper_lid', region: 'eyes', label: 'Upper lid', low: 'Low', high: 'High', up: pair('eye-height1-incr'), down: pair('eye-height1-decr') },
  { id: 'eye_lower_lid', region: 'eyes', label: 'Lower lid', low: 'Low', high: 'High', up: pair('eye-height3-incr'), down: pair('eye-height3-decr') },
  { id: 'eye_inner', region: 'eyes', label: 'Inner corners', low: 'Down', high: 'Up', up: pair('eye-corner1-up'), down: pair('eye-corner1-down') },
  { id: 'eye_outer', region: 'eyes', label: 'Outer corners', low: 'Down', high: 'Up', up: pair('eye-corner2-up'), down: pair('eye-corner2-down') },
  { id: 'eye_depth', region: 'eyes', label: 'Depth', low: 'Deep set', high: 'Forward', up: pair('eye-push1-out'), down: pair('eye-push1-in') },
  { id: 'eye_socket', region: 'eyes', label: 'Socket', low: 'Sunken', high: 'Raised', up: pair('eye-push2-out'), down: pair('eye-push2-in') },
  { id: 'eye_fold', region: 'eyes', label: 'Eyelid fold', low: 'Hooded', high: 'Open', up: pair('eye-eyefold-up'), down: pair('eye-eyefold-down') },
  { id: 'eye_fold_angle', region: 'eyes', label: 'Fold angle', low: 'Down', high: 'Up', up: pair('eye-eyefold-angle-up'), down: pair('eye-eyefold-angle-down') },
  { id: 'eye_fold_depth', region: 'eyes', label: 'Fold depth', low: 'Flat', high: 'Deep', up: pair('eye-eyefold-concave'), down: pair('eye-eyefold-convex') },
  { id: 'eye_epicanthus', region: 'eyes', label: 'Inner fold', low: 'Open', high: 'Folded', up: pair('eye-epicanthus-in'), down: pair('eye-epicanthus-out') },
  { id: 'eye_bags', region: 'eyes', label: 'Bags', low: 'Smooth', high: 'Heavy', up: pair('eye-bag-incr'), down: pair('eye-bag-decr') },
  { id: 'eye_bag_height', region: 'eyes', label: 'Bag height', low: 'Low', high: 'High', up: pair('eye-bag-height-incr'), down: pair('eye-bag-height-decr') },
  { id: 'eye_bag_spread', region: 'eyes', label: 'Bag spread', low: 'In', high: 'Out', up: pair('eye-bag-out'), down: pair('eye-bag-in') },
  { id: 'ear_size', region: 'ears', label: 'Size', low: 'Small', high: 'Large', up: pair('ear-scale-incr'), down: pair('ear-scale-decr') },
  { id: 'ear_height', region: 'ears', label: 'Height', low: 'Short', high: 'Tall', up: pair('ear-scale-vert-incr'), down: pair('ear-scale-vert-decr') },
  { id: 'ear_depth', region: 'ears', label: 'Depth', low: 'Shallow', high: 'Deep', up: pair('ear-scale-depth-incr'), down: pair('ear-scale-depth-decr') },
  { id: 'ear_position', region: 'ears', label: 'Position', low: 'Low', high: 'High', up: pair('ear-trans-up'), down: pair('ear-trans-down') },
  { id: 'ear_set', region: 'ears', label: 'Set', low: 'Forward', high: 'Back', up: pair('ear-trans-backward'), down: pair('ear-trans-forward') },
  { id: 'ear_rotation', region: 'ears', label: 'Rotation', low: 'Tilted back', high: 'Tilted forward', up: pair('ear-rot-forward'), down: pair('ear-rot-backward') },
  { id: 'ear_flare', region: 'ears', label: 'Flare', low: 'Flat', high: 'Stuck out', up: pair('ear-flap-incr'), down: pair('ear-flap-decr') },
  { id: 'ear_lobe', region: 'ears', label: 'Lobe', low: 'Attached', high: 'Hanging', up: pair('ear-lobe-incr'), down: pair('ear-lobe-decr') },
  { id: 'ear_wing', region: 'ears', label: 'Wing', low: 'Narrow', high: 'Wide', up: pair('ear-wing-incr'), down: pair('ear-wing-decr') },
  { id: 'ear_pointed', region: 'ears', label: 'Pointed', low: 'As made', high: 'Pointed', up: pair('ear-shape-pointed') },
  { id: 'ear_round', region: 'ears', label: 'Round', low: 'As made', high: 'Round', up: pair('ear-shape-round') },
  { id: 'ear_square', region: 'ears', label: 'Square', low: 'As made', high: 'Square', up: pair('ear-shape-square') },
  { id: 'nose_width', region: 'nose', label: 'Width', low: 'Narrow', high: 'Wide', up: 'nose-scale-horiz-incr', down: 'nose-scale-horiz-decr' },
  { id: 'nose_length', region: 'nose', label: 'Length', low: 'Short', high: 'Long', up: 'nose-scale-vert-incr', down: 'nose-scale-vert-decr' },
  { id: 'nose_height', region: 'nose', label: 'Height', low: 'Low', high: 'High', up: 'nose-trans-up', down: 'nose-trans-down' },
  { id: 'nose_projection', region: 'nose', label: 'Projection', low: 'Flat', high: 'Prominent', up: 'nose-trans-forward', down: 'nose-trans-backward' },
  { id: 'nose_depth', region: 'nose', label: 'Depth', low: 'Shallow', high: 'Deep', up: 'nose-scale-depth-incr', down: 'nose-scale-depth-decr' },
  { id: 'nose_bridge', region: 'nose', label: 'Bridge', low: 'Straight', high: 'Humped', up: 'nose-hump-incr', down: 'nose-hump-decr' },
  { id: 'nose_curve', region: 'nose', label: 'Profile', low: 'Concave', high: 'Convex', up: 'nose-curve-convex', down: 'nose-curve-concave' },
  { id: 'nose_greek', region: 'nose', label: 'Greek bridge', low: 'Dipped', high: 'Straight', up: 'nose-greek-incr', down: 'nose-greek-decr' },
  { id: 'nose_tip', region: 'nose', label: 'Tip', low: 'Down', high: 'Up', up: 'nose-point-up', down: 'nose-point-down' },
  { id: 'nose_tip_width', region: 'nose', label: 'Tip width', low: 'Narrow', high: 'Bulbous', up: 'nose-point-width-incr', down: 'nose-point-width-decr' },
  { id: 'nose_flare', region: 'nose', label: 'Nostrils', low: 'Pinched', high: 'Flared', up: 'nose-flaring-incr', down: 'nose-flaring-decr' },
  { id: 'nose_nostril_width', region: 'nose', label: 'Nostril width', low: 'Narrow', high: 'Wide', up: 'nose-nostrils-width-incr', down: 'nose-nostrils-width-decr' },
  { id: 'nose_nostril_angle', region: 'nose', label: 'Nostril angle', low: 'Down', high: 'Up', up: 'nose-nostrils-angle-up', down: 'nose-nostrils-angle-down' },
  { id: 'nose_septum', region: 'nose', label: 'Septum', low: 'Down', high: 'Up', up: 'nose-septumangle-incr', down: 'nose-septumangle-decr' },
  { id: 'nose_base', region: 'nose', label: 'Base', low: 'Low', high: 'High', up: 'nose-base-up', down: 'nose-base-down' },
  { id: 'nose_compression', region: 'nose', label: 'Compression', low: 'Stretched', high: 'Compressed', up: 'nose-compression-compress', down: 'nose-compression-uncompress' },
  { id: 'nose_volume', region: 'nose', label: 'Volume', low: 'Slight', high: 'Fleshy', up: 'nose-volume-incr', down: 'nose-volume-decr' },
  { id: 'nose_top_width', region: 'nose', label: 'Top width', low: 'Narrow', high: 'Wide', up: 'nose-width1-incr', down: 'nose-width1-decr' },
  { id: 'nose_mid_width', region: 'nose', label: 'Middle width', low: 'Narrow', high: 'Wide', up: 'nose-width2-incr', down: 'nose-width2-decr' },
  { id: 'nose_base_width', region: 'nose', label: 'Base width', low: 'Narrow', high: 'Wide', up: 'nose-width3-incr', down: 'nose-width3-decr' },
  { id: 'cheekbones', region: 'cheeks', label: 'Cheekbones', low: 'Soft', high: 'Sharp', up: pair('cheek-bones-incr'), down: pair('cheek-bones-decr') },
  { id: 'cheek_volume', region: 'cheeks', label: 'Volume', low: 'Hollow', high: 'Full', up: pair('cheek-volume-incr'), down: pair('cheek-volume-decr') },
  { id: 'cheek_inner', region: 'cheeks', label: 'Inner cheek', low: 'Hollow', high: 'Full', up: pair('cheek-inner-incr'), down: pair('cheek-inner-decr') },
  { id: 'cheek_height', region: 'cheeks', label: 'Height', low: 'Low', high: 'High', up: pair('cheek-trans-up'), down: pair('cheek-trans-down') },
  { id: 'mouth_width', region: 'mouth', label: 'Width', low: 'Narrow', high: 'Wide', up: 'mouth-scale-horiz-incr', down: 'mouth-scale-horiz-decr' },
  { id: 'mouth_fullness', region: 'mouth', label: 'Fullness', low: 'Thin', high: 'Full', up: 'mouth-scale-vert-incr', down: 'mouth-scale-vert-decr' },
  { id: 'mouth_height', region: 'mouth', label: 'Height', low: 'Low', high: 'High', up: 'mouth-trans-up', down: 'mouth-trans-down' },
  { id: 'mouth_projection', region: 'mouth', label: 'Projection', low: 'Set back', high: 'Forward', up: 'mouth-trans-forward', down: 'mouth-trans-backward' },
  { id: 'mouth_depth', region: 'mouth', label: 'Depth', low: 'Shallow', high: 'Deep', up: 'mouth-scale-depth-incr', down: 'mouth-scale-depth-decr' },
  { id: 'mouth_corners', region: 'mouth', label: 'Corners', low: 'Down', high: 'Up', up: 'mouth-angles-up', down: 'mouth-angles-down' },
  { id: 'lip_upper', region: 'mouth', label: 'Upper lip', low: 'Thin', high: 'Thick', up: 'mouth-upperlip-height-incr', down: 'mouth-upperlip-height-decr' },
  { id: 'lip_lower', region: 'mouth', label: 'Lower lip', low: 'Thin', high: 'Thick', up: 'mouth-lowerlip-height-incr', down: 'mouth-lowerlip-height-decr' },
  { id: 'lip_upper_volume', region: 'mouth', label: 'Upper lip volume', low: 'Flat', high: 'Full', up: 'mouth-upperlip-volume-incr', down: 'mouth-upperlip-volume-decr' },
  { id: 'lip_lower_volume', region: 'mouth', label: 'Lower lip volume', low: 'Flat', high: 'Full', up: 'mouth-lowerlip-volume-incr', down: 'mouth-lowerlip-volume-decr' },
  { id: 'lip_upper_width', region: 'mouth', label: 'Upper lip width', low: 'Narrow', high: 'Wide', up: 'mouth-upperlip-width-incr', down: 'mouth-upperlip-width-decr' },
  { id: 'lip_lower_width', region: 'mouth', label: 'Lower lip width', low: 'Narrow', high: 'Wide', up: 'mouth-lowerlip-width-incr', down: 'mouth-lowerlip-width-decr' },
  { id: 'lip_upper_middle', region: 'mouth', label: 'Upper lip middle', low: 'Down', high: 'Up', up: 'mouth-upperlip-middle-up', down: 'mouth-upperlip-middle-down' },
  { id: 'lip_lower_middle', region: 'mouth', label: 'Lower lip middle', low: 'Down', high: 'Up', up: 'mouth-lowerlip-middle-up', down: 'mouth-lowerlip-middle-down' },
  { id: 'lip_upper_edge', region: 'mouth', label: 'Upper lip edge', low: 'Down', high: 'Up', up: 'mouth-upperlip-ext-up', down: 'mouth-upperlip-ext-down' },
  { id: 'lip_lower_edge', region: 'mouth', label: 'Lower lip edge', low: 'Down', high: 'Up', up: 'mouth-lowerlip-ext-up', down: 'mouth-lowerlip-ext-down' },
  { id: 'cupids_bow', region: 'mouth', label: "Cupid's bow", low: 'Soft', high: 'Sharp', up: 'mouth-cupidsbow-incr', down: 'mouth-cupidsbow-decr' },
  { id: 'cupids_bow_width', region: 'mouth', label: "Cupid's bow width", low: 'Narrow', high: 'Wide', up: 'mouth-cupidsbow-width-incr', down: 'mouth-cupidsbow-width-decr' },
  { id: 'philtrum', region: 'mouth', label: 'Philtrum', low: 'Flat', high: 'Deep', up: 'mouth-philtrum-volume-incr', down: 'mouth-philtrum-volume-decr' },
  { id: 'dimples', region: 'mouth', label: 'Dimples', low: 'None', high: 'Deep', up: 'mouth-dimples-in', down: 'mouth-dimples-out' },
  { id: 'laugh_lines', region: 'mouth', label: 'Laugh lines', low: 'Smooth', high: 'Deep', up: 'mouth-laugh-lines-in', down: 'mouth-laugh-lines-out' },
  { id: 'chin_width', region: 'jaw', label: 'Chin width', low: 'Narrow', high: 'Wide', up: 'chin-width-incr', down: 'chin-width-decr' },
  { id: 'chin_height', region: 'jaw', label: 'Chin height', low: 'Short', high: 'Tall', up: 'chin-height-incr', down: 'chin-height-decr' },
  { id: 'chin_prominence', region: 'jaw', label: 'Chin prominence', low: 'Receding', high: 'Strong', up: 'chin-bones-incr', down: 'chin-bones-decr' },
  { id: 'chin_forward', region: 'jaw', label: 'Chin forward', low: 'Set back', high: 'Jutting', up: 'chin-prominent-incr', down: 'chin-prominent-decr' },
  { id: 'chin_cleft', region: 'jaw', label: 'Cleft', low: 'Smooth', high: 'Cleft', up: 'chin-cleft-incr', down: 'chin-cleft-decr' },
  { id: 'jaw_drop', region: 'jaw', label: 'Jaw drop', low: 'Shallow', high: 'Deep', up: 'chin-jaw-drop-incr', down: 'chin-jaw-drop-decr' },
  { id: 'jaw_prognathism', region: 'jaw', label: 'Jaw thrust', low: 'Under', high: 'Over', up: 'chin-prognathism-incr', down: 'chin-prognathism-decr' },
  { id: 'chin_pointed', region: 'jaw', label: 'Pointed chin', low: 'As made', high: 'Pointed', up: 'chin-triangle' },
  { id: 'neck_width', region: 'neck', label: 'Width', low: 'Thin', high: 'Thick', up: 'neck-scale-horiz-incr', down: 'neck-scale-horiz-decr' },
  { id: 'neck_length', region: 'neck', label: 'Length', low: 'Short', high: 'Long', up: 'neck-scale-vert-incr', down: 'neck-scale-vert-decr' },
  { id: 'neck_depth', region: 'neck', label: 'Depth', low: 'Shallow', high: 'Deep', up: 'neck-scale-depth-incr', down: 'neck-scale-depth-decr' },
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
    const oneWay = SHAPE.has(id) || !FEATURE.get(id)?.down
    const held = Math.round(Math.min(1, Math.max(oneWay ? 0 : -1, v)) * 100) / 100
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
    if (feature && v < 0 && !feature.down) continue
    const i = group === undefined ? undefined : at.get(group)
    if (i === undefined) continue
    out[i] += Math.abs(v)
    any = true
  }
  return any ? out : undefined
}
