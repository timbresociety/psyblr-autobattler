import * as THREE from 'three'
import type { GearPiece, GearSlot } from '../../charter/look.js'
import { bodyBase, shapeBody, type BodyBase, type BodyShape } from '../../kit/body/shape.js'
import { proportion } from './proportions.js'
import { splitValues } from '../../kit/body/surface.js'
import { bodyKitLoaded } from './body-kit.js'
import { characterMap, characterNormalMap, metaChannel, type CharacterLook } from './character-look.js'
import { faceShape } from './face/shape.js'
import { hangPieces, shapedSockets, type Piece } from './gear.js'
import type { LoadedKit } from './held.js'
import { refineGeometry } from '../../kit/body/refine.js'
import { helperSkin, planHelpers } from '../../kit/body/helpers.js'
import { bodySpread } from '../../kit/body/spread.js'
import { meshRest, upgradeRig, type Metarig } from './metarig/upgrade.js'
import { applyPosture } from './metarig/posture.js'
import { buildHead, type HeadRig } from './head/build.js'

/**
 * Building a cloned body for one hero: its physique and face baked into its own copy of the body's positions, its
 * metarig and head put on, and the weapons it holds hung on its hand sockets. Heroes are drawn bare (owner,
 * 2026-11-04): what a hero wears will come with its own generated mesh. The arena passes a node material for the
 * body, the previews and busts a classic one.
 */

/** The body's material, from its atlas (the hero's own when it has a photo face) and relief. */
export type BodyMaterial = (map: THREE.Texture | null, normalMap: THREE.Texture | null) => THREE.Material

/**
 * A built model's metarig and head, kept beside the model rather than in its userData: a clone (an afterimage)
 * copies userData through JSON, which would serialise the head's meshes and textures, images and all, every time.
 */
const RIGS = new WeakMap<THREE.Object3D, { metarig?: Metarig; head?: HeadRig }>()
export function rigsOf(model: THREE.Object3D): { metarig?: Metarig; head?: HeadRig } {
  let rigs = RIGS.get(model)
  if (!rigs) RIGS.set(model, (rigs = {}))
  return rigs
}

interface BodyCache {
  base: BodyBase
  morphs: string[]
  /** Each bone where it stands in the rest pose, in the mesh's own space. */
  rest: Map<string, [number, number, number]>
}

const bodies = new WeakMap<THREE.BufferGeometry, BodyCache>()

const read = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number) => {
  const out = new Float32Array(attr.count * size)
  for (let i = 0; i < attr.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = attr.getComponent(i, k)
  return out
}

/** True for a body on the shared surface (every body file now); a demo hero's own model has no welded ids. */
export function onSharedSurface(mesh: THREE.SkinnedMesh): boolean {
  return !!mesh.geometry.getAttribute('_vid')
}


/** A body file's welded base, fields and morph names: worked out once per file and shared by every hero on it. */
function bodyCache(mesh: THREE.SkinnedMesh): BodyCache {
  const g = mesh.geometry
  let cache = bodies.get(g)
  if (!cache) {
    const morphs = mesh.morphTargetDictionary ? Object.entries(mesh.morphTargetDictionary).sort((a, b) => a[1] - b[1]).map(([name]) => name) : []
    const base = bodyBase({
      vid: read(g.getAttribute('_vid'), 1),
      index: g.getIndex()!.array,
      positions: read(g.getAttribute('position'), 3),
      morphs: (g.morphAttributes.position ?? []).map((a) => read(a, 3)),
      joints: read(g.getAttribute('skinIndex'), 4),
      weights: read(g.getAttribute('skinWeight'), 4),
    })
    // each bone where it stands in the rest pose, in the mesh's own space
    const toMesh = mesh.bindMatrixInverse
    const rest = new Map<string, [number, number, number]>()
    mesh.skeleton.bones.forEach((bone, i) => {
      const p = new THREE.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[i].clone().invert()).applyMatrix4(toMesh)
      rest.set(bone.name, [p.x, p.y, p.z])
    })
    cache = { base, morphs, rest }
    bodies.set(g, cache)
  }
  return cache
}

function bodyMesh(model: THREE.Object3D): THREE.SkinnedMesh | undefined {
  let found: THREE.SkinnedMesh | undefined
  model.traverse((o) => {
    if (!found && (o as THREE.SkinnedMesh).isSkinnedMesh) found = o as THREE.SkinnedMesh
  })
  return found
}

/** The body's own geometry for this hero: its shape and its colours (skin and eye whites), without the file's eyeballs. */
function bodyGeometry(source: THREE.BufferGeometry, cache: BodyCache, shape: BodyShape, look: CharacterLook): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  const { surface } = cache.base
  geo.setAttribute('position', new THREE.BufferAttribute(splitValues(surface, shape.positions, 3), 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(splitValues(surface, shape.normals, 3), 3))
  for (const name of ['uv', 'uv1']) {
    const a = source.getAttribute(name)
    if (a) geo.setAttribute(name, a)
  }
  // the skin as the shape has it: the file's, with the metarig's helpers taking their shares (helpers.ts)
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(splitValues(surface, shape.joints, 4)), 4))
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(splitValues(surface, shape.weights, 4), 4))
  const meta = source.getAttribute(metaChannel(source))
  const n = meta.count
  const colors = new Float32Array(n * 3)
  // with a photo face the skin colour is baked into the hero's own atlas, so the skin stays untinted here
  const skin = look.face ? new THREE.Color(1, 1, 1) : look.colors.skin
  const eye = look.colors.eye
  const iris = look.colors.iris
  // 1 where it is skin, for the classic material's skin shading (character-look.ts), 0 on the eyes. Region 9 is an
  // iris (bake.REGIONS), which the Psyblr Human bodies carry as their own faces and the first bodies never did
  const isSkin = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const region = Math.floor(meta.getX(i))
    isSkin[i] = region === 0 ? 1 : 0
    const c = isSkin[i] ? skin : region === 9 ? iris : eye
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('_skin', new THREE.BufferAttribute(isSkin, 1))
  const index = source.getIndex()!.array
  // the file's eyeballs are left out: the head brings real ones (head/build.ts), turning in the sockets behind the lids
  const kept: number[] = []
  for (let t = 0; t < index.length; t += 3) {
    const v = [index[t], index[t + 1], index[t + 2]]
    if (v.every((i) => isSkin[i])) kept.push(...v)
  }
  geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(kept), 1))
  geo.computeBoundingSphere()
  return geo
}

/**
 * Hang each held piece on its hand's socket, its colour tinting the piece's 'primary' material. The sockets move with
 * the hero's shape (`shaped`, from the built body's `rest` positions), so a grip sits in the hand the hero has.
 */
function hangHeld(model: THREE.Object3D, held: Partial<Record<GearSlot, GearPiece>>, kit: LoadedKit, rest: ArrayLike<number>, shaped: ArrayLike<number>): THREE.Object3D[] {
  if (!kit.sockets) return []
  const pieces: Piece[] = []
  for (const [slot, piece] of Object.entries(held) as [GearSlot, GearPiece][]) {
    const file = kit.pieces.get(piece.url)
    if (file) pieces.push({ name: slot, socket: slot, file, ...(piece.color ? { color: piece.color } : {}) })
  }
  return pieces.length ? hangPieces(model, pieces, shapedSockets(kit.sockets, rest, shaped)) : []
}

/**
 * Build a cloned body (from SkeletonUtils.clone) for one hero. Returns false for a model that isn't one of the bodies,
 * which then draws as its file made it. `refine` splits the body's triangles that many times over for a close look
 * (src/kit/body/refine.ts): the creator's studio, not the arena.
 */
export function buildModel(model: THREE.Object3D, look: CharacterLook, kit: LoadedKit | undefined, material: BodyMaterial, atlas?: THREE.Texture | null, refine = 0): boolean {
  const mesh = bodyMesh(model)
  if (!mesh || !onSharedSurface(mesh)) return false
  const cache = bodyCache(mesh)
  const own = bodyKitLoaded(look.build)
  const face = faceShape(look.face, look.sculpt, look.build, own, cache.base.positions)
  // the physique's weight, muscle and age in the morphs and its Volume dials sculpted on, then its proportions on the
  // skeleton's rest; then the metarig (GAME.md §9.2): helpers placed and weighted on this body
  const gender = look.build.startsWith('f') ? 'f' : 'm'
  const fileSkeleton = { bones: mesh.skeleton.bones.map((b) => b.name), rest: Object.fromEntries(cache.rest) }
  const proportioned = proportion(mesh, shapeBody(cache.base, cache.morphs, look.physique, face, { skeleton: fileSkeleton, gender }), look.physique)
  const restNow = meshRest(mesh)
  const plans = planHelpers(proportioned, restNow)
  const helped = helperSkin(proportioned, restNow, plans)
  const shape = { ...proportioned, joints: helped.joints, weights: helped.weights }
  const metarig = upgradeRig(model, mesh, plans)
  metarig.spread = bodySpread(proportioned, restNow)
  rigsOf(model).metarig = metarig
  applyPosture(model, look.physique)
  const source = mesh.geometry
  const map = atlas ?? characterMap(mesh)
  const normalMap = characterNormalMap(mesh)
  const fileMaterial = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial
  mesh.geometry = bodyGeometry(source, cache, shape, look)
  // the physique is baked in, so the file's morphs go
  mesh.morphTargetInfluences = undefined
  mesh.morphTargetDictionary = undefined
  const made = material(map, normalMap) as THREE.MeshStandardMaterial
  // glTF's tangent-space convention: the loader flips the normal scale's y for meshes without tangents; keep it
  if (normalMap && fileMaterial?.normalScale && made.normalScale) made.normalScale.copy(fileMaterial.normalScale)
  mesh.material = made
  mesh.frustumCulled = false
  // the head as its own object (GAME.md §9.1): its triangles leave the body's, it brings its eyes, teeth and face shapes
  if (kit?.head && own?.faceScale) {
    rigsOf(model).head = buildHead({
      model,
      mesh,
      body: shape,
      kit: kit.head,
      faceScale: own.faceScale,
      iris: look.colors.iris,
      white: look.colors.eye,
      brow: look.colors.brow,
      full: refine > 0,
      refine,
    })
  }
  if (refine) mesh.geometry = refineGeometry(mesh.geometry, refine)
  if (kit) hangHeld(model, look.held, kit, cache.base.positions, shape.positions)
  return true
}

