import * as THREE from 'three'
import { ATTITUDE, type AttitudeId } from '../../../kit/anim/attitude.js'

/** World axes in the body's frame: its left-right (tips forward and back) and its front (arms out to the sides). */
const SIDE = new THREE.Vector3(1, 0, 0)
const FRONT = new THREE.Vector3(0, 0, 1)

/**
 * Turn `bone` by `deg` about `axis` (the armature's frame), taken in the frame its parent's turns left it. Returns the
 * turn in the bone's local terms, the one put in front of its rotation.
 */
function turn(model: THREE.Object3D, name: string, axis: THREE.Vector3, deg: number, frame: THREE.Quaternion) {
  const bone = model.getObjectByName(name)
  if (!deg || !bone?.parent) return undefined
  bone.parent.updateWorldMatrix(true, false)
  const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion())
  const r = new THREE.Quaternion().setFromAxisAngle(axis.clone().applyQuaternion(frame), (deg * Math.PI) / 180)
  const local = parent.clone().invert().multiply(r).multiply(parent)
  bone.quaternion.premultiply(local)
  bone.updateWorldMatrix(false, true)
  return local
}

/**
 * An attitude put on a body's rest pose (kit/anim/attitude.ts), after its physique's posture and before anything reads
 * the rest: the tips, the arms out, and the knees bent with the feet level. Bent knees lift the feet, by more the more
 * a clip already bends them (a landing's crouch), so every turn is kept (`userData.attitudeTurns`, each bone's local
 * turn): clips fitted to this body are put back on the floor frame by frame (anim-library groundClip), and the moves
 * down at the floor play without the turns (anim-library restPose's plain rest).
 */
export function applyAttitude(model: THREE.Object3D, id: AttitudeId | undefined): void {
  const a = ATTITUDE[id ?? 'neutral']
  if (!a || id === 'neutral' || !id) return
  model.updateWorldMatrix(true, true)
  const hips = model.getObjectByName('Hips')
  const frame = hips?.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion()
  // parents first, so each turn is taken in the frame its parent's left it
  const turns: Record<string, number[]> = {}
  const keep = (name: string, axis: THREE.Vector3, deg: number) => {
    const local = turn(model, name, axis, deg, frame)
    if (local) turns[name] = local.toArray()
  }
  for (const name of ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Neck1', 'Head']) keep(name, SIDE, a.tips[name] ?? 0)
  keep('LeftArm', FRONT, a.arms)
  keep('RightArm', FRONT, -a.arms)
  for (const side of ['Left', 'Right']) {
    // the knee comes forward over the toes: the thigh tips by half the bend, the shin back by all of it, the foot level
    keep(`${side}UpLeg`, SIDE, -a.knees / 2)
    keep(`${side}Leg`, SIDE, a.knees)
    keep(`${side}Foot`, SIDE, -a.knees / 2)
  }
  if (Object.keys(turns).length) model.userData.attitudeTurns = turns
}
