import * as THREE from 'three'
import { weldedNormals } from '../../../kit/body/surface.js'
import type { BodyShape } from '../../../kit/body/shape.js'
import { PROPORTIONS, proportionFactors, type Proportions, type StructureBones } from '../../../kit/body/proportions.js'

/**
 * A hero's proportions put on its body (src/kit/body/proportions.ts): each limb, the torso and the neck lengthened or
 * shortened along its bones, the shoulders set wider or narrower and the head scaled, all at rest. The skeleton's rest
 * moves, the shaped surface is re-skinned to it, and the bind is taken again, so clothes bound to the surface, gear in
 * its sockets and every clip (which turns bones and never moves them, but for the hips) play on the new frame. Legs
 * that grow lift the whole rig, so the feet stay on the floor while the clips keep the hips where the file had them.
 * Returns the shape with its positions and normals moved; untouched when the proportions are all neutral.
 */
export function proportion(mesh: THREE.SkinnedMesh, shape: BodyShape, proportions: (Partial<Proportions> & StructureBones) | undefined): BodyShape {
  const factor = proportionFactors(proportions)
  if (!factor) return shape
  const skeleton = mesh.skeleton
  const bones = skeleton.bones
  const index = new Map(bones.map((b, i) => [b as THREE.Object3D, i]))
  const before = skeleton.boneInverses.map((inv) => inv.clone().invert())
  const after: THREE.Matrix4[] = []
  const t = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  // parents come before their children in a glTF skin's joint order only by convention, so walk down from the roots
  const order: number[] = []
  const seen = new Set<number>()
  const visit = (i: number) => {
    if (seen.has(i)) return
    const p = index.get(bones[i].parent!)
    if (p !== undefined) visit(p)
    seen.add(i)
    order.push(i)
  }
  bones.forEach((_, i) => visit(i))
  for (const i of order) {
    const p = index.get(bones[i].parent!)
    const local = p === undefined ? before[i].clone() : before[p].clone().invert().multiply(before[i])
    local.decompose(t, q, s)
    // a bone sits as far from its parent as the parent's segment is long
    const along = p === undefined ? 1 : factor.length(bones[p].name, bones[i].name)
    const scale = factor.scale(bones[i].name)
    t.multiplyScalar(along)
    s.multiplyScalar(scale)
    local.compose(t, q, s)
    after[i] = p === undefined ? local : after[p].clone().multiply(local)
    if (along !== 1) bones[i].position.multiplyScalar(along)
    if (scale !== 1) bones[i].scale.multiplyScalar(scale)
  }
  const moved = after.map((a, i) => a.clone().multiply(skeleton.boneInverses[i]))
  // each vertex follows its bones from the old rest to the new, in bind space
  const bind = mesh.bindMatrix
  const unbind = mesh.bindMatrixInverse
  const positions = Float32Array.from(shape.positions)
  const v = new THREE.Vector3()
  const sum = new THREE.Vector3()
  const one = new THREE.Vector3()
  for (let k = 0; k < positions.length / 3; k++) {
    v.fromArray(positions, k * 3).applyMatrix4(bind)
    sum.set(0, 0, 0)
    for (let j = 0; j < 4; j++) {
      const w = shape.weights[k * 4 + j]
      if (!w) continue
      sum.addScaledVector(one.copy(v).applyMatrix4(moved[shape.joints[k * 4 + j]]), w)
    }
    sum.applyMatrix4(unbind).toArray(positions, k * 3)
  }
  skeleton.boneInverses = after.map((a) => a.clone().invert())
  // longer legs would sink the feet: the rig rises by what the lowest foot dropped
  const feet = ['LeftFoot', 'RightFoot'].map((name) => bones.findIndex((b) => b.name === name)).filter((i) => i >= 0)
  const drop = feet.length ? Math.max(...feet.map((i) => new THREE.Vector3().setFromMatrixPosition(before[i]).y - new THREE.Vector3().setFromMatrixPosition(after[i]).y)) : 0
  const hips = bones.find((b) => b.name === PROPORTIONS.hips)
  const rig = hips?.parent
  // the bind is in the file's own units, the rig's parent's space
  if (rig && drop) rig.position.y += drop
  return { ...shape, positions, normals: weldedNormals(shape.surface, positions) }
}
