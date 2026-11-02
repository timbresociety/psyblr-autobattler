import * as THREE from 'three'
import type { HelperPlan } from '../../../kit/body/helpers.js'
import type { Skeleton } from '../../../kit/body/regions.js'
import { bodyDirection, IK_TARGETS, SOCKET_BONE, SOCKETS, type SocketName } from '../../../kit/rig/metarig.js'

/**
 * The metarig put on a loaded body (GAME.md §9.2): Root under the hips, the helpers from planHelpers on their parent
 * bones with the skin they took (helperSkin), the sockets a body didn't come with, and the IK targets. Works on one
 * hero's own clone, after its proportions moved the rest pose and before its clothes copy the body's skin.
 */

/** The sockets a body kit hangs (gear.ts hangSockets). */
const KIT_SOCKETS: ReadonlySet<SocketName> = new Set(['hand_r', 'hand_l', 'back'])

export interface HelperBone {
  plan: HelperPlan
  bone: THREE.Bone
  /** Its local position and scale at rest. */
  rest: THREE.Vector3
  /** The way it pushes out, in its parent's frame, one girth long (metres). */
  push: THREE.Vector3
}

export interface Metarig {
  root: THREE.Bone
  helpers: HelperBone[]
  /** A socket by name: the body kit's (hung by gear.ts) or one the metarig added (hips, muzzle, weapon tip). */
  socket: (name: SocketName) => THREE.Object3D | undefined
  ik: Record<(typeof IK_TARGETS)[number], THREE.Object3D>
  /** The body's skeleton at rest after the upgrade, in the mesh's own space (for measuring). */
  skeleton: Skeleton
}

/** Each bone's rest position in the mesh's own space, from its inverse bind. */
export function meshRest(mesh: THREE.SkinnedMesh): Skeleton {
  const rest: Record<string, [number, number, number]> = {}
  const p = new THREE.Vector3()
  const m = new THREE.Matrix4()
  mesh.skeleton.bones.forEach((bone, i) => {
    p.setFromMatrixPosition(m.copy(mesh.skeleton.boneInverses[i]).invert()).applyMatrix4(mesh.bindMatrixInverse)
    rest[bone.name] = [p.x, p.y, p.z]
  })
  return { bones: mesh.skeleton.bones.map((b) => b.name), rest }
}

/**
 * `model` is the hero's scene (sockets the body already hangs, from its kit, are found there); `plans` from
 * planHelpers on this hero's shaped, proportioned body. The caller puts helperSkin's weights on the geometry.
 */
export function upgradeRig(model: THREE.Object3D, mesh: THREE.SkinnedMesh, plans: readonly HelperPlan[]): Metarig {
  const skeleton = mesh.skeleton
  const bones = [...skeleton.bones]
  const inverses = skeleton.boneInverses.map((m) => m.clone())
  const byName = new Map<string, THREE.Bone>(bones.map((b) => [b.name, b]))
  const inverseOf = new Map<THREE.Object3D, THREE.Matrix4>(bones.map((b, i) => [b, inverses[i]]))
  const hips = byName.get('Hips')!
  // Root: on the floor under the hips, at the armature's origin, so every clip's hip positions hold as they are
  const root = new THREE.Bone()
  root.name = 'Root'
  const armature = hips.parent!
  armature.add(root)
  root.add(hips)
  // the armature's own frame at bind: the hips' bind with the hips' local transform taken off
  const hipsLocal = new THREE.Matrix4().compose(hips.position, hips.quaternion, hips.scale)
  const rootInverse = hipsLocal.clone().multiply(inverseOf.get(hips)!)
  bones.push(root)
  inverses.push(rootInverse)
  inverseOf.set(root, rootInverse)
  // the helpers, in plan order (their indices in the skin follow the body's own bones), each on its parent
  const toBind = mesh.bindMatrix
  const helpers: HelperBone[] = []
  const firstHelper = skeleton.bones.length
  const at = new THREE.Vector3()
  const parentRot = new THREE.Quaternion()
  plans.forEach((plan) => {
    const parent = byName.get(plan.bone.parent)!
    const parentInverse = inverseOf.get(parent)!
    const bone = new THREE.Bone()
    bone.name = plan.bone.name
    // its joint in the parent's frame at bind
    at.set(...plan.at).applyMatrix4(toBind).applyMatrix4(parentInverse)
    bone.position.copy(at)
    parent.add(bone)
    const inverse = new THREE.Matrix4().makeTranslation(-at.x, -at.y, -at.z).multiply(parentInverse)
    byName.set(bone.name, bone)
    inverseOf.set(bone, inverse)
    // the push direction (body frame at rest) into the parent's frame
    new THREE.Matrix4().copy(parentInverse).invert().decompose(new THREE.Vector3(), parentRot, new THREE.Vector3())
    const out = plan.bone.place ? bodyDirection(plan.bone.place.out, plan.bone.side) : [0, 0, 1]
    const push = new THREE.Vector3(...out)
    if (push.lengthSq() < 1e-6) push.set(0, 0, 0)
    else push.normalize().applyQuaternion(parentRot.clone().invert()).multiplyScalar(plan.girth)
    helpers.push({ plan, bone, rest: at.clone(), push })
  })
  // helper k must be bone firstHelper + k in the skin, so they go in right after the body's own; Root goes last
  const ordered = [...skeleton.bones, ...helpers.map((h) => h.bone), root]
  const orderedInverses = [...skeleton.boneInverses.map((m) => m.clone()), ...helpers.map((h) => inverseOf.get(h.bone)!), rootInverse]
  if (ordered.indexOf(helpers[0]?.bone) !== firstHelper && helpers.length) throw new Error('helper order')
  mesh.bind(new THREE.Skeleton(ordered, orderedInverses), mesh.bindMatrix)
  // the sockets a body kit doesn't bring, on their bones; the kit's own (hands, back) are hung with the gear
  for (const s of SOCKETS) {
    if (KIT_SOCKETS.has(s)) continue
    const o = new THREE.Object3D()
    o.name = `socket:${s}`
    byName.get(SOCKET_BONE[s])?.add(o)
  }
  const socket = (name: SocketName) => model.getObjectByName(`socket:${name}`)
  const ik = Object.fromEntries(
    IK_TARGETS.map((name) => {
      const o = new THREE.Object3D()
      o.name = name
      root.add(o)
      return [name, o]
    }),
  ) as Metarig['ik']
  return { root, helpers, socket, ik, skeleton: meshRest(mesh) }
}
