import * as THREE from 'three'
import type { BodyShape } from '../../../kit/body/shape.js'
import { buildCloth, clothState, FAR_RATE, RATE, restCloth, stepCloth, type ClothRig, type ClothState } from '../../../kit/physics/cloth.js'
import type { DressedItem } from '../../../kit/wear/dress.js'

/**
 * An outfit's loose cloth on the GPU. Each moving particle (src/kit/physics/cloth.ts) is a bone added to the outfit's
 * own copy of the body's skeleton, its world matrix set by hand each frame; the loose vertices are skinned to them, so
 * the cloth costs no more draws. A dressed model carries its rig: whatever draws the model settles it each frame once
 * the model stands where it's drawn.
 */

type V3 = [number, number, number]

interface ClothModel {
  model: THREE.Object3D
  outfit: THREE.SkinnedMesh
  /** The body's own bones and their inverses (the first part of the outfit's skeleton). */
  bones: THREE.Bone[]
  inverses: THREE.Matrix4[]
  rig: ClothRig
  state: ClothState
  pose: Float32Array
  particles: THREE.Bone[]
  /** The inverse of the outfit's bind matrix: a particle's skin matrix into its bone's world matrix. */
  unbind: THREE.Matrix4
}

const rigs = new WeakMap<THREE.Object3D, ClothModel>()
const m = new THREE.Matrix4()

/** Rig the outfit's loose parts, if any hang. `items` are the outfit's parts in the order its geometry merged them. */
export function rigCloth(model: THREE.Object3D, outfit: THREE.SkinnedMesh, items: readonly DressedItem[], body: BodyShape, rest: (bone: string) => V3 | undefined): boolean {
  const skeleton = outfit.skeleton
  const cloth = buildCloth({ items, body, bones: skeleton.bones.map((b) => b.name), rest })
  if (!cloth) return false
  outfit.geometry.setAttribute('skinIndex', new THREE.BufferAttribute(cloth.skinIndex, 4))
  outfit.geometry.setAttribute('skinWeight', new THREE.BufferAttribute(cloth.skinWeight, 4))
  const particles = Array.from({ length: cloth.rig.bones }, (_, i) => {
    const bone = new THREE.Bone()
    bone.name = `cloth_${i}`
    bone.matrixAutoUpdate = false
    bone.matrixWorldAutoUpdate = false
    return bone
  })
  outfit.bind(new THREE.Skeleton([...skeleton.bones, ...particles], [...skeleton.boneInverses, ...particles.map(() => new THREE.Matrix4())]), outfit.bindMatrix)
  rigs.set(model, {
    model,
    outfit,
    bones: skeleton.bones,
    inverses: skeleton.boneInverses,
    rig: cloth.rig,
    state: clothState(cloth.rig),
    pose: new Float32Array(skeleton.bones.length * 16),
    particles,
    unbind: outfit.bindMatrix.clone().invert(),
  })
  return true
}

/** Each body bone's skin matrix as it stands: the body's rest space to world. */
function readPose(c: ClothModel) {
  c.model.updateWorldMatrix(true, true)
  for (let i = 0; i < c.bones.length; i++) m.multiplyMatrices(c.bones[i].matrixWorld, c.inverses[i]).multiply(c.outfit.bindMatrix).toArray(c.pose, i * 16)
}

function apply(c: ClothModel) {
  for (let k = 0; k < c.particles.length; k++) c.particles[k].matrixWorld.fromArray(c.state.matrices, k * 16).multiply(c.unbind)
}

/** One frame of the model's cloth; `far` steps it at the far rate. True while it still swings. */
export function settleCloth(model: THREE.Object3D, dt: number, far = false): boolean {
  const c = rigs.get(model)
  if (!c) return false
  readPose(c)
  stepCloth(c.rig, c.state, c.pose, dt, far ? FAR_RATE : RATE)
  apply(c)
  return !c.state.sleeping
}

/** The model's cloth at rest where the body carries it: a bust, or a preview under reduced motion. */
export function restClothOn(model: THREE.Object3D): void {
  const c = rigs.get(model)
  if (!c) return
  readPose(c)
  restCloth(c.rig, c.state, c.pose)
  apply(c)
}
