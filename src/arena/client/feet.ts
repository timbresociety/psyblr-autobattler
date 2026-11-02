import * as THREE from 'three'

/**
 * Feet that stay where they land (Forge goal, phase 2). A standing hero's feet are pinned to the ground: as a cast leans
 * the hips over them, a flinch rocks the body or the hips turn on the spot, the legs bend to keep each ankle where it
 * planted. A foot only steps, lifting in a short arc, once the pose pulls it further than `reach` metres away or the
 * hips have turned `turn` radians over it, and only one foot steps at a time. `step` is how long a step takes and
 * `blend` how long the pinning takes to come on as a hero stops, and to let go as it moves off.
 */
export const PLANT = { reach: 0.4, turn: (30 * Math.PI) / 180, step: 0.15, blend: 0.1 }

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const across = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z)
/** How high a step of `distance` metres lifts the foot at its middle. */
const lift = (distance: number) => Math.min(0.09, Math.max(0.03, distance * 0.35))

export interface Planter {
  /**
   * Where each foot goes this frame, given where the pose puts it (`wants`, world space) and which way the hips face
   * (`yaw`): pinned where it landed, partway through a step, or easing back to the pose once `on` goes false. Writes
   * `out` and returns true; false once the pose is left as it is.
   *
   * `down`, when the clip playing is tagged (GAME.md §12), says which feet its performer had on the floor this moment:
   * a foot that is down stays pinned where it came down, one that is up follows the clip (a kick's foot, a lunge's
   * step) and plants afresh where it lands, and no foot takes a step of its own.
   */
  place: (wants: readonly THREE.Vector3[], yaw: number, dt: number, on: boolean, out: THREE.Vector3[], down?: readonly boolean[]) => boolean
}

export function planter(count = 2): Planter {
  const anchors = Array.from({ length: count }, () => new THREE.Vector3())
  const froms = Array.from({ length: count }, () => new THREE.Vector3())
  const yaws: number[] = new Array(count).fill(0)
  // seconds into each foot's step, or -1 while it's pinned
  const steps: number[] = new Array(count).fill(-1)
  // a foot the clip lifted, to plant afresh where it next comes down
  const lifted: boolean[] = new Array(count).fill(false)
  let weight = 0
  let pinned = false
  return {
    place: (wants, yaw, dt, on, out, down) => {
      weight = on ? Math.min(1, weight + dt / PLANT.blend) : Math.max(0, weight - dt / PLANT.blend)
      if (!weight) {
        pinned = false
        return false
      }
      // a hero that jumps across the ground (a blink, a new body after a transformation) plants afresh where it lands
      if (pinned && wants.some((want, i) => steps[i] < 0 && across(anchors[i], want) > 3 * PLANT.reach)) pinned = false
      if (!pinned) {
        anchors.forEach((anchor, i) => anchor.copy(wants[i]))
        yaws.fill(yaw)
        steps.fill(-1)
        pinned = true
      }
      if (down) {
        wants.forEach((want, i) => {
          if (!down[i]) {
            lifted[i] = true
            steps[i] = -1
          } else if (lifted[i]) {
            anchors[i].copy(want)
            yaws[i] = yaw
            lifted[i] = false
          }
        })
      } else lifted.fill(false)
      // the foot pulled furthest from where the pose wants it steps first, one at a time
      if (on && !down && steps.every((s) => s < 0)) {
        let worst = -1
        let most = 0
        anchors.forEach((anchor, i) => {
          const off = across(anchor, wants[i])
          const turned = Math.abs(wrap(yaw - yaws[i]))
          const need = off > PLANT.reach || turned > PLANT.turn ? off / PLANT.reach + turned / PLANT.turn : 0
          if (need > most) {
            most = need
            worst = i
          }
        })
        if (worst >= 0) {
          froms[worst].copy(anchors[worst])
          steps[worst] = 0
        }
      }
      wants.forEach((want, i) => {
        if (steps[i] >= 0) {
          steps[i] += dt
          const s = Math.min(1, steps[i] / PLANT.step)
          const eased = s * s * (3 - 2 * s)
          const from = froms[i]
          out[i].set(from.x + (want.x - from.x) * eased, want.y + lift(across(from, want)) * Math.sin(Math.PI * s), from.z + (want.z - from.z) * eased)
          if (s >= 1) {
            anchors[i].copy(want)
            yaws[i] = yaw
            steps[i] = -1
          }
        } else if (lifted[i]) out[i].copy(want)
        else out[i].set(anchors[i].x, want.y, anchors[i].z)
        if (weight < 1) out[i].lerp(want, 1 - weight)
      })
      return true
    },
  }
}

/** Which way hips face (radians, 0 along +z), from where the two legs join them: the right one is on the hero's -x. */
export function hipYaw(left: THREE.Vector3, right: THREE.Vector3): number {
  return Math.atan2(right.z - left.z, left.x - right.x)
}

const hip = new THREE.Vector3()
const knee = new THREE.Vector3()
const ankle = new THREE.Vector3()
const goal = new THREE.Vector3()
const pole = new THREE.Vector3()
const bend = new THREE.Vector3()
const from = new THREE.Vector3()
const to = new THREE.Vector3()
const spin = new THREE.Quaternion()
const parentTurn = new THREE.Quaternion()
const boneTurn = new THREE.Quaternion()
const scratch = new THREE.Vector3()

/** Turn `bone` by `world` (a rotation in world space), from its current world matrices, and keep them current. */
export function turn(bone: THREE.Object3D, world: THREE.Quaternion) {
  bone.parent!.matrixWorld.decompose(scratch, parentTurn, scratch)
  bone.matrixWorld.decompose(scratch, boneTurn, scratch)
  bone.quaternion.copy(parentTurn.invert().multiply(world).multiply(boneTurn))
  bone.updateMatrixWorld(true)
}

/**
 * Two-bone IK for a leg: turn `upper` (the thigh) and `lower` (the shin) so the head of `end` (the ankle) lands on
 * `target`, or as near as the leg reaches. The knee keeps the side it bends to now, or bends toward `forward` from a
 * straight leg. World matrices must be current, and are kept current.
 */
export function legReach(upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, forward: THREE.Vector3): void {
  hip.setFromMatrixPosition(upper.matrixWorld)
  knee.setFromMatrixPosition(lower.matrixWorld)
  ankle.setFromMatrixPosition(end.matrixWorld)
  const a = hip.distanceTo(knee)
  const b = knee.distanceTo(ankle)
  goal.subVectors(target, hip)
  const d = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 1e-4, goal.length()))
  goal.normalize()
  // the knee's offset across the hip-to-target line, nudged forward so a straight leg still knows which way to bend
  pole.subVectors(knee, hip).addScaledVector(forward, 0.05 * a)
  pole.addScaledVector(goal, -pole.dot(goal)).normalize()
  const cos = (a * a + d * d - b * b) / (2 * a * d)
  bend.copy(hip).addScaledVector(goal, a * cos).addScaledVector(pole, a * Math.sqrt(Math.max(0, 1 - cos * cos)))
  turn(upper, spin.setFromUnitVectors(from.subVectors(knee, hip).normalize(), to.subVectors(bend, hip).normalize()))
  knee.setFromMatrixPosition(lower.matrixWorld)
  ankle.setFromMatrixPosition(end.matrixWorld)
  turn(lower, spin.setFromUnitVectors(from.subVectors(ankle, knee).normalize(), to.copy(hip).addScaledVector(goal, d).sub(knee).normalize()))
}
