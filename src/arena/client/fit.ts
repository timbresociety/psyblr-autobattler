import * as THREE from 'three'

/**
 * Weapons sized to the hero that holds them. Every piece is modelled once, for the hands of our medium body
 * (MODELLED), and a hero's hands are rarely those: each size class has its own body with its own hands, a physique's
 * Hands dial scales them, and a generated hero brings whatever its mesh has. So a hero's hand sockets take the scale
 * of its own hands against the modelled ones, and everything hung on them (gear.ts, arms.ts) comes out to fit: a grip
 * fills the palm the same on every body up to the medium one, a piece on a carry slot is the size it is in the hand,
 * and a piece no hand holds (a quiver) is sized to the body it hangs on. Past the medium body a weapon grows less than
 * the hand does (GROW): scaled all the way with a giant it was a giant's in every measure, a staff taller than a room
 * and a shaft too thick for the fist that held it (owner, 2026-11-13).
 */

/** The body the pieces are modelled for, as `measureFit` measures a body: metres on our medium body at rest. */
export const MODELLED = {
  /** Wrist to the end of the middle finger, joint by joint. */
  hand: 0.2143,
  /** Across the knuckles, first to little finger. */
  palm: 0.0741,
  /** A leg and the back: hip to ankle, then hips to the head's joint. */
  frame: 1.484,
}

/**
 * How far a hero's hands may stand from its frame before the frame decides: a mitten, a claw or a hand whose fingers
 * the rig never found would otherwise shrink a sword to a knife or swell it past the hero's own height.
 */
export const HAND_RANGE: readonly [number, number] = [0.75, 1.4]

/**
 * How a weapon grows with a hand bigger than the modelled one, as a power of the hand's size in the world: 1 keeps it
 * in proportion, 0 leaves it as modelled. At 0.6 a colossal hero's is 1.29 times a medium hero's, not 1.53.
 */
export const GROW = 0.6

/**
 * The scale a held piece takes on a hand `hand` times the modelled one, in the model's own space; `drawn` is the scale
 * the model is drawn at in the world (a size class's, its physique's height with it; 1 for a generated hero, drawn at
 * its own height). The piece is sized to the hand as it is in the world, and comes out at that whatever `drawn` is.
 */
export function pieceFit(hand: number, drawn = 1): number {
  const world = hand * drawn
  return (world > 1 ? world ** GROW : world) / drawn
}

export interface Fit {
  /** The scale a piece takes in the hand, in the model's own space (its root's scale, a size class's, comes on top). */
  hand: number
  /** The scale a piece worn on the body takes, the same way. */
  body: number
}

const FINGER = ['Hand', 'HandMiddle1', 'HandMiddle2', 'HandMiddle3', 'HandMiddle4']
const KNUCKLES = ['HandIndex1', 'HandPinky1']
const LEG = ['UpLeg', 'Leg', 'Foot']
const BACK = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head']
const SIDES = ['Left', 'Right']

const a = new THREE.Vector3()
const b = new THREE.Vector3()
/** In development `?fit=off` hangs every piece as modelled, to set the fitted ones beside (scripts/course.mjs --fit). */
const UNFITTED = !!import.meta.env?.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('fit') === 'off'
/** Each model's fit, measured once (not in its userData: a clone would take its source's along). */
const measured = new WeakMap<THREE.Object3D, Fit>()

/**
 * The length of a chain of joints in the model's own space (bones are rigid, so any pose gives its rest length, and a
 * hand bone a physique scaled carries its fingers out with it); undefined when a joint is missing or two fall on one
 * point.
 */
function chain(model: THREE.Object3D, names: readonly string[]): number | undefined {
  const joints = names.map((n) => model.getObjectByName(n))
  if (joints.some((j) => !j)) return undefined
  let sum = 0
  for (let i = 1; i < joints.length; i++) {
    const step = joints[i - 1]!.getWorldPosition(a).distanceTo(joints[i]!.getWorldPosition(b))
    if (step < 1e-5) return undefined
    sum += step
  }
  return sum / model.getWorldScale(a).x
}

const mean = (values: readonly (number | undefined)[]): number | undefined => {
  const got = values.filter((v): v is number => v !== undefined)
  return got.length ? got.reduce((s, v) => s + v, 0) / got.length : undefined
}

/**
 * A hero's hands and frame against the modelled body's, read off its own skeleton: both hands as one, so a pair of
 * guns match. The hand counts by its length and its breadth together (a broad hand with short fingers still wants a
 * grip that fills it). A body of ours comes out within a few percent of 1 before its root scales it; a generated
 * hero, drawn at its own height, comes out at its own size. Kept for the model: measure once its skeleton is final.
 */
export function measureFit(model: THREE.Object3D): Fit {
  const kept = measured.get(model)
  if (kept) return kept
  if (UNFITTED) return { hand: 1, body: 1 }
  model.updateWorldMatrix(true, true)
  const frame = mean(SIDES.map((s) => chain(model, LEG.map((n) => s + n))))
  const back = chain(model, BACK)
  const body = frame !== undefined && back !== undefined ? (frame + back) / MODELLED.frame : 1
  const long = mean(SIDES.map((s) => chain(model, FINGER.map((n) => s + n))))
  const wide = mean(SIDES.map((s) => chain(model, KNUCKLES.map((n) => s + n))))
  const hands = long !== undefined ? Math.sqrt((long / MODELLED.hand) * ((wide ?? (long * MODELLED.palm) / MODELLED.hand) / MODELLED.palm)) : body
  const fit = { hand: Math.min(body * HAND_RANGE[1], Math.max(body * HAND_RANGE[0], hands)), body }
  measured.set(model, fit)
  return fit
}
