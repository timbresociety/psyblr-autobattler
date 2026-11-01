import type * as THREE from 'three'
import { STANDARD_BONES } from '../../kit/rig/standard.js'

/**
 * The two rigs a body can be on, and the bones the arena's animation code names (docs/plans/2026-10-31-canon-psyblr-
 * human.md, phase 1): the 20-bone rig the first bodies were built on (public/heroes/<body>.glb) and the Psyblr Human
 * (public/heroes/v2/, src/kit/rig/standard.json). Everything that looks a bone up by name goes through here, so a
 * hero on either rig runs, casts and plants its feet the same way.
 */

export type RigKind = 'legacy' | 'standard'

export interface RigNames {
  kind: RigKind
  hips: string
  spine: string
  chest: string
  upperChest: string
  neck: string
  head: string
  hand: { L: string; R: string }
  thigh: { L: string; R: string }
  shin: { L: string; R: string }
  foot: { L: string; R: string }
  /** The bones a cast on the move leaves to the run: the hips and both legs. */
  legBones: ReadonlySet<string>
  /** How a chest twist is shared up the back, hips to head. */
  twistShare: Readonly<Record<string, number>>
  /** Each twist bone with the segment it sits on and the bone whose roll it takes half of (standard rig only). */
  twists: readonly { bone: string; parent: string; follows: string }[]
  /** Each hand's finger joints that a grip curls, thumb last. */
  fingers: { L: readonly string[]; R: readonly string[] }
}

const LEGACY: RigNames = {
  kind: 'legacy',
  hips: 'hips',
  spine: 'spine',
  chest: 'chest',
  upperChest: 'upper_chest',
  neck: 'neck',
  head: 'head',
  hand: { L: 'hand_L', R: 'hand_R' },
  thigh: { L: 'thigh_L', R: 'thigh_R' },
  shin: { L: 'shin_L', R: 'shin_R' },
  foot: { L: 'foot_L', R: 'foot_R' },
  legBones: new Set(['hips', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R']),
  twistShare: { spine: 0.3, chest: 0.3, upper_chest: 0.25, neck: 0.15 },
  twists: [],
  fingers: { L: [], R: [] },
}

const DIGITS = ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']
const fingerJoints = (side: 'Left' | 'Right') => DIGITS.flatMap((d) => [1, 2, 3].map((i) => `${side}Hand${d}${i}`))

const STANDARD: RigNames = {
  kind: 'standard',
  hips: 'Hips',
  spine: 'Spine',
  chest: 'Spine1',
  upperChest: 'Spine2',
  neck: 'Neck',
  head: 'Head',
  hand: { L: 'LeftHand', R: 'RightHand' },
  thigh: { L: 'LeftUpLeg', R: 'RightUpLeg' },
  shin: { L: 'LeftLeg', R: 'RightLeg' },
  foot: { L: 'LeftFoot', R: 'RightFoot' },
  legBones: new Set(['Hips', 'LeftUpLeg', 'LeftUpLegTwist', 'LeftLeg', 'LeftLegTwist', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightUpLegTwist', 'RightLeg', 'RightLegTwist', 'RightFoot', 'RightToeBase']),
  twistShare: { Spine: 0.3, Spine1: 0.3, Spine2: 0.25, Neck: 0.15 },
  twists: STANDARD_BONES.filter((b) => b.kind === 'twist').map((b) => ({ bone: b.name, parent: b.parent!, follows: b.follows! })),
  fingers: { L: fingerJoints('Left'), R: fingerJoints('Right') },
}

export const RIGS: Readonly<Record<RigKind, RigNames>> = { legacy: LEGACY, standard: STANDARD }

/** Which rig a loaded model is on, by the bones it has; legacy when it has neither (a generated hero draws as it is). */
export function rigOf(model: THREE.Object3D): RigNames {
  return model.getObjectByName(STANDARD.hips) ? STANDARD : LEGACY
}

/** The head bone of a model on either rig. */
export function headBone(model: THREE.Object3D): THREE.Object3D | undefined {
  return model.getObjectByName(STANDARD.head) ?? model.getObjectByName(LEGACY.head)
}
