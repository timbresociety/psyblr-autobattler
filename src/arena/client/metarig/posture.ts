import * as THREE from 'three'
import { postureTurns, type PhysiqueDials } from '../../../kit/body/physique.js'

/**
 * Posture and pelvis tilt (GAME.md §9.3) put on a body's rest pose: each bone tips forward (positive) or back about
 * the body's own left-right axis, at rest, without touching the bind, so the body stands that way and every clip,
 * which turns bones from rest (src/kit/rig/retarget.ts), plays on top. Call on a fresh clone, before anything reads
 * its rest pose.
 */
export function applyPosture(model: THREE.Object3D, physique: Partial<PhysiqueDials> | undefined): void {
  const turns = postureTurns(physique ?? {})
  const names = Object.keys(turns)
  if (!names.length) return
  model.updateWorldMatrix(true, true)
  // the body's left-right axis in the world: the armature's +x
  const hips = model.getObjectByName('Hips')
  const frame = hips?.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion()
  const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(frame)
  const parentTurn = new THREE.Quaternion()
  const tip = new THREE.Quaternion()
  // parents first, so a child's turn is taken in the frame its parent's turn left it
  const order = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Neck1', 'Head', 'LeftShoulder', 'RightShoulder']
  for (const name of order) {
    const deg = turns[name]
    const bone = model.getObjectByName(name)
    if (!deg || !bone?.parent) continue
    bone.parent.updateWorldMatrix(true, false)
    bone.parent.getWorldQuaternion(parentTurn)
    // a world turn about the axis, into the bone's local frame: parent⁻¹ · R · parent · local
    tip.setFromAxisAngle(axis, (deg * Math.PI) / 180)
    bone.quaternion.premultiply(parentTurn.clone().invert().multiply(tip).multiply(parentTurn))
    bone.updateWorldMatrix(false, true)
  }
}
