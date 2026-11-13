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

const joint = new THREE.Vector3()
const reach = new THREE.Vector3()
const raised = new THREE.Vector3()
const level = new THREE.Quaternion()

/**
 * Lift a foot's toes back out of the floor (clip audit 2026-11-05, fault 2): a body whose feet are longer than the
 * clip's performer's pushes its toes under the floor whenever the heel comes up. The foot turns about the ankle, toes
 * up, until the lower of its joints `toes` (the ball, the tip) stands no lower than it does at rest: `rest`, each
 * one's height then, in `ground`'s units over its origin (the floor). World matrices must be current, and are kept
 * current. True when it turned the foot.
 */
export function levelToes(foot: THREE.Object3D, toes: readonly THREE.Object3D[], rest: readonly number[], ground: THREE.Object3D): boolean {
  ankle.setFromMatrixPosition(foot.matrixWorld)
  ground.worldToLocal(ankle)
  let worst = -1
  let under = 0.002
  toes.forEach((toe, k) => {
    const y = ground.worldToLocal(joint.setFromMatrixPosition(toe.matrixWorld)).y
    if (rest[k] - y > under) ((under = rest[k] - y), (worst = k))
  })
  if (worst < 0) return false
  // the ankle-to-toe line, raised by what that joint is under and swung up round the ankle at its own length
  ground.worldToLocal(reach.setFromMatrixPosition(toes[worst].matrixWorld)).sub(ankle)
  const length = reach.length()
  const y = Math.min(reach.y + under, length * 0.95)
  const flat = Math.hypot(reach.x, reach.z)
  if (flat < 1e-4) return false
  raised.set((reach.x / flat) * Math.sqrt(length * length - y * y), y, (reach.z / flat) * Math.sqrt(length * length - y * y))
  // a turn in the ground's frame, carried into the world's
  ground.getWorldQuaternion(parentTurn)
  level.setFromUnitVectors(reach.normalize(), raised.normalize())
  level.premultiply(parentTurn).multiply(boneTurn.copy(parentTurn).invert())
  turn(foot, level)
  return true
}

/**
 * How far a body's torso reaches in front of its hips and behind them at rest, in the units of the hips' parent (the
 * hips track's), the body facing +z: the skin bound mostly to the back's bones, from the hips up to the neck, in the
 * bind pose (the arms hang beside it). A deep chest, a belly or a pack goes under the floor where a slim body lies on
 * it (clip audit 2026-11-05, fault 3). `head`: how far the skin on `head` and below it (hair, horns, a snout) reaches
 * from its joint in front, behind and on top, what a body lying on its face, on its back or rolled over its head lies on.
 */
export function torsoDepth(model: THREE.Object3D, hips: THREE.Object3D, neck: THREE.Object3D, head?: THREE.Object3D): { front: number; back: number; head: HeadReach } | undefined {
  const frame = hips.parent
  if (!frame) return undefined
  model.updateMatrixWorld(true)
  const into = new THREE.Matrix4()
  const point = new THREE.Vector3()
  const low = new THREE.Vector3()
  const high = new THREE.Vector3()
  const crown = new THREE.Vector3()
  let front = -Infinity
  let back = -Infinity
  const reach: HeadReach = { front: 0, back: 0, top: 0 }
  model.traverse((o) => {
    const skin = o as THREE.SkinnedMesh
    if (!skin.isSkinnedMesh) return
    const bones = skin.skeleton.bones
    const [h, n] = [bones.indexOf(hips as THREE.Bone), bones.indexOf(neck as THREE.Bone)]
    const position = skin.geometry.getAttribute('position')
    const joints = skin.geometry.getAttribute('skinIndex')
    const weights = skin.geometry.getAttribute('skinWeight')
    if (h < 0 || n < 0 || !position || !joints || !weights) return
    // the back: the hips and every bone between them and the neck
    const spine = new Set<number>()
    for (let b: THREE.Object3D | null = neck.parent; b && b !== frame; b = b.parent) if (bones.includes(b as THREE.Bone)) spine.add(bones.indexOf(b as THREE.Bone))
    // the head: its bone and everything hung from it
    const top = new Set<number>()
    head?.traverse((b) => bones.includes(b as THREE.Bone) && top.add(bones.indexOf(b as THREE.Bone)))
    into.copy(frame.matrixWorld).invert().multiply(skin.matrixWorld).multiply(skin.bindMatrix)
    const at = (k: number, out: THREE.Vector3) => out.setFromMatrixPosition(new THREE.Matrix4().copy(skin.skeleton.boneInverses[k]).invert()).applyMatrix4(into)
    at(h, low)
    at(n, high)
    if (head && top.size) at(bones.indexOf(head as THREE.Bone), crown)
    for (let i = 0; i < position.count; i++) {
      let share = 0
      let onHead = 0
      for (let k = 0; k < 4; k++) {
        const j = joints.getComponent(i, k)
        if (spine.has(j)) share += weights.getComponent(i, k)
        if (top.has(j)) onHead += weights.getComponent(i, k)
      }
      if (share < 0.5 && onHead < 0.5) continue
      point.fromBufferAttribute(position, i).applyMatrix4(into)
      if (onHead >= 0.5) {
        reach.front = Math.max(reach.front, point.z - crown.z)
        reach.back = Math.max(reach.back, crown.z - point.z)
        reach.top = Math.max(reach.top, point.y - crown.y)
        continue
      }
      if (point.y < low.y || point.y > high.y) continue
      front = Math.max(front, point.z - low.z)
      back = Math.max(back, low.z - point.z)
    }
  })
  return front > -Infinity ? { front, back, head: reach } : undefined
}

/** A head's reach from its joint at rest: in front (+z), behind and above. */
export type HeadReach = { front: number; back: number; top: number }

/**
 * How high each of `joints` stands over the soles at rest, in `ground`'s units: its height in the bind pose over the
 * lowest point of any skin bound to it (the body, or the shoes it wears). An attitude's bent rest lifts the skin and
 * the joints alike. Undefined when nothing is skinned to them.
 */
export function soleHeights(model: THREE.Object3D, joints: readonly THREE.Object3D[], ground: THREE.Object3D): number[] | undefined {
  const skins: THREE.SkinnedMesh[] = []
  model.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh
    if (mesh.isSkinnedMesh && joints.every((j) => mesh.skeleton.bones.includes(j as THREE.Bone))) skins.push(mesh)
  })
  if (!skins.length) return undefined
  model.updateMatrixWorld(true)
  ground.updateMatrixWorld(true)
  const into = new THREE.Matrix4()
  const point = new THREE.Vector3()
  let floor = Infinity
  for (const skin of skins) {
    // bind space into the ground's frame: the skin's bind matrix, its place in the world, the ground's frame
    into.copy(ground.matrixWorld).invert().multiply(skin.matrixWorld).multiply(skin.bindMatrix)
    const position = skin.geometry.getAttribute('position')
    for (let i = 0; i < position.count; i++) floor = Math.min(floor, point.fromBufferAttribute(position, i).applyMatrix4(into).y)
  }
  const skin = skins[0]
  into.copy(ground.matrixWorld).invert().multiply(skin.matrixWorld).multiply(skin.bindMatrix)
  return joints.map((j) => {
    const bind = new THREE.Matrix4().copy(skin.skeleton.boneInverses[skin.skeleton.bones.indexOf(j as THREE.Bone)]).invert()
    return Math.max(0, point.setFromMatrixPosition(bind).applyMatrix4(into).y - floor)
  })
}
