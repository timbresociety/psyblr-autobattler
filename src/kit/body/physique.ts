import { HELPER_BONES, MUSCLE_REGIONS, type MuscleRegion, type Side } from '../rig/metarig.js'
import type { Gender } from '../../charter/look.js'
import { bodyLandmarks, girth, regionMask, placeAt, type Skeleton, type Skin, type Vec3 } from './regions.js'

/**
 * Physique: Structure × Volume (GAME.md §9.3). Every dial runs 0 to 1 with 0.5 the body as made, unless it says
 * otherwise, and every one is optional, so a look saved before the rework (weight, muscle, age and the six
 * proportions) reads the same. Structure moves bones (proportions.ts, at rest) and the rest pose (posture); Volume
 * moves skin (sculptVolume, here) and scales the metarig's helpers (helperGain).
 */

/** Overall posture, put on the rest pose so every clip plays over it. */
export const POSTURES = ['upright', 'heroic', 'hunched', 'stoop'] as const
export type Posture = (typeof POSTURES)[number]

/** The jiggle presets (§9.4). */
export const JIGGLE_PRESETS = ['off', 'realistic', 'anime'] as const
export type JigglePreset = (typeof JIGGLE_PRESETS)[number]

/** The regional muscle dials: the metarig's muscle regions plus abs and obliques, which only the surface shows. */
export type RegionalDial = MuscleRegion | 'abs'
export const REGIONAL_DIALS: readonly RegionalDial[] = [...MUSCLE_REGIONS, 'abs']

export interface StructureDials {
  /** Metres, about 1.0 to 2.6 (HEIGHT_RANGE); absent, the size class sets it. Titan scale only by transformation. */
  height?: number
  /** Head size against the body: 0 heroic (9 heads tall), 0.5 as made, 1 chibi-leaning (4.5 heads). */
  head?: number
  legs?: number
  arms?: number
  torso?: number
  /** Shoulder width. */
  shoulders?: number
  chestDepth?: number
  ribcage?: number
  hipWidth?: number
  /** 0 tucked under, 1 tipped forward (an arched lower back). */
  pelvisTilt?: number
  /** Neck length. */
  neck?: number
  neckThickness?: number
  hands?: number
  feet?: number
  posture?: Posture
}

export interface VolumeDials {
  /** Body fat: lean through heavyweight. */
  weight: number
  /** Overall muscle: soft through DBZ. */
  muscle: number
  age: number
  /** Each region's muscle against the overall: 0.5 follows it. */
  regional?: Partial<Record<RegionalDial, number>>
  /** How cut the muscle reads: a normal-map blend for abs and striations, no triangles. */
  definition?: number
  /** Adult bodies only (the child preset locks these). */
  bustSize?: number
  /** 0 round, 1 full low (teardrop). */
  bustShape?: number
  bustSpacing?: number
  bustLift?: number
  waist?: number
  /** The flesh over the hips (the pelvis's own width is Structure's hipWidth). */
  hipCurve?: number
  glutes?: number
  thighs?: number
  belly?: number
}

export interface PhysiqueDials extends StructureDials, VolumeDials {
  jiggle?: JigglePreset
  /** The archetype it started from (presets below), for the Forge to show. */
  preset?: ArchetypeId
  /** A child-proportioned body: the adult-figure dials stay neutral whatever they are set to. */
  child?: boolean
}

/** The dials that are a single number, for sliders. */
export type NumericDial = { [K in keyof PhysiqueDials]-?: NonNullable<PhysiqueDials[K]> extends number ? K : never }[keyof PhysiqueDials]

export const HEIGHT_RANGE = [1.0, 2.6] as const
/** The height every body file is built at. */
export const FILE_HEIGHT = 1.8

const clamp01 = (v: number | undefined, fallback = 0.5) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback)
/** -1 to 1 around the dial's middle. */
const centred = (v: number | undefined) => (clamp01(v) - 0.5) * 2

/** The dials a child-proportioned body keeps at neutral. */
export const ADULT_FIGURE: readonly (keyof VolumeDials)[] = ['bustSize', 'bustShape', 'bustSpacing', 'bustLift', 'hipCurve', 'glutes']

/** A dial as it takes effect: the child preset holds the adult figure at neutral. */
export function dial(p: Partial<PhysiqueDials>, key: keyof VolumeDials | keyof StructureDials): number {
  if (p.child && (ADULT_FIGURE as readonly string[]).includes(key)) return 0.5
  return clamp01(p[key] as number | undefined, key === 'age' ? 0 : 0.5)
}

/** A region's muscle, 0 to 1: the overall dial moved by the region's own. */
export function regionMuscle(p: Partial<PhysiqueDials>, region: RegionalDial): number {
  return Math.min(1, Math.max(0, clamp01(p.muscle) + centred(p.regional?.[region]) * 0.5))
}

/**
 * How strongly a region's muscle helpers bulge as their joints turn: 0 on a lean or soft body (no effect, no second
 * skin), rising to 1 at DBZ volume.
 */
export function helperGain(p: Partial<PhysiqueDials>, region: MuscleRegion): number {
  return Math.min(1, Math.max(0, (regionMuscle(p, region) - 0.45) / 0.55))
}

/** The head's scale against the body file's: heroic 0.83 (9 heads) through 1.67 (4.5 heads). */
export function headScale(p: Partial<PhysiqueDials>): number {
  const h = clamp01(p.head)
  return h >= 0.5 ? 1 + (h - 0.5) * 2 * 0.67 : 1 - (0.5 - h) * 2 * 0.17
}

/** The hero's drawn scale against the body file, from its height in metres. */
export function heightScale(p: Partial<PhysiqueDials>, fallback = 1): number {
  if (typeof p.height !== 'number' || !Number.isFinite(p.height)) return fallback
  return Math.min(HEIGHT_RANGE[1], Math.max(HEIGHT_RANGE[0], p.height)) / FILE_HEIGHT
}

// ------------------------------------------------------------------------------------------------ posture

/**
 * Posture and pelvis tilt as turns on the rest pose, in degrees about each bone's local X (forward bend is negative
 * on the Mixamo spine, a chin dropped toward the chest positive on the neck). Every clip plays on top of them.
 */
export function postureTurns(p: Partial<PhysiqueDials>): Record<string, number> {
  const out: Record<string, number> = {}
  const add = (bone: string, deg: number) => (out[bone] = (out[bone] ?? 0) + deg)
  switch (p.posture) {
    case 'heroic':
      // chest out and up, shoulders back, chin level
      add('Spine1', -4)
      add('Spine2', -6)
      add('Neck', 5)
      add('LeftShoulder', -4)
      add('RightShoulder', -4)
      break
    case 'hunched':
      // a brute's forward hunch: rounded upper back, head thrust forward
      add('Spine1', 6)
      add('Spine2', 10)
      add('Neck', -8)
      add('Head', -6)
      break
    case 'stoop':
      // an elder's stoop: the whole back rounds, the neck reaches forward
      add('Spine', 6)
      add('Spine1', 8)
      add('Spine2', 10)
      add('Neck', 4)
      add('Head', -10)
      break
  }
  // pelvis tilt: the hips tip and the lower back takes most of it back, so the chest stays where it was
  const tilt = centred(p.pelvisTilt) * 12
  if (tilt) {
    add('Hips', tilt)
    add('Spine', -tilt * 0.8)
  }
  return out
}

// ------------------------------------------------------------------------------------------------ volume

/** How far each Volume dial moves the skin at its ends, in local girths. */
const REACH = { region: 0.22, waist: 0.18, hipCurve: 0.2, glutes: 0.35, thighs: 0.2, belly: 0.9, bust: 0.9, chestDepth: 0.14, ribcage: 0.12, neckThickness: 0.3 }

/**
 * The skin moved by the Volume dials (and the Structure dials that are flesh, not bone: chest depth, rib-cage width,
 * neck thickness): each region swells or slims along its normals, the bust grows, lifts, spreads and fills low, the
 * chest deepens and the ribs widen about the spine. Moves `positions` (welded) in place; `normals` are the body's
 * before. Deterministic, so the game, the bench and tests make the same body.
 */
export function sculptVolume(skin: Skin & { normals: ArrayLike<number>; triangles?: ArrayLike<number> }, skeleton: Skeleton, p: Partial<PhysiqueDials>, gender: Gender, positions: Float32Array): void {
  const n = positions.length / 3
  // the skin swells along its normals smoothed over a few rings of neighbours: a pit (the navel, the armpit) has
  // normals that point every way, and pushing along them tore it open
  const normals = skin.triangles ? smoothNormals(skin.normals, skin.triangles, n, 6) : skin.normals
  const push = (mask: Float32Array, metres: number) => {
    if (!metres) return
    for (let i = 0; i < n; i++) {
      const k = mask[i] * metres
      if (!k) continue
      positions[i * 3] += normals[i * 3] * k
      positions[i * 3 + 1] += normals[i * 3 + 1] * k
      positions[i * 3 + 2] += normals[i * 3 + 2] * k
    }
  }
  // a mound grows as a whole about a point inside the body, keeping its detail (a navel, a nipple) whole
  const inflate = (mask: Float32Array, centre: Vec3, by: number) => {
    if (!by) return
    for (let i = 0; i < n; i++) {
      const k = mask[i] * by
      if (!k) continue
      for (let c = 0; c < 3; c++) positions[i * 3 + c] += (positions[i * 3 + c] - centre[c]) * k
    }
  }
  const sides: Side[] = ['Left', 'Right']
  // each muscle region swells or slims with its own dial against the overall (the morphs carry the overall)
  for (const b of HELPER_BONES) {
    if (b.kind !== 'muscle' || !b.place || !b.region) continue
    const d = centred(p.regional?.[b.dial as RegionalDial])
    if (!d) continue
    const g = girth(skin, skeleton, b.place.from, b.place.to, b.place.along, b.region.bones)
    const centre = placeAt(skeleton, b.place.from, b.place.to, b.place.along, b.place.out, g, b.side)
    push(regionMask(skin, skeleton, b.region, centre, g * b.region.radius * 1.4, b.side), d * g * REACH.region)
  }
  const lm = bodyLandmarks(skin, skeleton)
  const y = (bone: string) => skeleton.rest[bone][1]
  const torso = girth(skin, skeleton, 'Spine1', 'Spine2', 0.5, ['Spine1', 'Spine2'])
  // waist: the band between the ribs and the hips, all the way round
  const waist = centred(dial(p, 'waist'))
  if (waist) {
    const c: Vec3 = [0, (y('Spine') + y('Spine1')) / 2, skeleton.rest.Spine[2]]
    push(regionMask(skin, skeleton, { bones: ['Spine', 'Spine1', 'Hips'], radius: 1 }, c, (y('Spine1') - y('Hips')) * 0.9, undefined), waist * torso * REACH.waist)
  }
  // belly: out at the front
  const belly = centred(dial(p, 'belly'))
  if (belly && lm.belly) inflate(regionMask(skin, skeleton, { bones: ['Spine', 'Hips', 'Spine1'], radius: 1, facing: [1, 0, 0] }, lm.belly.at, lm.belly.radius * 1.6, undefined), [lm.belly.at[0], lm.belly.at[1], lm.belly.at[2] - lm.belly.radius * 0.6], belly * REACH.belly * 0.5)
  for (const side of sides) {
    const out = side === 'Left' ? 1 : -1
    const thigh = girth(skin, skeleton, `${side}UpLeg`, `${side}Leg`, 0.3, [`${side}UpLeg`, `${side}UpLegTwist`])
    // hip curve: the outside of the hips and the top of the thigh
    const hip = centred(dial(p, 'hipCurve'))
    if (hip) {
      const c = placeAt(skeleton, `${side}UpLeg`, `${side}Leg`, 0.1, [0, 0.6, 0], thigh, side)
      push(regionMask(skin, skeleton, { bones: ['Hips', `${side}UpLeg`, `${side}UpLegTwist`], radius: 1, facing: [0, 1, 0] }, c, thigh * 2.2, side), hip * thigh * REACH.hipCurve)
    }
    const thighs = centred(dial(p, 'thighs'))
    if (thighs) {
      const c = placeAt(skeleton, `${side}UpLeg`, `${side}Leg`, 0.4, [0, 0, 0], 0, side)
      push(regionMask(skin, skeleton, { bones: [`${side}UpLeg`, `${side}UpLegTwist`], radius: 1 }, c, thigh * 3, side), thighs * thigh * REACH.thighs)
    }
    const glute = centred(dial(p, 'glutes'))
    const g = lm.glute[side]
    if (glute && g) inflate(regionMask(skin, skeleton, { bones: ['Hips', `${side}UpLeg`], radius: 1, facing: [-1, 0, 0] }, g.at, g.radius * 1.3, side), [g.at[0], g.at[1], g.at[2] + g.radius * 0.6], glute * REACH.glutes)
    // the bust: adult bodies only; on a male body the same dials shape the chest pad, much less
    const b = lm.breast[side]
    if (b && !p.child) {
      const female = gender === 'f' ? 1 : 0.25
      const size = centred(dial(p, 'bustSize')) * female
      const lift = centred(dial(p, 'bustLift')) * female
      const spacing = centred(dial(p, 'bustSpacing')) * female
      const shape = centred(dial(p, 'bustShape')) * female
      if (size || lift || spacing || shape) {
        const r = b.radius
        const mask = regionMask(skin, skeleton, { bones: ['Spine2', 'Spine1'], radius: 1, facing: [1, 0, 0] }, b.at, r * 1.5, side)
        // the mound inflates about a point on the chest wall behind it, so it grows as a whole and keeps its detail
        const wall: Vec3 = [b.at[0], b.at[1], b.at[2] - r * 0.6]
        for (let i = 0; i < n; i++) {
          const m = mask[i]
          if (!m) continue
          // below the centre counts for more as the shape fills low
          const below = Math.min(1, Math.max(0, (b.at[1] - positions[i * 3 + 1]) / r))
          const grow = m * (size * REACH.bust * 0.5 + shape * below * 0.25)
          positions[i * 3] += (positions[i * 3] - wall[0]) * grow + spacing * out * m * r * 0.18
          positions[i * 3 + 1] += (positions[i * 3 + 1] - wall[1]) * grow + lift * m * r * 0.22
          positions[i * 3 + 2] += (positions[i * 3 + 2] - wall[2]) * grow
        }
      }
    }
  }
  // chest depth and rib-cage width: the ribs about the spine, front to back and side to side
  const depth = centred(dial(p, 'chestDepth'))
  const ribs = centred(dial(p, 'ribcage'))
  if (depth || ribs) {
    const c: Vec3 = [0, (y('Spine1') + y('Spine2')) / 2, (skeleton.rest.Spine1[2] + skeleton.rest.Spine2[2]) / 2]
    const mask = regionMask(skin, skeleton, { bones: ['Spine1', 'Spine2', 'LeftShoulder', 'RightShoulder'], radius: 1 }, c, (y('Neck') - y('Spine')) * 0.85, undefined)
    for (let i = 0; i < n; i++) {
      const m = mask[i]
      if (!m) continue
      positions[i * 3 + 2] += (positions[i * 3 + 2] - c[2]) * depth * REACH.chestDepth * m * 2
      positions[i * 3] += positions[i * 3] * ribs * REACH.ribcage * m * 2
    }
  }
  // neck thickness: about the neck's own line
  const thick = centred(dial(p, 'neckThickness'))
  if (thick) {
    const a = skeleton.rest.Neck
    const b = skeleton.rest.Head
    const mask = regionMask(skin, skeleton, { bones: ['Neck', 'Spine2', 'Head'], radius: 1 }, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], Math.max(0.08, (b[1] - a[1]) * 2.2), undefined)
    for (let i = 0; i < n; i++) {
      const m = mask[i]
      if (!m) continue
      // only the neck itself, not the face above the jaw
      if (positions[i * 3 + 1] > b[1] + 0.02) continue
      positions[i * 3] += (positions[i * 3] - a[0]) * thick * REACH.neckThickness * m
      positions[i * 3 + 2] += (positions[i * 3 + 2] - (a[2] + b[2]) / 2) * thick * REACH.neckThickness * m
    }
  }
}

/** Normals averaged with their neighbours' `rounds` times over the surface's edges, renormalised. */
export function smoothNormals(normals: ArrayLike<number>, triangles: ArrayLike<number>, count: number, rounds: number): Float32Array {
  let cur = Float32Array.from(normals)
  let next = new Float32Array(cur.length)
  for (let r = 0; r < rounds; r++) {
    next.set(cur)
    for (let t = 0; t < triangles.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const a = triangles[t + e] * 3
        const b = triangles[t + ((e + 1) % 3)] * 3
        for (let k = 0; k < 3; k++) {
          next[a + k] += cur[b + k]
          next[b + k] += cur[a + k]
        }
      }
    for (let i = 0; i < count; i++) {
      const l = Math.hypot(next[i * 3], next[i * 3 + 1], next[i * 3 + 2]) || 1
      next[i * 3] /= l
      next[i * 3 + 1] /= l
      next[i * 3 + 2] /= l
    }
    ;[cur, next] = [next, cur]
  }
  return cur
}

// ------------------------------------------------------------------------------------------------ presets

export const ARCHETYPES = ['small', 'lanky', 'slender', 'athletic', 'heroine', 'athleticHeroine', 'powerhouse', 'bodybuilder', 'heavyweight', 'stocky', 'giant', 'elder'] as const
export type ArchetypeId = (typeof ARCHETYPES)[number]
export type BodySize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'colossal'

export interface Archetype {
  id: ArchetypeId
  label: string
  /** The fantasy coverage it stands for (§9.3): roleplaying, anime, superhero. */
  examples: readonly [roleplaying: string, anime: string, superhero: string]
  gender: Gender
  /** The body file it starts from. */
  body: BodySize
  dials: PhysiqueDials
}

const P = (d: Partial<PhysiqueDials>): PhysiqueDials => ({ weight: 0.5, muscle: 0.5, age: 0, ...d })

/** The twelve presets that ship first (§9.3 fantasy coverage); every dial stays free on top of them. */
export const PRESETS: readonly Archetype[] = [
  { id: 'small', label: 'Small', examples: ['Halfling', 'Detective Conan', 'Kid sidekick'], gender: 'm', body: 'tiny', dials: P({ child: true, height: 1.15, head: 0.95, legs: 0.3, arms: 0.4, torso: 0.4, shoulders: 0.3, neck: 0.35, neckThickness: 0.35, hands: 0.4, feet: 0.4, weight: 0.45, muscle: 0.25, jiggle: 'realistic' }) },
  { id: 'lanky', label: 'Lanky', examples: ['Elf mage', 'Tall and thin', 'Mister Fantastic'], gender: 'm', body: 'medium', dials: P({ height: 2.05, head: 0.35, legs: 0.9, arms: 0.9, torso: 0.6, shoulders: 0.3, chestDepth: 0.3, ribcage: 0.3, neck: 0.8, neckThickness: 0.3, hands: 0.65, feet: 0.6, weight: 0.12, muscle: 0.3, jiggle: 'realistic' }) },
  { id: 'slender', label: 'Slender agile', examples: ['Rogue, ranger', 'Naruto, Luffy', 'Spider-Man'], gender: 'm', body: 'small', dials: P({ height: 1.72, head: 0.5, legs: 0.6, arms: 0.55, shoulders: 0.45, weight: 0.3, muscle: 0.55, definition: 0.65, regional: { abs: 0.7 }, jiggle: 'realistic' }) },
  { id: 'athletic', label: 'Athletic hero', examples: ['Paladin', 'Zoro, Goku (base)', 'Captain America'], gender: 'm', body: 'medium', dials: P({ height: 1.86, head: 0.35, legs: 0.55, shoulders: 0.7, chestDepth: 0.6, weight: 0.4, muscle: 0.72, definition: 0.65, regional: { pecs: 0.6, delts: 0.6, lats: 0.65 }, posture: 'upright', jiggle: 'realistic' }) },
  { id: 'heroine', label: 'Anime heroine', examples: ['Sorceress, valkyrie', 'Nami, Tsunade, Erza', 'Wonder Woman'], gender: 'f', body: 'medium', dials: P({ height: 1.73, head: 0.45, legs: 0.78, shoulders: 0.42, waist: 0.2, hipCurve: 0.72, glutes: 0.68, thighs: 0.55, bustSize: 0.82, bustLift: 0.7, bustShape: 0.4, bustSpacing: 0.45, weight: 0.42, muscle: 0.45, jiggle: 'anime' }) },
  { id: 'athleticHeroine', label: 'Athletic heroine', examples: ['Huntress', 'Mikasa', 'Black Widow'], gender: 'f', body: 'small', dials: P({ height: 1.7, head: 0.45, legs: 0.62, shoulders: 0.5, waist: 0.35, hipCurve: 0.55, glutes: 0.6, bustSize: 0.5, bustLift: 0.6, weight: 0.32, muscle: 0.66, definition: 0.6, regional: { abs: 0.7, quads: 0.6 }, jiggle: 'realistic' }) },
  { id: 'powerhouse', label: 'Caped powerhouse', examples: ['Warlord', 'All Might', 'Superman'], gender: 'm', body: 'large', dials: P({ height: 1.96, head: 0.22, shoulders: 0.88, chestDepth: 0.78, ribcage: 0.75, neckThickness: 0.75, waist: 0.35, weight: 0.45, muscle: 0.86, definition: 0.6, regional: { pecs: 0.75, delts: 0.75, lats: 0.8, traps: 0.65 }, posture: 'heroic', jiggle: 'realistic' }) },
  { id: 'bodybuilder', label: 'Bodybuilder', examples: ['Barbarian (Conan the Barbarian)', 'Broly, Goku (super forms)', 'Hulk'], gender: 'm', body: 'huge', dials: P({ height: 1.98, head: 0.25, shoulders: 0.95, chestDepth: 0.8, ribcage: 0.8, neck: 0.35, neckThickness: 0.95, hands: 0.65, waist: 0.4, weight: 0.55, muscle: 1, definition: 0.9, regional: { traps: 0.9, delts: 0.85, pecs: 0.8, arms: 0.85, forearms: 0.75, lats: 0.85, quads: 0.75, calves: 0.7 }, posture: 'heroic', jiggle: 'realistic' }) },
  { id: 'heavyweight', label: 'Heavyweight', examples: ['Ogre-like brute', 'Chōji, Big Mom', 'Kingpin'], gender: 'm', body: 'huge', dials: P({ height: 1.88, head: 0.4, legs: 0.35, shoulders: 0.7, chestDepth: 0.75, ribcage: 0.8, neck: 0.3, neckThickness: 0.85, hands: 0.6, waist: 0.9, belly: 0.95, hipCurve: 0.7, thighs: 0.75, weight: 1, muscle: 0.6, jiggle: 'realistic' }) },
  { id: 'stocky', label: 'Stocky', examples: ['Dwarf', 'Short and dense', 'Wolverine'], gender: 'm', body: 'small', dials: P({ height: 1.48, head: 0.55, legs: 0.15, arms: 0.35, torso: 0.45, shoulders: 0.78, chestDepth: 0.72, ribcage: 0.7, neck: 0.25, neckThickness: 0.8, hands: 0.7, feet: 0.62, weight: 0.6, muscle: 0.78, regional: { traps: 0.7, forearms: 0.7 }, posture: 'hunched', jiggle: 'realistic' }) },
  { id: 'giant', label: 'Giant', examples: ['Half-giant', 'Jinbe', 'Thanos'], gender: 'm', body: 'huge', dials: P({ height: 2.5, head: 0.3, shoulders: 0.8, chestDepth: 0.75, ribcage: 0.8, neckThickness: 0.85, hands: 0.72, feet: 0.7, waist: 0.6, weight: 0.65, muscle: 0.75, posture: 'upright', jiggle: 'realistic' }) },
  { id: 'elder', label: 'Elder', examples: ['Old sage', 'Master Roshi', 'Professor X standing'], gender: 'm', body: 'medium', dials: P({ height: 1.66, head: 0.55, legs: 0.42, shoulders: 0.4, neckThickness: 0.4, weight: 0.42, muscle: 0.22, age: 1, posture: 'stoop', jiggle: 'realistic' }) },
]

export function preset(id: ArchetypeId): Archetype {
  const a = PRESETS.find((p) => p.id === id)
  if (!a) throw new Error(`no archetype ${id}`)
  return a
}

/** A preset's dials for the other gender: the same build, the figure dials kept neutral where the preset had none. */
export function presetDials(id: ArchetypeId): PhysiqueDials {
  const a = preset(id)
  return { ...a.dials, preset: id }
}

/** The jiggle a body gets when it names none: anime heroines bounce, children's busts never do. */
export function jiggleOf(p: Partial<PhysiqueDials>): JigglePreset {
  return p.jiggle ?? 'realistic'
}
