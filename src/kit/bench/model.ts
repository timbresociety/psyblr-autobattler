import * as THREE from 'three'
import { readBody, readNodes, type BodyFile } from '../body/node.js'

/**
 * A body file as a three.js skeleton in Node, for the physique bench (GAME.md §9.7): the same node tree, skinned mesh
 * and inverse binds GLTFLoader builds in the browser, without a renderer or the mesh's geometry. The game's own
 * proportions, posture, retargeting and fix-ups then run on it unchanged.
 */
export interface BenchModel {
  model: THREE.Group
  mesh: THREE.SkinnedMesh
  file: BodyFile
  /** The body's morph targets by name, for shapeBody. */
  morphNames: string[]
}

export async function benchModel(path: string | URL): Promise<BenchModel> {
  const [file, tree] = await Promise.all([readBody(path), readNodes(path)])
  const joints = new Set(tree.joints)
  const objects = tree.nodes.map((n, i) => {
    const o: THREE.Object3D = i === tree.mesh ? new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()) : joints.has(i) ? new THREE.Bone() : new THREE.Object3D()
    o.name = n.name
    o.position.fromArray(n.t)
    o.quaternion.fromArray(n.r)
    o.scale.fromArray(n.s)
    return o
  })
  const model = new THREE.Group()
  tree.nodes.forEach((n, i) => (n.parent >= 0 ? objects[n.parent] : model).add(objects[i]))
  model.updateMatrixWorld(true)
  const mesh = objects[tree.mesh] as THREE.SkinnedMesh
  const bones = tree.joints.map((j) => objects[j] as THREE.Bone)
  const inverses = bones.map((_, k) => new THREE.Matrix4().fromArray(tree.inverse, k * 16))
  mesh.bind(new THREE.Skeleton(bones, inverses), mesh.matrixWorld)
  return { model, mesh, file, morphNames: tree.morphNames }
}
