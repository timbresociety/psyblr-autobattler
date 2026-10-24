import * as THREE from 'three'
import type { LookSlot, Worn } from '../../../charter/look.js'
import { bodyBase, shapeBody, type BodyBase, type BodyShape } from '../../../kit/body/shape.js'
import { splitValues } from '../../../kit/body/surface.js'
import { dress, type DressedItem, type Worn as WornItem } from '../../../kit/wear/dress.js'
import { bodyFields, type BodyFields } from '../../../kit/wear/fields.js'
import { linearRgb } from '../../../kit/wear/finish.js'
import { coverOf, type Cover } from '../../../kit/wear/item.js'
import { characterMap, characterNormalMap, metaChannel, type CharacterLook } from '../character-look.js'
import { hangPieces, type Piece } from '../gear.js'
import type { GearSlot } from '../../../charter/look.js'
import { BODY_VERTICES, type LoadedWear } from './items.js'

/**
 * Dressing a cloned body for one hero: its physique and face baked into its own copy of the body's positions, the
 * skin its clothes cover hidden, every surface item it wears merged into one skinned mesh on the body's skeleton (one
 * draw for the whole outfit), and rigid items hung on their sockets. The arena passes node materials, the previews
 * and busts classic ones.
 */

export interface WearMaterials {
  /** The body's material, from its atlas (the hero's own when it has a photo face) and relief. */
  body: (map: THREE.Texture | null, normalMap: THREE.Texture | null) => THREE.Material
  /** The outfit's material: colours and finishes come per vertex (color, _finish). */
  cloth: () => THREE.Material
}

interface BodyCache {
  base: BodyBase
  fields: BodyFields
  morphs: string[]
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
    const fields = bodyFields({ positions: base.positions, joints: base.joints, weights: base.weights, bones: mesh.skeleton.bones.map((b) => b.name), rest: (name) => rest.get(name) })
    cache = { base, fields, morphs }
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

/** The surface items a hero wears with its colours and cuts, and the covers its rigid items bring. */
function outfitItems(outfit: Partial<Record<LookSlot, Worn>>, wear: LoadedWear | undefined): { worn: WornItem[]; rigid: Cover[] } {
  const worn: WornItem[] = []
  const rigid: Cover[] = []
  for (const w of Object.values(outfit)) {
    const loaded = w ? wear?.items.get(w.url) : undefined
    if (!w || !loaded) continue
    if (loaded.kind === 'rigid') {
      if (loaded.meta?.covers.length) rigid.push(coverOf(loaded.meta, BODY_VERTICES))
      continue
    }
    const { item } = loaded
    worn.push({
      item,
      colors: item.meta.channels.map((c, i) => linearRgb(w.colors?.[i] ?? c.color)),
      finishes: item.meta.channels.map((c, i) => w.finishes?.[i] ?? c.finish),
      ...(w.knobs ? { knobs: w.knobs } : {}),
    })
  }
  return { worn, rigid }
}

/** The body's own geometry for this hero: its shape, its colours (skin and eye whites), and only what shows. */
function bodyGeometry(source: THREE.BufferGeometry, cache: BodyCache, shape: BodyShape, shown: Uint32Array, look: CharacterLook): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  const { surface } = cache.base
  geo.setAttribute('position', new THREE.BufferAttribute(splitValues(surface, shape.positions, 3), 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(splitValues(surface, shape.normals, 3), 3))
  for (const name of ['uv', 'uv1', 'skinIndex', 'skinWeight']) {
    const a = source.getAttribute(name)
    if (a) geo.setAttribute(name, a)
  }
  const meta = source.getAttribute(metaChannel(source))
  const n = meta.count
  const colors = new Float32Array(n * 3)
  // with a photo face the skin colour is baked into the hero's own atlas, so the skin stays untinted here
  const skin = look.face ? new THREE.Color(1, 1, 1) : look.colors.skin
  const eye = look.colors.eye
  for (let i = 0; i < n; i++) {
    const c = Math.floor(meta.getX(i)) === 0 ? skin : eye
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const index = source.getIndex()!.array
  const kept = new Uint32Array(shown.length * 3)
  shown.forEach((t, i) => kept.set([index[t * 3], index[t * 3 + 1], index[t * 3 + 2]], i * 3))
  geo.setIndex(new THREE.BufferAttribute(kept, 1))
  geo.computeBoundingSphere()
  return geo
}

/** Every dressed item in one geometry, so the whole outfit is one draw. */
export function clothGeometry(items: DressedItem[]): THREE.BufferGeometry | undefined {
  const parts = items.filter((i) => i.index.length)
  if (!parts.length) return undefined
  const total = parts.reduce((n, i) => n + i.count, 0)
  const triangles = parts.reduce((n, i) => n + i.index.length, 0)
  const position = new Float32Array(total * 3)
  const normal = new Float32Array(total * 3)
  const uv = new Float32Array(total * 2)
  const color = new Float32Array(total * 3)
  const finish = new Float32Array(total * 4)
  const weave = new Float32Array(total)
  const skinIndex = new Uint16Array(total * 4)
  const skinWeight = new Float32Array(total * 4)
  const index = total > 65535 ? new Uint32Array(triangles) : new Uint16Array(triangles)
  let v = 0
  let t = 0
  for (const p of parts) {
    position.set(p.positions, v * 3)
    normal.set(p.normals, v * 3)
    uv.set(p.uv, v * 2)
    color.set(p.color, v * 3)
    finish.set(p.finish, v * 4)
    weave.set(p.weave, v)
    skinIndex.set(p.joints, v * 4)
    skinWeight.set(p.weights, v * 4)
    for (let k = 0; k < p.index.length; k++) index[t + k] = p.index[k] + v
    v += p.count
    t += p.index.length
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3))
  geo.setAttribute('_finish', new THREE.BufferAttribute(finish, 4))
  geo.setAttribute('_weave', new THREE.BufferAttribute(weave, 1))
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4))
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4))
  geo.setIndex(new THREE.BufferAttribute(index, 1))
  geo.computeBoundingSphere()
  return geo
}

const SOCKET: Partial<Record<LookSlot, GearSlot>> = { head: 'head', face: 'face', back: 'back', hand_r: 'hand_r', hand_l: 'hand_l' }

/** Hang each rigid item on its socket, its first channel tinting the piece's 'primary' material. */
function hangRigid(model: THREE.Object3D, outfit: Partial<Record<LookSlot, Worn>>, wear: LoadedWear): THREE.Object3D[] {
  if (!wear.sockets) return []
  const pieces: Piece[] = []
  for (const [slot, w] of Object.entries(outfit) as [LookSlot, Worn][]) {
    const loaded = wear.items.get(w.url)
    const socket = (loaded?.kind === 'rigid' && (loaded.meta?.socket as GearSlot | undefined)) || SOCKET[slot]
    if (loaded?.kind !== 'rigid' || !socket) continue
    pieces.push({ name: slot, socket, file: loaded.file, ...(w.colors?.[0] ? { color: w.colors[0] } : {}) })
  }
  return hangPieces(model, pieces, wear.sockets)
}

/**
 * Dress a cloned body (from SkeletonUtils.clone) for one hero. Returns false for a model not on the shared surface (a
 * demo hero's own model), which the caller paints the old way.
 */
export function dressModel(model: THREE.Object3D, look: CharacterLook, wear: LoadedWear | undefined, materials: WearMaterials, atlas?: THREE.Texture | null): boolean {
  const mesh = bodyMesh(model)
  if (!mesh || !onSharedSurface(mesh)) return false
  const cache = bodyCache(mesh)
  const shape = shapeBody(cache.base, cache.morphs, look.physique)
  const { worn, rigid } = outfitItems(look.outfit, wear)
  const dressed = dress({ body: shape, fields: cache.fields, worn, rigid })
  const source = mesh.geometry
  const map = atlas ?? characterMap(mesh)
  const normalMap = characterNormalMap(mesh)
  const fileMaterial = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial
  mesh.geometry = bodyGeometry(source, cache, shape, dressed.body, look)
  // the physique is baked in, so the file's morphs go
  mesh.morphTargetInfluences = undefined
  mesh.morphTargetDictionary = undefined
  const made = materials.body(map, normalMap) as THREE.MeshStandardMaterial
  // glTF's tangent-space convention: the loader flips the normal scale's y for meshes without tangents; keep it
  if (normalMap && fileMaterial?.normalScale && made.normalScale) made.normalScale.copy(fileMaterial.normalScale)
  mesh.material = made
  mesh.frustumCulled = false
  const cloth = clothGeometry(dressed.items)
  if (cloth) {
    const outfit = new THREE.SkinnedMesh(cloth, materials.cloth())
    outfit.name = 'outfit'
    outfit.position.copy(mesh.position)
    outfit.quaternion.copy(mesh.quaternion)
    outfit.scale.copy(mesh.scale)
    outfit.bind(mesh.skeleton, mesh.bindMatrix)
    outfit.frustumCulled = false
    outfit.castShadow = true
    mesh.parent!.add(outfit)
  }
  if (wear) hangRigid(model, look.outfit, wear)
  return true
}

/**
 * The classic (WebGL) outfit material for the previews and busts: vertex colours, with roughness, metalness, a cloth
 * sheen toward the silhouette and glow read per vertex from _finish.
 */
export function classicClothMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 _finish;\nvarying vec4 vFinish;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFinish = _finish;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vFinish;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vFinish.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vFinish.y;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\nfloat grazing = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);\ntotalEmissiveRadiance += diffuseColor.rgb * (vFinish.w + vFinish.z * 0.3 * grazing);',
      )
  }
  m.customProgramCacheKey = () => 'psyblr-cloth'
  return m
}
