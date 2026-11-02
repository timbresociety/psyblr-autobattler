import { KEYED_BONES, STANDARD_BONES } from './standard.js'

/**
 * The metarig (GAME.md §9.2): the Psyblr Human rig (standard.json, which every clip keys) plus the bones that clips
 * never key. They go on at load (src/arena/client/metarig/), placed and weighted from the body's own skin and surface,
 * so every body file, today's twelve and any generated later (§9.5), gets them the same way:
 *
 * - `root`: Root, on the ground under the hips, the parent of Hips. Root motion and its scaling go here.
 * - `neck`: Neck1, an optional second neck joint halfway up a long or thick neck, taking half the neck's bend.
 * - `muscle`: a helper inside each muscle that swells as its joint turns, by that region's muscle dial (0 on a lean
 *   body, so it has no effect there).
 * - `corrective`: a helper at each big joint that pushes the skin out as it bends, so big bodies don't pinch.
 * - `jiggle`: a spring-damper after the clip (§9.4); breasts (a subtle chest pad on muscular males), glutes, belly.
 * - `socket`: where a prop, an effect or a hand attaches (§6). Not skinned.
 * - `ik`: a virtual target a foot or hand is solved to at runtime. Not skinned.
 *
 * Directions are the body's at rest, in glTF axes: +z forward (the hero faces it), +x the hero's left, +y up.
 */

export type MetaKind = 'root' | 'neck' | 'muscle' | 'corrective' | 'jiggle' | 'socket' | 'ik'
export type Side = 'Left' | 'Right'

/** The muscle regions with their own dial (§9.3, regional muscle). Abs and obliques are a surface dial, no helper. */
export const MUSCLE_REGIONS = ['traps', 'delts', 'pecs', 'arms', 'forearms', 'lats', 'glutes', 'quads', 'calves'] as const
export type MuscleRegion = (typeof MUSCLE_REGIONS)[number]
export type JiggleRegion = 'bust' | 'glutes' | 'belly'

/**
 * Where a helper sits at rest: `along` the way from bone `from`'s joint to bone `to`'s (0 at `from`), then pushed out
 * by `out` local girths: [forward, outward to its side, up]. A girth is the body's radius there, measured on the skin.
 */
export interface Placement {
  from: string
  to: string
  along: number
  out: readonly [forward: number, side: number, up: number]
}

/**
 * What turns a muscle or corrective: the joint's swing-twist (swing-twist.ts) from rest, one axis, mapped linearly
 * from `range[0]` (no effect) to `range[1]` (full effect), clamped.
 */
export interface Driver {
  joint: string
  axis: 'twist' | 'x' | 'z' | 'swing'
  range: readonly [number, number]
}

/**
 * Which skin a helper takes over: vertices weighted to `bones`, within `radius` girths of it, on the side `facing`
 * points to (a dot product over 0 with the body direction; absent, every side).
 */
export interface Region {
  bones: readonly string[]
  radius: number
  facing?: readonly [forward: number, side: number, up: number]
}

export interface MetaBone {
  name: string
  kind: MetaKind
  parent: string
  side?: Side
  place?: Placement
  driver?: Driver
  region?: Region
  /** The dial that scales a muscle helper or jiggle bone. */
  dial?: MuscleRegion | JiggleRegion
}

const SIDES: readonly Side[] = ['Left', 'Right']

function sided(side: Side): MetaBone[] {
  const S = side
  const m = (name: string, parent: string, dial: MuscleRegion, place: Placement, driver: Driver, region: Region): MetaBone => ({ name: `${S}${name}Muscle`, kind: 'muscle', parent, side, dial, place, driver, region })
  const c = (name: string, parent: string, place: Placement, driver: Driver, region: Region): MetaBone => ({ name: `${S}${name}Corrective`, kind: 'corrective', parent, side, place, driver, region })
  return [
    m('Trapezius', `${S}Shoulder`, 'traps', { from: `${S}Shoulder`, to: `${S}Arm`, along: 0.35, out: [-0.3, 0, 0.9] }, { joint: `${S}Shoulder`, axis: 'swing', range: [5, 35] }, { bones: [`${S}Shoulder`, 'Neck', 'Spine2'], radius: 1.6, facing: [-0.3, 0, 1] }),
    m('Deltoid', `${S}Arm`, 'delts', { from: `${S}Arm`, to: `${S}ForeArm`, along: 0.12, out: [0, 0.6, 0.2] }, { joint: `${S}Arm`, axis: 'swing', range: [20, 100] }, { bones: [`${S}Arm`, `${S}ArmTwist`, `${S}Shoulder`], radius: 1.5, facing: [0, 1, 0.4] }),
    m('Pectoral', 'Spine2', 'pecs', { from: 'Spine2', to: `${S}Arm`, along: 0.45, out: [0.8, 0, -0.3] }, { joint: `${S}Arm`, axis: 'swing', range: [15, 80] }, { bones: ['Spine2', `${S}Shoulder`], radius: 1.4, facing: [1, 0.2, 0] }),
    m('Latissimus', 'Spine1', 'lats', { from: 'Spine1', to: `${S}Arm`, along: 0.4, out: [-0.6, 0.6, 0] }, { joint: `${S}Arm`, axis: 'swing', range: [10, 60] }, { bones: ['Spine1', 'Spine2'], radius: 1.4, facing: [-1, 0.7, 0] }),
    m('Biceps', `${S}Arm`, 'arms', { from: `${S}Arm`, to: `${S}ForeArm`, along: 0.55, out: [0.5, 0, 0] }, { joint: `${S}ForeArm`, axis: 'swing', range: [15, 120] }, { bones: [`${S}Arm`, `${S}ArmTwist`], radius: 1.5, facing: [1, 0, 0] }),
    m('Triceps', `${S}Arm`, 'arms', { from: `${S}Arm`, to: `${S}ForeArm`, along: 0.45, out: [-0.5, 0, 0] }, { joint: `${S}ForeArm`, axis: 'swing', range: [60, 5] }, { bones: [`${S}Arm`, `${S}ArmTwist`], radius: 1.5, facing: [-1, 0, 0] }),
    m('Forearm', `${S}ForeArm`, 'forearms', { from: `${S}ForeArm`, to: `${S}Hand`, along: 0.28, out: [0.3, 0.3, 0] }, { joint: `${S}Hand`, axis: 'swing', range: [10, 60] }, { bones: [`${S}ForeArm`, `${S}ForeArmTwist`], radius: 1.4 }),
    m('Glute', 'Hips', 'glutes', { from: 'Hips', to: `${S}UpLeg`, along: 1, out: [-1, 0, 0.2] }, { joint: `${S}UpLeg`, axis: 'swing', range: [10, 70] }, { bones: ['Hips', `${S}UpLeg`], radius: 1.3, facing: [-1, 0.3, 0] }),
    m('Quad', `${S}UpLeg`, 'quads', { from: `${S}UpLeg`, to: `${S}Leg`, along: 0.45, out: [0.5, 0, 0] }, { joint: `${S}Leg`, axis: 'swing', range: [10, 100] }, { bones: [`${S}UpLeg`, `${S}UpLegTwist`], radius: 1.4, facing: [1, 0.2, 0] }),
    m('Calf', `${S}Leg`, 'calves', { from: `${S}Leg`, to: `${S}Foot`, along: 0.28, out: [-0.6, 0, 0] }, { joint: `${S}Foot`, axis: 'swing', range: [5, 40] }, { bones: [`${S}Leg`, `${S}LegTwist`], radius: 1.4, facing: [-1, 0, 0] }),
    c('Shoulder', `${S}Arm`, { from: `${S}Arm`, to: `${S}ForeArm`, along: 0, out: [0, 0.2, 0.5] }, { joint: `${S}Arm`, axis: 'swing', range: [30, 120] }, { bones: [`${S}Arm`, `${S}Shoulder`], radius: 1.1, facing: [0, 0.4, 1] }),
    c('Elbow', `${S}ForeArm`, { from: `${S}ForeArm`, to: `${S}Hand`, along: 0, out: [-0.6, 0, 0] }, { joint: `${S}ForeArm`, axis: 'swing', range: [30, 130] }, { bones: [`${S}ForeArm`, `${S}Arm`, `${S}ArmTwist`], radius: 1, facing: [-1, 0, 0] }),
    c('Wrist', `${S}Hand`, { from: `${S}Hand`, to: `${S}HandMiddle1`, along: 0, out: [0, 0, 0] }, { joint: `${S}Hand`, axis: 'swing', range: [20, 80] }, { bones: [`${S}Hand`, `${S}ForeArmTwist`], radius: 0.9 }),
    c('Hip', `${S}UpLeg`, { from: `${S}UpLeg`, to: `${S}Leg`, along: 0.05, out: [0.6, 0, 0] }, { joint: `${S}UpLeg`, axis: 'swing', range: [30, 120] }, { bones: [`${S}UpLeg`, 'Hips'], radius: 1, facing: [1, 0, 0] }),
    c('Knee', `${S}Leg`, { from: `${S}Leg`, to: `${S}Foot`, along: 0, out: [0.6, 0, 0] }, { joint: `${S}Leg`, axis: 'swing', range: [30, 140] }, { bones: [`${S}Leg`, `${S}UpLeg`, `${S}UpLegTwist`], radius: 1, facing: [1, 0, 0] }),
    c('Ankle', `${S}Foot`, { from: `${S}Foot`, to: `${S}ToeBase`, along: 0, out: [0, 0, 0] }, { joint: `${S}Foot`, axis: 'swing', range: [15, 50] }, { bones: [`${S}Foot`, `${S}LegTwist`], radius: 0.9 }),
    // jiggle rides on the muscle under it, so the breast follows the pec's swell and the buttock the glute's
    { name: `${S}BreastJiggle`, kind: 'jiggle', parent: `${S}PectoralMuscle`, side, dial: 'bust', region: { bones: ['Spine2', 'Spine1'], radius: 1.1, facing: [1, 0, 0] } },
    { name: `${S}GluteJiggle`, kind: 'jiggle', parent: `${S}GluteMuscle`, side, dial: 'glutes', region: { bones: ['Hips', `${S}UpLeg`], radius: 1, facing: [-1, 0, 0] } },
  ]
}

export const SOCKETS = ['hand_r', 'hand_l', 'back', 'hips', 'muzzle', 'weapon_tip'] as const
export type SocketName = (typeof SOCKETS)[number]
/** Where each socket hangs: muzzle and weapon tip ride on the right hand until a held item says where they are. */
export const SOCKET_BONE: Readonly<Record<SocketName, string>> = { hand_r: 'RightHand', hand_l: 'LeftHand', back: 'Spine2', hips: 'Hips', muzzle: 'RightHand', weapon_tip: 'RightHand' }

export const IK_TARGETS = ['IK_Foot_L', 'IK_Foot_R', 'IK_Hand_L', 'IK_Hand_R'] as const

export const METARIG_BONES: readonly MetaBone[] = [
  { name: 'Root', kind: 'root', parent: '' },
  { name: 'Neck1', kind: 'neck', parent: 'Neck' },
  { name: 'BellyJiggle', kind: 'jiggle', parent: 'Spine', dial: 'belly', region: { bones: ['Spine', 'Hips', 'Spine1'], radius: 1.2, facing: [1, 0, -0.2] } },
  ...SIDES.flatMap(sided),
  ...SOCKETS.map((s): MetaBone => ({ name: `socket:${s}`, kind: 'socket', parent: SOCKET_BONE[s] })),
  ...IK_TARGETS.map((t): MetaBone => ({ name: t, kind: 'ik', parent: 'Root' })),
]

/** The bones that deform the skin on top of the standard rig's. */
export const HELPER_BONES: readonly MetaBone[] = METARIG_BONES.filter((b) => b.kind === 'muscle' || b.kind === 'corrective' || b.kind === 'jiggle')

const byName = new Map(METARIG_BONES.map((b) => [b.name, b]))
export const metaBone = (name: string) => byName.get(name)

/** Every bone name a clip may key: the standard rig's keyed bones and nothing the metarig adds. */
export const CLIP_BONES: ReadonlySet<string> = new Set(KEYED_BONES)

/** All names in the metarig, standard bones first. */
export const ALL_BONES: readonly string[] = [...STANDARD_BONES.map((b) => b.name), ...METARIG_BONES.map((b) => b.name)]

/** The body direction (forward, outward, up) for a side, in glTF axes: outward is +x on the left, -x on the right. */
export function bodyDirection(v: readonly [number, number, number], side: Side | undefined): [x: number, y: number, z: number] {
  const s = side === 'Right' ? -1 : 1
  return [v[1] * s, v[2], v[0]]
}
