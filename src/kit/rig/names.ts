/**
 * The bones the kit names, on each rig a body can be on: the 20-bone rig of the first bodies and the Psyblr Human
 * (standard.json; docs/plans/2026-10-31-canon-psyblr-human.md). The wardrobe's fit, fields, cloth and covers ask a
 * body which rig it is on (`kitRigOf`) and take their bone names from here, so one wardrobe pipeline serves both.
 */

export type RigKind = 'legacy' | 'standard'

export interface KitRigNames {
  kind: RigKind
  hips: string
  spine: string
  chest: string
  upperChest: string
  neck: string
  head: string
  clavicle: Sided
  upperArm: Sided
  forearm: Sided
  hand: Sided
  thigh: Sided
  shin: Sided
  foot: Sided
  /** The trunk's bones: hips to neck, the clavicles included. */
  torso: readonly string[]
  /** Upper arms and forearms, with whatever helpers ride them. */
  arms: readonly string[]
  /** Thighs and shins, with whatever helpers ride them. */
  legs: readonly string[]
  /** Hands, fingers included. */
  hands: readonly string[]
  /** Feet, toes included. */
  feet: readonly string[]
  /** Shoulder, elbow, wrist; hip, knee, ankle: the chains the fields run along. */
  armChain: Record<'L' | 'R', readonly [string, string, string]>
  legChain: Record<'L' | 'R', readonly [string, string, string]>
  /** The limb and trunk segments loose cloth keeps out of. */
  segments: readonly (readonly [string, string])[]
}

type Sided = Record<'L' | 'R', string>

const LEGACY: KitRigNames = {
  kind: 'legacy',
  hips: 'hips',
  spine: 'spine',
  chest: 'chest',
  upperChest: 'upper_chest',
  neck: 'neck',
  head: 'head',
  clavicle: { L: 'clavicle_L', R: 'clavicle_R' },
  upperArm: { L: 'upper_arm_L', R: 'upper_arm_R' },
  forearm: { L: 'forearm_L', R: 'forearm_R' },
  hand: { L: 'hand_L', R: 'hand_R' },
  thigh: { L: 'thigh_L', R: 'thigh_R' },
  shin: { L: 'shin_L', R: 'shin_R' },
  foot: { L: 'foot_L', R: 'foot_R' },
  torso: ['hips', 'spine', 'chest', 'upper_chest', 'clavicle_L', 'clavicle_R', 'neck'],
  arms: ['upper_arm_L', 'upper_arm_R', 'forearm_L', 'forearm_R'],
  legs: ['thigh_L', 'thigh_R', 'shin_L', 'shin_R'],
  hands: ['hand_L', 'hand_R'],
  feet: ['foot_L', 'foot_R'],
  armChain: { L: ['upper_arm_L', 'forearm_L', 'hand_L'], R: ['upper_arm_R', 'forearm_R', 'hand_R'] },
  legChain: { L: ['thigh_L', 'shin_L', 'foot_L'], R: ['thigh_R', 'shin_R', 'foot_R'] },
  segments: [
    ['hips', 'spine'],
    ['spine', 'chest'],
    ['chest', 'upper_chest'],
    ['upper_chest', 'neck'],
    ['upper_arm_L', 'forearm_L'],
    ['forearm_L', 'hand_L'],
    ['upper_arm_R', 'forearm_R'],
    ['forearm_R', 'hand_R'],
    ['thigh_L', 'shin_L'],
    ['shin_L', 'foot_L'],
    ['thigh_R', 'shin_R'],
    ['shin_R', 'foot_R'],
  ],
}

const DIGITS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']
const fingers = (side: 'Left' | 'Right') => DIGITS.flatMap((d) => [1, 2, 3].map((i) => `${side}Hand${d}${i}`))

const STANDARD: KitRigNames = {
  kind: 'standard',
  hips: 'Hips',
  spine: 'Spine',
  chest: 'Spine1',
  upperChest: 'Spine2',
  neck: 'Neck',
  head: 'Head',
  clavicle: { L: 'LeftShoulder', R: 'RightShoulder' },
  upperArm: { L: 'LeftArm', R: 'RightArm' },
  forearm: { L: 'LeftForeArm', R: 'RightForeArm' },
  hand: { L: 'LeftHand', R: 'RightHand' },
  thigh: { L: 'LeftUpLeg', R: 'RightUpLeg' },
  shin: { L: 'LeftLeg', R: 'RightLeg' },
  foot: { L: 'LeftFoot', R: 'RightFoot' },
  torso: ['Hips', 'Spine', 'Spine1', 'Spine2', 'LeftShoulder', 'RightShoulder', 'Neck'],
  arms: ['LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftArmTwist', 'RightArmTwist', 'LeftForeArmTwist', 'RightForeArmTwist'],
  legs: ['LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftUpLegTwist', 'RightUpLegTwist', 'LeftLegTwist', 'RightLegTwist'],
  hands: ['LeftHand', 'RightHand', ...fingers('Left'), ...fingers('Right')],
  feet: ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'],
  armChain: { L: ['LeftArm', 'LeftForeArm', 'LeftHand'], R: ['RightArm', 'RightForeArm', 'RightHand'] },
  legChain: { L: ['LeftUpLeg', 'LeftLeg', 'LeftFoot'], R: ['RightUpLeg', 'RightLeg', 'RightFoot'] },
  segments: [
    ['Hips', 'Spine'],
    ['Spine', 'Spine1'],
    ['Spine1', 'Spine2'],
    ['Spine2', 'Neck'],
    ['LeftArm', 'LeftForeArm'],
    ['LeftForeArm', 'LeftHand'],
    ['RightArm', 'RightForeArm'],
    ['RightForeArm', 'RightHand'],
    ['LeftUpLeg', 'LeftLeg'],
    ['LeftLeg', 'LeftFoot'],
    ['RightUpLeg', 'RightLeg'],
    ['RightLeg', 'RightFoot'],
  ],
}

export const KIT_RIGS: Readonly<Record<RigKind, KitRigNames>> = { legacy: LEGACY, standard: STANDARD }

/** Which rig a body's bones belong to: the Psyblr Human has `Hips`, the first rig `hips`. */
export function kitRigOf(bones: readonly string[]): KitRigNames {
  return bones.includes('Hips') ? STANDARD : LEGACY
}

/** Welded vertices on each rig's shared body surface: what an item must be bound to. */
export const SURFACE_VERTICES: Readonly<Record<RigKind, number>> = { legacy: 2595, standard: 13552 }
