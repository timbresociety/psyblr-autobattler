import * as THREE from 'three'

/**
 * A generated hero on our skeleton (docs/plans/2026-11-05-session-1-handoff.md, step 2). A clip is each bone's turn
 * from our rest in our bone's own frame, so a vendor's rig can't play it, whatever its bones are called: its frames and
 * its rest pose are its own, and its arms rest at a different angle on every mesh. The vendor's auto-rig only tells us
 * where the mesh's joints are and which skin follows which bone. Our bones go on those joints, each keeping our frame,
 * swung onto the mesh's limb; posed at our rest, the hero then stands as our body does, on its own bone lengths.
 */

const JOINT_PREFIX = /^mixamorig:?/

/** A vendor joint's name in our skeleton. */
export const ourBone = (name: string) => name.replace(JOINT_PREFIX, '')

/** The child a bone's swing lines up with, where it has several. */
const LEADS: Readonly<Record<string, string>> = { Hips: 'Spine', Spine2: 'Neck', LeftHand: 'LeftHandMiddle1', RightHand: 'RightHandMiddle1' }

export interface Rebuilt {
  /** Holds the bones, standing at our rest. */
  root: THREE.Group
  bones: Map<string, THREE.Bone>
  /** Each bone's world matrix on the mesh as it was bound: its inverse is the bone's in the skin. */
  bind: Map<string, THREE.Matrix4>
}

/**
 * Our bones on `joints` (bone name to where it sits on the mesh, metres, the hero on the floor). `reference` is our
 * skeleton at our rest. A bone the mesh has no joint for is left out; a joint must not hang off one.
 */
export function rebuildSkeleton(reference: THREE.Object3D, joints: ReadonlyMap<string, THREE.Vector3>): Rebuilt {
  reference.updateMatrixWorld(true)
  const order: THREE.Object3D[] = []
  reference.traverse((o) => joints.has(o.name) && !order.some((p) => p.name === o.name) && order.push(o))
  const at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3())
  const root = new THREE.Group()
  const bones = new Map<string, THREE.Bone>()
  const bind = new Map<string, THREE.Matrix4>()
  const turned = new Map<string, THREE.Quaternion>()
  const swings = new Map<string, THREE.Quaternion>()
  for (const o of order) {
    const parent = o.parent && joints.has(o.parent.name) ? o.parent.name : undefined
    if (!parent && bones.size) throw new Error(`${o.name}: its parent ${o.parent?.name} has no joint`)
    const lead = order.find((c) => c.name === LEADS[o.name]) ?? order.find((c) => c.parent === o)
    const here = joints.get(o.name)!
    const swing = lead
      ? new THREE.Quaternion().setFromUnitVectors(at(lead).sub(at(o)).normalize(), joints.get(lead.name)!.clone().sub(here).normalize())
      : (parent ? swings.get(parent)!.clone() : new THREE.Quaternion())
    swings.set(o.name, swing)
    const frame = swing.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion()))
    turned.set(o.name, frame)
    bind.set(o.name, new THREE.Matrix4().compose(here, frame, new THREE.Vector3(1, 1, 1)))
    const bone = new THREE.Bone()
    bone.name = o.name
    bone.quaternion.copy(o.quaternion)
    if (parent) {
      bone.position.copy(here).sub(joints.get(parent)!).applyQuaternion(turned.get(parent)!.clone().invert())
      bones.get(parent)!.add(bone)
    } else {
      bone.position.copy(here)
      root.add(bone)
    }
    bones.set(o.name, bone)
  }
  root.updateMatrixWorld(true)
  // our rest sets the legs at their own angle, so the soles come off the floor they were bound on: the hips make it up
  const soles = ['LeftFoot', 'RightFoot'].filter((n) => bones.has(n))
  const hips = bones.get(order[0].name)!
  if (soles.length) {
    const drift = soles.reduce((sum, n) => sum + joints.get(n)!.y - bones.get(n)!.getWorldPosition(new THREE.Vector3()).y, 0) / soles.length
    hips.position.y += drift
    root.updateMatrixWorld(true)
  }
  return { root, bones, bind }
}

/** The mesh's height and floor in its file's units, and the scale that stands it `height` metres tall. */
export function standing(box: { min: { y: number }; max: { y: number } }, height: number) {
  return { floor: box.min.y, scale: height / (box.max.y - box.min.y) }
}

/** Joints in the file's units to metres on the floor. */
export const onFloor = (p: THREE.Vector3, { floor, scale }: ReturnType<typeof standing>) => new THREE.Vector3(p.x, p.y - floor, p.z).multiplyScalar(scale)

/** `mesh`, rigged by the vendor, skinned to `rebuilt`: same weights, our bones. */
export function rebindMesh(mesh: THREE.SkinnedMesh, rebuilt: Rebuilt, fit: ReturnType<typeof standing>): THREE.SkinnedMesh {
  const geometry = mesh.geometry.clone()
  geometry.applyMatrix4(mesh.matrixWorld)
  geometry.translate(0, -fit.floor, 0)
  geometry.scale(fit.scale, fit.scale, fit.scale)
  const names = mesh.skeleton.bones.map((b) => ourBone(b.name))
  const skeleton = new THREE.Skeleton(
    names.map((n) => rebuilt.bones.get(n)!),
    names.map((n) => rebuilt.bind.get(n)!.clone().invert()),
  )
  const out = new THREE.SkinnedMesh(geometry, mesh.material)
  out.frustumCulled = false
  rebuilt.root.add(out)
  out.bind(skeleton, new THREE.Matrix4())
  return out
}
