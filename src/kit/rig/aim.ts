import { Quaternion, Vector3, type Object3D } from 'three'
import { clampToLimits } from './limits.js'

/**
 * Aim and look IK (GAME.md §9.6 fix-ups): turn the body from the hips up toward a direction, spread over the spine,
 * the neck and the head so no one joint takes it all, each inside its comfortable share and its joint limit
 * (limits.ts). What one joint can't take passes up to the next, and what the whole chain can't take is left over,
 * for the hero's own turn to make up. Runs after the clip has posed the body; the caller puts the chain back before
 * the next update.
 */

export interface AimLink {
  bone: Object3D
  /** The bone's local rotation at rest (limits are measured from it). */
  rest: Quaternion
  /** Most of a turn this bone takes, left-right and up-down, in degrees. */
  yaw: number
  pitch: number
}

/** The shares a chain takes, from the bottom of the spine to the head: the neck and head take most, the back the rest. */
export const AIM_SHARES: Readonly<Record<string, { yaw: number; pitch: number }>> = {
  Spine: { yaw: 12, pitch: 8 },
  Spine1: { yaw: 12, pitch: 8 },
  Spine2: { yaw: 14, pitch: 10 },
  Neck: { yaw: 30, pitch: 22 },
  Head: { yaw: 25, pitch: 20 },
}
/** Looking only (no weapon to bring round): the neck and head. */
export const LOOK_SHARES: Readonly<Record<string, { yaw: number; pitch: number }>> = {
  Neck: { yaw: 35, pitch: 25 },
  Head: { yaw: 30, pitch: 22 },
}

const DEG = Math.PI / 180
const fwd = new Vector3()
const side = new Vector3()
const q = new Quaternion()
const parentQ = new Quaternion()
const boneQ = new Quaternion()
const delta = new Quaternion()
const scratch = new Vector3()
const flat = new Vector3()

/** Turn `bone` by `world` (a rotation in world space) from its current world matrix, and keep its subtree current. */
function turnBy(bone: Object3D, world: Quaternion) {
  bone.parent!.matrixWorld.decompose(scratch, parentQ, scratch)
  bone.matrixWorld.decompose(scratch, boneQ, scratch)
  bone.quaternion.copy(parentQ.invert().multiply(world).multiply(boneQ))
  bone.updateMatrixWorld(true)
}

/** Where the end of the chain faces, in world space: `facing` is that direction in the last bone's own frame. */
function facingOf(end: Object3D, facing: Vector3, out: Vector3) {
  end.matrixWorld.decompose(scratch, boneQ, scratch)
  return out.copy(facing).applyQuaternion(boneQ).normalize()
}

/** Left-right and up-down from `from` to `to`, in radians, about `up`: yaw positive turning toward up × from. */
export function yawPitch(from: Vector3, to: Vector3, up: Vector3): { yaw: number; pitch: number } {
  const a = flat.copy(from).addScaledVector(up, -from.dot(up))
  const b = scratch.copy(to).addScaledVector(up, -to.dot(up))
  const yaw = a.lengthSq() < 1e-8 || b.lengthSq() < 1e-8 ? 0 : Math.atan2(a.clone().cross(b).dot(up), a.dot(b))
  const pitch = Math.asin(Math.max(-1, Math.min(1, to.dot(up)))) - Math.asin(Math.max(-1, Math.min(1, from.dot(up))))
  return { yaw, pitch }
}

/**
 * Turn `chain` (bottom first, world matrices current) so the last bone's `facing` points along `target` (a world
 * direction), `weight` of the way. Returns what is left over, in degrees, the larger of left-right and up-down.
 */
export function aimChain(chain: readonly (AimLink & { name: string })[], facing: Vector3, target: Vector3, up: Vector3, weight = 1): number {
  const end = chain[chain.length - 1].bone
  let left = { yaw: 0, pitch: 0 }
  for (let i = 0; i < chain.length; i++) {
    left = yawPitch(facingOf(end, facing, fwd), target, up)
    const room = { yaw: 0, pitch: 0 }
    for (let j = i; j < chain.length; j++) (room.yaw += chain[j].yaw), (room.pitch += chain[j].pitch)
    const link = chain[i]
    const yaw = Math.max(-link.yaw * DEG, Math.min(link.yaw * DEG, (left.yaw * weight * link.yaw) / room.yaw))
    const pitch = Math.max(-link.pitch * DEG, Math.min(link.pitch * DEG, (left.pitch * weight * link.pitch) / room.pitch))
    // left-right about the world's up, then up-down about the level side axis of where the end faces now
    turnBy(link.bone, q.setFromAxisAngle(up, yaw))
    side.copy(facingOf(end, facing, fwd)).cross(up)
    if (side.lengthSq() > 1e-8) turnBy(link.bone, q.setFromAxisAngle(side.normalize(), pitch))
    // inside the joint's range, whatever the shares asked
    delta.copy(link.rest).invert().multiply(link.bone.quaternion)
    if (clampToLimits(link.name, delta)) {
      link.bone.quaternion.copy(link.rest).multiply(delta)
      link.bone.updateMatrixWorld(true)
    }
  }
  left = yawPitch(facingOf(end, facing, fwd), target, up)
  return Math.max(Math.abs(left.yaw), Math.abs(left.pitch)) / DEG
}

/** The links of a chain on a posed model, by the shares given (bones it lacks are skipped). */
export function aimLinks(find: (name: string) => Object3D | undefined, shares: Readonly<Record<string, { yaw: number; pitch: number }>>): (AimLink & { name: string })[] {
  return Object.entries(shares).flatMap(([name, s]) => {
    const bone = find(name)
    return bone ? [{ name, bone, rest: bone.quaternion.clone(), ...s }] : []
  })
}

/**
 * How much the off hand takes a two-handed grip (§9.6 fix-ups): the clip means two hands on the weapon when it brings
 * the off hand near the grip, so the IK pulls it on fully within `near` and lets go by `far` (metres, scaled by the
 * hero's height over 1.8 m). One-handed clips, whose off hand is away, are left alone.
 */
export function gripWeight(distance: number, height = 1.8, near = 0.12, far = 0.3): number {
  const k = height / 1.8
  const t = (distance - near * k) / ((far - near) * k)
  const s = Math.min(1, Math.max(0, t))
  return 1 - s * s * (3 - 2 * s)
}
