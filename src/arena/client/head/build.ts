import * as THREE from 'three'
import type { BodySurface } from '../../../kit/body/surface.js'
import { refineGeometry } from '../../../kit/body/refine.js'
import { ARKIT_SHAPES, boundDeltas, eyeIds, headShare, jawFit, LITE_SHAPES, sphereOf, type ArkitShape, type CardPart, type RigidPart } from '../../../kit/head/head.js'
import { evaluate, type Binding } from '../../../kit/wear/bind.js'
import { makeEye } from './eyes.js'
import type { HeadKit } from './kit.js'

/**
 * The head as its own object on a dressed body (GAME.md §9.1). The body's head triangles move out of the body's mesh
 * into the head's, which shares the body's skeleton, skin and material, so the collar where they meet is the same
 * vertices on both sides (no seam, the skin tone the same) and every face the hero has (photo, sculpt, physique) is
 * the head's too. Onto it go the brow and lash cards and the ARKit face shapes; real eyeballs turn in its sockets, the
 * teeth ride the head and jaw, the tongue the jaw. Call on a fresh clone at rest, after the metarig's upgrade.
 */

/** A hero's body, shaped, as the head needs it: welded positions, normals and skin, and the file-to-welded map. */
export interface HeadBody {
  surface: BodySurface
  positions: ArrayLike<number>
  normals: ArrayLike<number>
  joints: ArrayLike<number>
  weights: ArrayLike<number>
}

export interface HeadInput {
  model: THREE.Object3D
  /** The body, its geometry already the hero's (dress-model bodyGeometry), its skeleton upgraded. */
  mesh: THREE.SkinnedMesh
  body: HeadBody
  kit: HeadKit
  /** The body file's face scale (its kit's), against the head kit's reference body. */
  faceScale: number
  iris: THREE.Color
  white: THREE.Color
  brow: THREE.Color
  /** All 52 shapes (close looks) or the arena's few. */
  full: boolean
  /** Split the head's triangles this many times, as the body was (refine.ts). */
  refine?: number
}

export interface HeadEye {
  pivot: THREE.Object3D
  bone?: THREE.Object3D
  boneRest: THREE.Quaternion
  pivotRest: THREE.Quaternion
  side: 'left' | 'right'
}

export interface HeadRig {
  mesh: THREE.SkinnedMesh
  /** The shapes the mesh carries, in morph order. */
  shapes: readonly ArkitShape[]
  eyes: HeadEye[]
  /** Turn the eyes with their bones (a clip or a look-at that keys them sanely); off, the look shapes alone do. */
  followEyeBones?: boolean
  jaw?: {
    bone: THREE.Object3D
    rest: THREE.Quaternion
    axis: THREE.Vector3
    openDeg: number
    /** What rides the jaw (the lower teeth, the tongue), shifted by `shift` (the jaw's frame) at full jawOpen besides the turn. */
    carried: { mesh: THREE.Object3D; rest: THREE.Vector3 }[]
    shift: THREE.Vector3
  }
  tongue?: { mesh: THREE.Object3D; rest: THREE.Vector3; out: THREE.Vector3 }
}

const LASH = new THREE.Color(0.05, 0.035, 0.03)
/** How far back of its fitted place the tongue rests, and how far tongueOut puts it out (metres, reference face). */
const TONGUE_BACK = 0.006
const TONGUE_OUT = 0.018

/** The mean share of a triangle's corners the head carries. */
const triShare = (share: Float32Array, vid: Uint32Array, index: ArrayLike<number>, t: number) => (share[vid[index[t * 3]]] + share[vid[index[t * 3 + 1]]] + share[vid[index[t * 3 + 2]]]) / 3

/**
 * Take the head's triangles out of the body's geometry (its index shrinks) and return them as a geometry of their own,
 * with only the vertices they use; `file` gives each head vertex's vertex in the body's geometry.
 */
export function splitHead(geo: THREE.BufferGeometry, vid: Uint32Array, share: Float32Array): { head: THREE.BufferGeometry; file: Uint32Array } {
  const index = geo.getIndex()!.array
  const keep: number[] = []
  const take: number[] = []
  for (let t = 0; t < index.length / 3; t++) (triShare(share, vid, index, t) >= 0.5 ? take : keep).push(index[t * 3], index[t * 3 + 1], index[t * 3 + 2])
  geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(keep), 1))
  const map = new Int32Array(geo.getAttribute('position').count).fill(-1)
  const file: number[] = []
  const headIndex = take.map((i) => (map[i] < 0 ? (map[i] = file.push(i) - 1) : map[i]))
  const head = new THREE.BufferGeometry()
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const a = attr as THREE.BufferAttribute
    const size = a.itemSize
    const Ctor = a.array.constructor as new (n: number) => THREE.TypedArray
    const out = new Ctor(file.length * size)
    for (let i = 0; i < file.length; i++) for (let k = 0; k < size; k++) out[i * size + k] = a.array[file[i] * size + k]
    head.setAttribute(name, new THREE.BufferAttribute(out, size, a.normalized))
  }
  head.setIndex(new THREE.BufferAttribute(Uint32Array.from(headIndex), 1))
  return { head, file: Uint32Array.from(file) }
}

const bindingOf = (p: { tri: ArrayLike<number>; st: ArrayLike<number>; lift: ArrayLike<number> }): Binding => ({ tri: Uint16Array.from(p.tri), st: Float32Array.from(p.st), lift: Float32Array.from(p.lift) })

/** A card part on this hero: positions from its binding, the face's normal under it, the skin of its nearest corner. */
function cards(part: CardPart, body: HeadBody, color: THREE.Color) {
  const binding = bindingOf(part)
  const n = binding.lift.length
  const position = evaluate(binding, { positions: body.positions, normals: body.normals, triangles: body.surface.triangles })
  const normal = new Float32Array(n * 3)
  const skinIndex = new Uint16Array(n * 4)
  const skinWeight = new Float32Array(n * 4)
  const N = body.normals
  for (let i = 0; i < n; i++) {
    const [a, b, c] = [binding.tri[i * 3], binding.tri[i * 3 + 1], binding.tri[i * 3 + 2]]
    const s = binding.st[i * 2]
    const t = binding.st[i * 2 + 1]
    const v = new THREE.Vector3()
    for (let k = 0; k < 3; k++) v.setComponent(k, N[a * 3 + k] + s * (N[b * 3 + k] - N[a * 3 + k]) + t * (N[c * 3 + k] - N[a * 3 + k]))
    v.normalize().toArray(normal, i * 3)
    const corner = [1 - s - t, s, t]
    const near = [a, b, c][corner.indexOf(Math.max(...corner))]
    for (let k = 0; k < 4; k++) {
      skinIndex[i * 4 + k] = body.joints[near * 4 + k]
      skinWeight[i * 4 + k] = body.weights[near * 4 + k]
    }
  }
  const color3 = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) color.toArray(color3, i * 3)
  return { binding, position, normal, skinIndex, skinWeight, uv: Float32Array.from(part.uv), color: color3, index: part.index }
}

/** The head's geometry with the cards appended (one draw each), attributes the body material reads filled for them. */
function withCards(head: THREE.BufferGeometry, parts: ReturnType<typeof cards>[]): THREE.BufferGeometry {
  const base = head.getAttribute('position').count
  const total = base + parts.reduce((s, p) => s + p.position.length / 3, 0)
  const out = new THREE.BufferGeometry()
  for (const [name, attr] of Object.entries(head.attributes)) {
    const a = attr as THREE.BufferAttribute
    const Ctor = a.array.constructor as new (n: number) => THREE.TypedArray
    const arr = new Ctor(total * a.itemSize)
    arr.set(a.array as ArrayLike<number>)
    let at = base
    for (const p of parts) {
      const own: Partial<Record<string, ArrayLike<number>>> = { position: p.position, normal: p.normal, uv: p.uv, skinIndex: p.skinIndex, skinWeight: p.skinWeight, color: p.color }
      const src = own[name]
      if (src) arr.set(src, at * a.itemSize)
      at += p.position.length / 3
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized))
  }
  const skinTris = head.getIndex()!.array
  const index: number[] = Array.from(skinTris)
  out.addGroup(0, skinTris.length, 0)
  let at = base
  parts.forEach((p, k) => {
    const start = index.length
    for (const i of p.index) index.push(i + at)
    out.addGroup(start, p.index.length, k + 1)
    at += p.position.length / 3
  })
  out.setIndex(new THREE.BufferAttribute(Uint32Array.from(index), 1))
  return out
}

/**
 * The inside of the mouth in shadow: skin round the teeth that faces into the mouth rather than out of the head is
 * darkened toward a deep red, so an open mouth reads as a mouth, not more face.
 */
function shadeMouth(geo: THREE.BufferGeometry, kit: HeadKit, body: HeadBody, scale: number) {
  const at = (p: RigidPart) => evaluate(bindingOf({ tri: p.anchor.tri, st: p.anchor.st, lift: [p.anchor.lift] }), { positions: body.positions, normals: body.normals, triangles: body.surface.triangles })
  const up = at(kit.teethUpper)
  const low = at(kit.teethLower)
  const c = new THREE.Vector3((up[0] + low[0]) / 2, (up[1] + low[1]) / 2, (up[2] + low[2]) / 2)
  const position = geo.getAttribute('position')
  const normal = geo.getAttribute('normal')
  const color = geo.getAttribute('color') as THREE.BufferAttribute | undefined
  if (!color) return
  const p = new THREE.Vector3()
  const n = new THREE.Vector3()
  const reach = 0.04 * scale
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i)
    const toward = c.clone().sub(p)
    const d = toward.length()
    if (d > reach) continue
    n.fromBufferAttribute(normal, i)
    const inward = n.dot(toward) / Math.max(d, 1e-6)
    if (inward < 0.2) continue
    const k = Math.min(1, (inward - 0.2) / 0.4) * Math.min(1, (reach - d) / (reach * 0.3))
    color.setXYZ(i, color.getX(i) * (1 - k * 0.7), color.getY(i) * (1 - k * 0.85), color.getZ(i) * (1 - k * 0.85))
  }
}

/** A rigid part placed on this hero: its middle where its binding puts it on this face, its size the face's. */
function rigid(part: RigidPart, body: HeadBody, scale: number, material: THREE.Material, name: string): THREE.Mesh {
  const a = part.anchor
  const at = evaluate(bindingOf({ tri: a.tri, st: a.st, lift: [a.lift] }), { positions: body.positions, normals: body.normals, triangles: body.surface.triangles })
  const p = Float32Array.from(part.position)
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) p[i + k] = at[k] + (p[i + k] - a.at[k]) * scale
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(p, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(part.uv), 2))
  g.setIndex(part.index)
  g.computeVertexNormals()
  const m = new THREE.Mesh(g, material)
  m.name = name
  return m
}

/** Hang `obj`, placed in the body mesh's own space, on `bone`, keeping where it is (the model is at rest). */
function hangOn(obj: THREE.Object3D, mesh: THREE.SkinnedMesh, bone: THREE.Object3D) {
  mesh.add(obj)
  mesh.updateWorldMatrix(true, true)
  bone.updateWorldMatrix(true, false)
  bone.attach(obj)
}

export function buildHead(input: HeadInput): HeadRig | undefined {
  const { model, mesh, body, kit, faceScale } = input
  const bones = mesh.skeleton.bones
  const bone = (name: string) => bones.find((b) => b.name === name) ?? model.getObjectByName(name)
  const head = bone('Head')
  if (!head) return undefined
  const scale = faceScale / kit.meta.faceScale
  const share = headShare(body.joints, body.weights, bones.map((b) => b.name))
  const { head: skinGeo, file } = splitHead(mesh.geometry, body.surface.vid, share)
  shadeMouth(skinGeo, kit, body, scale)
  // the brows take the hair's colour, the lashes stay near black
  const browCards = cards(kit.brows, body, input.brow)
  const lashCards = cards(kit.lashes, body, LASH)
  let geo = withCards(skinGeo, [browCards, lashCards])
  // the face shapes: on the skin from the head file, on the cards through their bindings
  const shapes = (input.full ? ARKIT_SHAPES : LITE_SHAPES).filter((s) => kit.shapes.groups[kit.meta.shapes.indexOf(s)]?.ids.length || s === 'jawOpen')
  const count = geo.getAttribute('position').count
  const dense = new Float32Array(body.surface.count * 3)
  const deltas = shapes.map((name) => {
    const group = kit.shapes.groups[kit.meta.shapes.indexOf(name)]
    const out = new Float32Array(count * 3)
    for (let i = 0; i < group.ids.length; i++) for (let k = 0; k < 3; k++) dense[group.ids[i] * 3 + k] = group.deltas[i * 3 + k] * scale
    for (let h = 0; h < file.length; h++) {
      const v = body.surface.vid[file[h]]
      for (let k = 0; k < 3; k++) out[h * 3 + k] = dense[v * 3 + k]
    }
    for (let i = 0; i < group.ids.length; i++) for (let k = 0; k < 3; k++) dense[group.ids[i] * 3 + k] = 0
    let at = file.length
    for (const c of [browCards, lashCards]) {
      out.set(boundDeltas(c.binding, group, scale), at * 3)
      at += c.binding.lift.length
    }
    return out
  })
  if (input.refine) {
    // the shapes ride through the split as attributes (carried halfway along each edge), then become morphs
    deltas.forEach((d, k) => geo.setAttribute(`_m${k}`, new THREE.BufferAttribute(d, 3)))
    geo = refineGeometry(geo, input.refine)
    geo.morphAttributes.position = deltas.map((_d, k) => {
      const a = geo.getAttribute(`_m${k}`) as THREE.BufferAttribute
      geo.deleteAttribute(`_m${k}`)
      return a
    })
  } else geo.morphAttributes.position = deltas.map((d) => new THREE.BufferAttribute(d, 3))
  geo.morphTargetsRelative = true
  geo.computeBoundingSphere()
  const skinMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  const card = (part: CardPart, color: THREE.Color) =>
    new THREE.MeshStandardMaterial({ map: part.texture ? (kit.textures.get(part.texture) ?? null) : null, color, roughness: 0.85, metalness: 0, alphaTest: 0.2, alphaToCoverage: true, side: THREE.DoubleSide })
  // the skin casts the shadow; the brow and lash cards draw from a twin on the same geometry, skeleton and morphs that
  // casts none. One mesh for both made the shadow pass, which shares one material across every draw, flip its alpha
  // test between the skin and the cards each frame and rebuild the head's shadow shader every time.
  const headMesh = new THREE.SkinnedMesh(geo, [skinMaterial])
  const cardMesh = new THREE.SkinnedMesh(geo, [new THREE.MeshBasicMaterial({ visible: false }), card(kit.brows, input.brow), card(kit.lashes, LASH)])
  headMesh.name = 'head'
  cardMesh.name = 'head:cards'
  for (const m of [headMesh, cardMesh]) {
    m.position.copy(mesh.position)
    m.quaternion.copy(mesh.quaternion)
    m.scale.copy(mesh.scale)
    m.bind(mesh.skeleton, mesh.bindMatrix)
    m.frustumCulled = false
  }
  headMesh.castShadow = true
  cardMesh.userData.noShadow = true
  headMesh.morphTargetDictionary = cardMesh.morphTargetDictionary = Object.fromEntries(shapes.map((s, k) => [s, k]))
  headMesh.morphTargetInfluences = cardMesh.morphTargetInfluences = shapes.map(() => 0)
  mesh.parent!.add(headMesh, cardMesh)
  // the eyes, in the sockets the hero's face has
  const eyes: HeadEye[] = []
  const sockets = eyeIds(body.surface.triangles, body.positions, body.surface.count)
  for (const side of ['left', 'right'] as const) {
    const ids = sockets[side]
    if (!ids.length) continue
    const { centre, radius } = sphereOf(body.positions, ids)
    const pivot = new THREE.Object3D()
    pivot.name = `eye:${side}`
    pivot.position.set(...centre)
    const eye = makeEye(input.iris, input.white)
    eye.scale.setScalar(radius)
    pivot.add(eye)
    hangOn(pivot, mesh, head)
    const eyeBone = bone(side === 'left' ? 'LeftEye' : 'RightEye')
    eyes.push({ pivot, ...(eyeBone ? { bone: eyeBone } : {}), boneRest: eyeBone?.quaternion.clone() ?? new THREE.Quaternion(), pivotRest: pivot.quaternion.clone(), side })
  }
  // the teeth and the tongue, the lower ones on the jaw
  const jawBone = bone('Jaw') ?? head
  const enamel = new THREE.MeshStandardMaterial({ map: kit.teethUpper.texture ? (kit.textures.get(kit.teethUpper.texture) ?? null) : null, roughness: 0.3, metalness: 0, alphaTest: 0.5 })
  const flesh = new THREE.MeshStandardMaterial({ map: kit.tongue.texture ? (kit.textures.get(kit.tongue.texture) ?? null) : null, color: 0xb07070, roughness: 0.45, metalness: 0 })
  hangOn(rigid(kit.teethUpper, body, scale, enamel, 'teeth:upper'), mesh, head)
  const lower = rigid(kit.teethLower, body, scale, enamel, 'teeth:lower')
  // the tongue sits a little back from where it was fitted, behind the lips however they purse
  const tongue = rigid(kit.tongue, body, scale, flesh, 'tongue')
  tongue.geometry.translate(0, -0.002 * scale, -TONGUE_BACK * scale)
  hangOn(lower, mesh, jawBone)
  hangOn(tongue, mesh, jawBone)
  // a direction or offset in the body mesh's space, in the jaw's own
  const inJaw = (v: THREE.Vector3) => {
    const o = jawBone.worldToLocal(new THREE.Vector3().applyMatrix4(mesh.matrixWorld))
    return jawBone.worldToLocal(v.clone().applyMatrix4(mesh.matrixWorld)).sub(o)
  }
  // the jaw opens about the body's left-right axis, as far as jawOpen carries the skin round the lower teeth
  let jaw: HeadRig['jaw']
  if (jawBone !== head && jawBone.parent) {
    const meshTurn = mesh.getWorldQuaternion(new THREE.Quaternion())
    const parentTurn = jawBone.parent.getWorldQuaternion(new THREE.Quaternion())
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(meshTurn).applyQuaternion(parentTurn.invert())
    const pivot = new THREE.Vector3().setFromMatrixPosition(jawBone.matrixWorld).applyMatrix4(mesh.matrixWorld.clone().invert())
    const group = kit.shapes.groups[kit.meta.shapes.indexOf('jawOpen')]
    // the lips part here on this face: the reference body's mouth, moved as the lower teeth were
    const mouthY = kit.meta.mouth[1] + (lower.geometry.boundingSphere ?? (lower.geometry.computeBoundingSphere(), lower.geometry.boundingSphere!)).center.y - kit.teethLower.anchor.at[1]
    const centre = lower.geometry.boundingSphere ?? (lower.geometry.computeBoundingSphere(), lower.geometry.boundingSphere!)
    const fit = jawFit(group, body.positions, pivot.toArray(), { centre: centre.center.toArray(), radius: 0.025 * scale, below: mouthY, width: 0.012 * scale })
    // scaled with the shape: the deltas the fit read are the reference body's
    const shift = inJaw(new THREE.Vector3(...fit.shift).multiplyScalar(scale))
    jaw = { bone: jawBone, rest: jawBone.quaternion.clone(), axis: axis.normalize(), openDeg: fit.deg, carried: [lower, tongue].map((m) => ({ mesh: m, rest: m.position.clone() })), shift }
  }
  const out = inJaw(new THREE.Vector3(0, 0, TONGUE_OUT))
  return { mesh: headMesh, shapes, eyes, ...(jaw ? { jaw } : {}), tongue: { mesh: tongue, rest: tongue.position.clone(), out } }
}
