import * as THREE from 'three'
import type { Gender } from '../../../charter/look.js'
import { helperGain, jiggleOf, type PhysiqueDials } from '../../../kit/body/physique.js'
import { drive, helperPose, type HelperPose } from '../../../kit/rig/drivers.js'
import { jiggleParams, jiggleState, stepJiggle, stepRing, type JiggleParams, type JiggleState, type Vec3 } from '../../../kit/rig/jiggle.js'
import { bodyDirection, type JiggleRegion, type MuscleRegion } from '../../../kit/rig/metarig.js'
import type { HelperBone, Metarig } from './upgrade.js'

/**
 * The metarig each frame, after the clip and the procedural layers have posed the body (GAME.md §9.2, §9.4): every
 * muscle helper swells as its joint turns, by its region's gain; every corrective pushes the skin out at a bent joint;
 * every jiggle bone springs after the motion, with landings and big hits kicking it, and the muscles ring briefly. All
 * client-only and cosmetic. At the mid level of detail the jiggle stops; far away everything rests.
 */

export type Detail = 'near' | 'mid' | 'far'

export interface MetarigFrame {
  detail?: Detail
  /** A landing's or a big hit's impact this frame, world metres a second, pointing the way the body was moving. */
  kick?: THREE.Vector3
}

export interface MetarigRuntime {
  update(dt: number, frame?: MetarigFrame): void
  /** For probes and the bench: each helper's drive and each jiggle bone's offset last frame. */
  readonly state: { drives: Map<string, number>; jiggle: Map<string, number>; ring: number }
}

interface Driven {
  h: HelperBone
  joint: THREE.Object3D
  restInverse: THREE.Quaternion
  gain: number
}

interface Jiggling {
  h: HelperBone
  params: JiggleParams
  state: JiggleState
  /** The tip, in the bone's own frame: a radius out the way the flesh faces. */
  tip: THREE.Vector3
  length: number
}

export function metarigRuntime(rig: Metarig, scene: THREE.Object3D, physique: Partial<PhysiqueDials>, gender: Gender): MetarigRuntime {
  const preset = jiggleOf(physique)
  const fat = physique.weight ?? 0.5
  const driven: Driven[] = []
  const jiggling: Jiggling[] = []
  const parentRot = new THREE.Quaternion()
  for (const h of rig.helpers) {
    const b = h.plan.bone
    if (b.kind === 'jiggle') {
      const params = jiggleParams(preset, b.dial as JiggleRegion, fat, { male: gender === 'm', child: physique.child })
      // the way the flesh faces, from the body frame into the bone's (its rest frame is its parent's)
      h.bone.parent!.updateWorldMatrix(true, false)
      h.bone.parent!.getWorldQuaternion(parentRot)
      const root = rig.root.parent!.getWorldQuaternion(new THREE.Quaternion())
      const facing = new THREE.Vector3(...bodyDirection(b.region!.facing ?? [1, 0, 0], b.side)).normalize()
      const tip = facing.applyQuaternion(root).applyQuaternion(parentRot.clone().invert()).multiplyScalar(h.plan.girth)
      jiggling.push({ h, params, state: jiggleState(), tip, length: h.plan.girth })
      continue
    }
    const joint = scene.getObjectByName(b.driver!.joint)
    if (!joint) continue
    const gain = b.kind === 'muscle' ? helperGain(physique, b.dial as MuscleRegion) : 1
    driven.push({ h, joint, restInverse: joint.quaternion.clone().invert(), gain })
  }
  const pose: HelperPose = { out: 0, swell: 0 }
  const delta = new THREE.Quaternion()
  const ring = { x: 0, v: 0 }
  const state = { drives: new Map<string, number>(), jiggle: new Map<string, number>(), ring: 0 }
  const kickArr: Vec3 = [0, 0, 0]
  const tipW = new THREE.Vector3()
  const jointW = new THREE.Vector3()
  const want = new THREE.Vector3()
  const swing = new THREE.Quaternion()
  const off: Vec3 = [0, 0, 0]
  let resting = false
  const rest = () => {
    if (resting) return
    for (const h of rig.helpers) {
      h.bone.position.copy(h.rest)
      h.bone.scale.setScalar(1)
      h.bone.quaternion.identity()
    }
    for (const j of jiggling) j.state.ready = false
    resting = true
  }
  return {
    state,
    update(dt, frame = {}) {
      const detail = frame.detail ?? 'near'
      if (detail === 'far' || dt <= 0) return rest()
      resting = false
      const kick = frame.kick && frame.kick.lengthSq() > 0 ? frame.kick : undefined
      const r = stepRing(ring, dt, kick ? kick.length() : 0)
      state.ring = r
      for (const d of driven) {
        const b = d.h.plan.bone
        const k = drive(b.driver!, delta.copy(d.restInverse).multiply(d.joint.quaternion))
        state.drives.set(b.name, k)
        helperPose(b, k, d.gain, pose)
        d.h.bone.position.copy(d.h.rest).addScaledVector(d.h.push, pose.out)
        // a muscled body's muscles ring a little on an impact, as much as they are muscled
        d.h.bone.scale.setScalar(1 + pose.swell + (b.kind === 'muscle' ? r * d.gain : 0))
      }
      if (detail !== 'near') {
        for (const j of jiggling) (j.h.bone.quaternion.identity(), (j.state.ready = false))
        return
      }
      for (const j of jiggling) {
        const bone = j.h.bone
        bone.quaternion.identity()
        bone.updateWorldMatrix(true, false)
        tipW.copy(j.tip).applyMatrix4(bone.matrixWorld)
        jointW.setFromMatrixPosition(bone.matrixWorld)
        if (kick) kick.toArray(kickArr)
        const o = stepJiggle(j.state, j.params, tipW.toArray() as Vec3, j.length * bone.matrixWorld.getMaxScaleOnAxis(), dt, kick ? kickArr : undefined, off)
        state.jiggle.set(bone.name, Math.hypot(o[0], o[1], o[2]))
        if (!o[0] && !o[1] && !o[2]) continue
        // turn the bone so its tip points at the mass, in its parent's frame
        want.set(tipW.x + o[0] - jointW.x, tipW.y + o[1] - jointW.y, tipW.z + o[2] - jointW.z).normalize()
        tipW.sub(jointW).normalize()
        swing.setFromUnitVectors(tipW, want)
        bone.parent!.getWorldQuaternion(parentRot)
        bone.quaternion.copy(parentRot).invert().multiply(swing).multiply(parentRot)
      }
    },
  }
}
