import { HELPER_BONES, metaBone, type MetaBone } from '../rig/metarig.js'
import { bodyLandmarks, girth, placeAt, regionMask, type Skeleton, type Skin, type Vec3 } from './regions.js'

/**
 * The metarig's skin helpers on one body (GAME.md §9.2 weights): where each sits at rest, measured on the body, and
 * the share of the skin it takes. Skinned once at load, renderer-free:
 *
 * - A helper takes weight only from the bone it hangs on (its first ancestor on the standard rig), so with the helper
 *   at rest the body deforms exactly as before; a lean body, whose helpers never move, is unchanged.
 * - Each vertex gives at most one helper a share (the one whose region holds it most), in a free influence slot, or
 *   in its smallest one folded into its largest first.
 */

export interface HelperPlan {
  bone: MetaBone
  /** Where its joint sits at rest, in the body's own space. */
  at: Vec3
  /** The body's radius there: how far its drivers push, in metres. */
  girth: number
  /** The standard bone it takes skin from (its parent, or its parent's when it hangs on another helper). */
  from: string
}

/** The standard bone under a metarig bone: its parent, or its parent's parent when it hangs on a helper. */
export function skinParent(b: MetaBone): string {
  let p = b.parent
  for (let m = metaBone(p); m && m.kind !== 'root'; m = metaBone(p)) p = m.parent
  return p
}

/** Where every helper sits on this body at rest. */
export function planHelpers(skin: Skin, skeleton: Skeleton): HelperPlan[] {
  const lm = bodyLandmarks(skin, skeleton)
  return HELPER_BONES.map((bone) => {
    const from = skinParent(bone)
    if (bone.kind === 'jiggle') {
      const l = bone.dial === 'bust' ? lm.breast[bone.side!] : bone.dial === 'glutes' ? lm.glute[bone.side!] : lm.belly
      const at: Vec3 = l ? l.at : (skeleton.rest[from] as Vec3)
      return { bone, at, girth: l?.radius ?? 0.08, from }
    }
    const pl = bone.place!
    const g = girth(skin, skeleton, pl.from, pl.to, pl.along, bone.region!.bones)
    return { bone, at: placeAt(skeleton, pl.from, pl.to, pl.along, pl.out, g, bone.side), girth: g, from }
  })
}

export interface HelperSkin {
  /** Four bones a vertex, helpers numbered after the body's own bones in plan order. */
  joints: Uint16Array
  weights: Float32Array
  /** How many vertices each helper took a share of. */
  counts: number[]
}

/** Below this a share isn't worth a slot. */
const MIN_SHARE = 0.02
/** The most weight a vertex with every slot full folds away to make room for a helper. */
const MAX_FOLD = 0.08

/**
 * The body's skin with the helpers' shares in it. `bones` is the skin's bone order; helper k becomes bone
 * `bones.length + k`. Masks run over each helper's region, reaching `radius` girths from it.
 */
export function helperSkin(skin: Skin, skeleton: Skeleton, plans: readonly HelperPlan[]): HelperSkin {
  const n = skin.positions.length / 3
  const joints = Uint16Array.from(skin.joints)
  const weights = Float32Array.from(skin.weights)
  const best = new Float32Array(n)
  const pick = new Int16Array(n).fill(-1)
  plans.forEach((plan, k) => {
    const { bone } = plan
    const reach = plan.girth * bone.region!.radius * (bone.kind === 'jiggle' ? 1.3 : 1.6)
    const mask = regionMask(skin, skeleton, bone.region!, plan.at, reach, bone.side)
    // a jiggle bone outranks the muscle it rides on, which outranks a corrective, where they overlap
    const rank = bone.kind === 'jiggle' ? 1.3 : bone.kind === 'muscle' ? 1 : 0.9
    for (let i = 0; i < n; i++) {
      const m = mask[i] * rank
      if (m > best[i]) (best[i] = m), (pick[i] = k)
    }
  })
  const counts = plans.map(() => 0)
  const boneIndex = new Map(skeleton.bones.map((b, i) => [b, i]))
  for (let i = 0; i < n; i++) {
    const k = pick[i]
    if (k < 0) continue
    const plan = plans[k]
    const parent = boneIndex.get(plan.from)
    if (parent === undefined) continue
    // the helper takes this much of the weight the vertex has on its parent
    const m = Math.min(1, best[i] / (plan.bone.kind === 'jiggle' ? 1.3 : plan.bone.kind === 'muscle' ? 1 : 0.9))
    let slot = -1
    let on = -1
    for (let s = 0; s < 4; s++) if (joints[i * 4 + s] === parent && weights[i * 4 + s] > 0) on = s
    if (on < 0) continue
    const take = weights[i * 4 + on] * m
    if (take < MIN_SHARE) continue
    for (let s = 0; s < 4; s++) if (weights[i * 4 + s] === 0) slot = s
    if (slot < 0) {
      // no free slot: the smallest influence folds into the largest
      let lo = 0
      let hi = 0
      for (let s = 1; s < 4; s++) {
        if (weights[i * 4 + s] < weights[i * 4 + lo]) lo = s
        if (weights[i * 4 + s] > weights[i * 4 + hi]) hi = s
      }
      // ...unless it is too big to fold without the vertex moving differently: then it goes without a helper
      if (lo === on || weights[i * 4 + lo] > MAX_FOLD) continue
      weights[i * 4 + hi] += weights[i * 4 + lo]
      weights[i * 4 + lo] = 0
      slot = lo
    }
    weights[i * 4 + on] -= take
    joints[i * 4 + slot] = skeleton.bones.length + k
    weights[i * 4 + slot] = take
    counts[k]++
  }
  return { joints, weights, counts }
}
