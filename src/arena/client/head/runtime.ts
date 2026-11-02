import * as THREE from 'three'
import { blinkState, clampTurn, stepBlink, type ArkitShape } from '../../../kit/head/head.js'
import { EYE_LIMIT } from '../../../kit/rig/limits.js'
import type { HeadRig } from './build.js'

/**
 * The head each frame, after the clip has posed the body (GAME.md §9.1): the face shapes at their weights, blinks on
 * the hero's own beat, the eyes turned as the clip's eye bones and the look shapes say (never past EYE_LIMIT), the
 * jaw opened as far as jawOpen drops the chin, the tongue out with tongueOut. Far away the face holds still.
 */
export interface HeadRuntime {
  update(dt: number, frame?: { detail?: 'near' | 'mid' | 'far' }): void
  /** An expression or viseme shape's weight (0 to 1); held until set again. */
  set(shape: ArkitShape, weight: number): void
  readonly state: { blink: number; eyeTurn: number; clamped: number }
}

/** How far the look shapes turn an eye at full weight, degrees: out and in, then up and down. */
const LOOK_YAW = 28
const LOOK_PITCH = 22

export function headRuntime(rig: HeadRig, seed = 1): HeadRuntime {
  const weights = new Map<ArkitShape, number>()
  const blink = blinkState(seed)
  const state = { blink: 0, eyeTurn: 0, clamped: 0 }
  const q = new THREE.Quaternion()
  const look = new THREE.Quaternion()
  const inv = new THREE.Quaternion()
  const euler = new THREE.Euler(0, 0, 0, 'YXZ')
  const w = (s: ArkitShape) => weights.get(s) ?? 0
  const influences = rig.mesh.morphTargetInfluences!
  return {
    state,
    set(shape, weight) {
      weights.set(shape, Math.min(1, Math.max(0, weight)))
    },
    update(dt, frame = {}) {
      if (frame.detail === 'far') return
      const shut = stepBlink(blink, dt)
      state.blink = shut
      rig.shapes.forEach((s, k) => {
        const own = w(s)
        influences[k] = s === 'eyeBlinkLeft' || s === 'eyeBlinkRight' ? Math.max(own, shut) : own
      })
      state.clamped = 0
      state.eyeTurn = 0
      for (const eye of rig.eyes) {
        // the eye bone's turn from rest, in the head's frame, where the eyes follow their bones; the library's eye
        // tracks swing far past any real eye (up to 100° from rest), so by default the look shapes alone turn them
        q.identity()
        if (eye.bone && rig.followEyeBones) q.copy(eye.bone.quaternion).multiply(look.copy(eye.boneRest).invert())
        // the look shapes, about the body's own axes (the pivot's at rest), brought into the head's frame
        const L = eye.side === 'left' ? 'Left' : 'Right'
        const out = eye.side === 'left' ? 1 : -1
        const yaw = (w(`eyeLookOut${L}` as ArkitShape) - w(`eyeLookIn${L}` as ArkitShape)) * LOOK_YAW * out
        const pitch = (w(`eyeLookDown${L}` as ArkitShape) - w(`eyeLookUp${L}` as ArkitShape)) * LOOK_PITCH
        if (yaw || pitch) {
          look.setFromEuler(euler.set((pitch * Math.PI) / 180, (yaw * Math.PI) / 180, 0))
          q.multiply(look.premultiply(eye.pivotRest).multiply(inv.copy(eye.pivotRest).invert()))
        }
        if (clampTurn(q, EYE_LIMIT)) state.clamped++
        state.eyeTurn = Math.max(state.eyeTurn, (2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180) / Math.PI)
        eye.pivot.quaternion.copy(q).multiply(eye.pivotRest)
      }
      if (rig.jaw) {
        const j = rig.jaw
        const open = w('jawOpen')
        j.bone.quaternion.setFromAxisAngle(j.axis, (j.openDeg * open * Math.PI) / 180).multiply(j.rest)
        for (const c of j.carried) c.mesh.position.copy(c.rest).addScaledVector(j.shift, open)
      }
      if (rig.tongue && !rig.jaw) rig.tongue.mesh.position.copy(rig.tongue.rest)
      if (rig.tongue) rig.tongue.mesh.position.addScaledVector(rig.tongue.out, w('tongueOut'))
    },
  }
}
