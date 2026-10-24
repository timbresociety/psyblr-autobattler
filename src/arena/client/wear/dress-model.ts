import * as THREE from 'three'
import type { LookSlot, Worn } from '../../../charter/look.js'
import { bodyBase, shapeBody, type BodyBase, type BodyShape } from '../../../kit/body/shape.js'
import { splitValues } from '../../../kit/body/surface.js'
import { dress, type DressedItem, type Worn as WornItem } from '../../../kit/wear/dress.js'
import { bodyFields, type BodyFields } from '../../../kit/wear/fields.js'
import { linearRgb } from '../../../kit/wear/finish.js'
import { coverOf, type Cover } from '../../../kit/wear/item.js'
import { PRINT_SCALE, drawPrint, inkFor, type PrintId } from '../../../kit/wear/prints.js'
import { bodyKitLoaded } from '../body-kit.js'
import { characterMap, characterNormalMap, metaChannel, type CharacterLook } from '../character-look.js'
import { photoFaceShape } from '../face/shape.js'
import { hangPieces, type Piece } from '../gear.js'
import type { GearSlot } from '../../../charter/look.js'
import { rigCloth } from './cloth-model.js'
import { BODY_VERTICES, type LoadedWear } from './items.js'

/**
 * Dressing a cloned body for one hero: its physique and face baked into its own copy of the body's positions, the
 * skin its clothes cover hidden, every surface item it wears merged into one skinned mesh on the body's skeleton (one
 * draw for the whole outfit, plus one for each generated item and each print), and rigid items hung on their sockets.
 * The arena passes node materials, the previews and busts classic ones.
 */

/** A print as the outfit's material lays it on (see WornPrint). */
export interface ClothPrint {
  /** A built-in print's tile as a mask (its red channel: 0 where the ground shows, 1 where the ink does), or a picture. */
  map: THREE.Texture
  /** Tiles per metre, laid on by where the cloth sits on the body at rest: a print ignores the item's UVs. */
  repeat: number
  /** A built-in print's ink (linear), mixed over the channel's own colour by the mask. A picture shows as it is. */
  ink?: THREE.Color
}

export interface WearMaterials {
  /** The body's material, from its atlas (the hero's own when it has a photo face) and relief. */
  body: (map: THREE.Texture | null, normalMap: THREE.Texture | null) => THREE.Material
  /**
   * The outfit's material: colours and finishes come per vertex (color, _finish). With a map, a generated item's own:
   * its texture where each channel keeps its colour, recoloured where the player chose another (_base holds the
   * channel's own colour; see printedColor).
   */
  cloth: (map?: THREE.Texture) => THREE.Material
  /** A print's material, for the triangles of the channel it covers. */
  print: (print: ClothPrint) => THREE.Material
}

interface BodyCache {
  base: BodyBase
  fields: BodyFields
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
    const fields = bodyFields({ positions: base.positions, joints: base.joints, weights: base.weights, bones: mesh.skeleton.bones.map((b) => b.name), rest: (name) => rest.get(name) })
    cache = { base, fields, morphs, rest }
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

/** A generated item's texture, and per vertex its channel's own colour (linear), which the texture already shows. */
interface OwnTexture {
  texture: THREE.Texture
  base: Float32Array
}

/** A print over one channel of a worn item: the channel of each of the item's vertices, the printed one, and its tile. */
interface Pattern {
  channels: ArrayLike<number>
  channel: number
  print: ClothPrint
}

const MASK_SIZE = 256
const masks = new Map<PrintId, THREE.Texture>()
const pictures = new Map<string, THREE.Texture>()

/** A built-in print's tile as a mask: drawn once, and shared by every hero who wears it in whatever colours. */
function printMask(id: PrintId): THREE.Texture | undefined {
  let mask = masks.get(id)
  if (!mask && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = MASK_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    drawPrint(ctx, id, MASK_SIZE, '#000000', '#ffffff')
    mask = new THREE.CanvasTexture(canvas)
    mask.wrapS = mask.wrapT = THREE.RepeatWrapping
    mask.colorSpace = THREE.NoColorSpace
    mask.anisotropy = 4
    masks.set(id, mask)
  }
  return mask
}

/** A player's picture as a print, mirrored at every repeat so it has no seams. */
function printPicture(url: string): THREE.Texture | undefined {
  let picture = pictures.get(url)
  if (!picture && typeof document !== 'undefined') {
    picture = new THREE.TextureLoader().load(url)
    picture.wrapS = picture.wrapT = THREE.MirroredRepeatWrapping
    picture.colorSpace = THREE.SRGBColorSpace
    picture.anisotropy = 4
    pictures.set(url, picture)
  }
  return picture
}

/** The surface items a hero wears with its colours and cuts, the covers its rigid items bring, and the generated items' textures and the prints. */
function outfitItems(outfit: Partial<Record<LookSlot, Worn>>, wear: LoadedWear | undefined): { worn: WornItem[]; rigid: Cover[]; textured: Map<string, OwnTexture>; patterns: Map<string, Pattern> } {
  const worn: WornItem[] = []
  const rigid: Cover[] = []
  const textured = new Map<string, OwnTexture>()
  const patterns = new Map<string, Pattern>()
  for (const w of Object.values(outfit)) {
    const loaded = w ? wear?.items.get(w.url) : undefined
    if (!w || !loaded) continue
    if (loaded.kind === 'rigid') {
      if (loaded.meta?.covers.length) rigid.push(coverOf(loaded.meta, BODY_VERTICES))
      continue
    }
    const { item, texture } = loaded
    worn.push({
      item,
      colors: item.meta.channels.map((c, i) => linearRgb(w.colors?.[i] ?? c.color)),
      finishes: item.meta.channels.map((c, i) => w.finishes?.[i] ?? c.finish),
      ...(w.knobs ? { knobs: w.knobs } : {}),
    })
    if (texture) {
      const own = item.meta.channels.map((c) => linearRgb(c.color))
      const base = new Float32Array(item.count * 3)
      for (let k = 0; k < item.count; k++) base.set(own[item.channel[k]] ?? [0.5, 0.5, 0.5], k * 3)
      textured.set(item.meta.id, { texture, base })
    }
    const print = w.print
    const channel = print?.channel ?? 0
    const map = print?.id ? printMask(print.id) : print?.url ? printPicture(print.url) : undefined
    if (print && map && channel < item.meta.channels.length) {
      const ground = w.colors?.[channel] ?? item.meta.channels[channel].color
      const ink = print.id ? new THREE.Color(...linearRgb(print.ink ?? inkFor(ground))) : undefined
      patterns.set(item.meta.id, { channels: item.channel, channel, print: { map, repeat: print.scale ?? PRINT_SCALE.default, ...(ink ? { ink } : {}) } })
    }
  }
  return { worn, rigid, textured, patterns }
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

/**
 * The dressed items that draw anything, in the order the outfit's one geometry merges them: the plain ones, then each
 * textured one.
 */
function drawn(items: DressedItem[], textured: ReadonlyMap<string, OwnTexture>): DressedItem[] {
  const shown = items.filter((i) => i.index.length)
  return [...shown.filter((i) => !textured.has(i.id)), ...shown.filter((i) => textured.has(i.id))]
}

/**
 * Every dressed item in one geometry, in drawn's order: one skinned mesh for the whole outfit, so its loose cloth is
 * one rig. Its triangles come in draws, each a group for its own material (the mesh's material array in the same
 * order): every plain item's together first, then each textured item's, then each print's, which takes the printed
 * channel's triangles out of its item's draw. An outfit with neither is one draw, with no groups.
 */
export function clothGeometry(parts: DressedItem[], textured: ReadonlyMap<string, OwnTexture> = new Map(), patterns: ReadonlyMap<string, Pattern> = new Map()): THREE.BufferGeometry | undefined {
  if (!parts.length) return undefined
  const total = parts.reduce((n, i) => n + i.count, 0)
  const triangles = parts.reduce((n, i) => n + i.index.length, 0)
  const position = new Float32Array(total * 3)
  const normal = new Float32Array(total * 3)
  const uv = new Float32Array(total * 2)
  const color = new Float32Array(total * 3)
  const base = new Float32Array(total * 3)
  const finish = new Float32Array(total * 4)
  const weave = new Float32Array(total)
  const skinIndex = new Uint16Array(total * 4)
  const skinWeight = new Float32Array(total * 4)
  const plain: number[] = []
  const own: number[][] = []
  const printed: number[][] = []
  let v = 0
  for (const p of parts) {
    const texture = textured.get(p.id)
    const pattern = patterns.get(p.id)
    position.set(p.positions, v * 3)
    normal.set(p.normals, v * 3)
    uv.set(p.uv, v * 2)
    color.set(p.color, v * 3)
    base.set(texture ? texture.base : p.color, v * 3)
    finish.set(p.finish, v * 4)
    weave.set(p.weave, v)
    skinIndex.set(p.joints, v * 4)
    skinWeight.set(p.weights, v * 4)
    const into = texture ? own[own.push([]) - 1] : plain
    const onPrint = pattern ? printed[printed.push([]) - 1] : undefined
    for (let k = 0; k < p.index.length; k += 3) {
      // a triangle's corners share a channel
      const draw = onPrint && pattern!.channels[p.index[k]] === pattern!.channel ? onPrint : into
      draw.push(p.index[k] + v, p.index[k + 1] + v, p.index[k + 2] + v)
    }
    v += p.count
  }
  const geo = new THREE.BufferGeometry()
  const index = total > 65535 ? new Uint32Array(triangles) : new Uint16Array(triangles)
  const draws = [plain, ...own, ...printed]
  let t = 0
  draws.forEach((draw, material) => {
    index.set(draw, t)
    if (draws.length > 1 && draw.length) geo.addGroup(t, draw.length, material)
    t += draw.length
  })
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3))
  if (textured.size) geo.setAttribute('_base', new THREE.BufferAttribute(base, 3))
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
 * Dress a cloned body (from SkeletonUtils.clone) for one hero. Returns false for a model that isn't one of the bodies,
 * which then draws as its file made it.
 */
export function dressModel(model: THREE.Object3D, look: CharacterLook, wear: LoadedWear | undefined, materials: WearMaterials, atlas?: THREE.Texture | null): boolean {
  const mesh = bodyMesh(model)
  if (!mesh || !onSharedSurface(mesh)) return false
  const cache = bodyCache(mesh)
  const face = photoFaceShape(look.face, look.build, bodyKitLoaded(look.build), cache.base.positions)
  const shape = shapeBody(cache.base, cache.morphs, look.physique, face)
  const { worn, rigid, textured, patterns } = outfitItems(look.outfit, wear)
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
  const parts = drawn(dressed.items, textured)
  const cloth = clothGeometry(parts, textured, patterns)
  if (cloth) {
    // in clothGeometry's order: the plain items, each textured one, each print
    const own = parts.flatMap((p) => textured.get(p.id) ?? []).map((t) => materials.cloth(t.texture))
    const printed = parts.flatMap((p) => patterns.get(p.id) ?? []).map((t) => materials.print(t.print))
    const outfit = new THREE.SkinnedMesh(cloth, own.length || printed.length ? [materials.cloth(), ...own, ...printed] : materials.cloth())
    outfit.name = 'outfit'
    outfit.position.copy(mesh.position)
    outfit.quaternion.copy(mesh.quaternion)
    outfit.scale.copy(mesh.scale)
    outfit.bind(mesh.skeleton, mesh.bindMatrix)
    outfit.frustumCulled = false
    outfit.castShadow = true
    mesh.parent!.add(outfit)
    // whatever hangs loose swings on its own bones (settleCloth each frame)
    rigCloth(model, outfit, parts, shape, (bone) => cache.rest.get(bone))
  }
  if (wear) hangRigid(model, look.outfit, wear)
  return true
}

/** The finish read per vertex from _finish: roughness, metalness, a cloth sheen toward the silhouette, and glow. */
function finishShader(shader: { vertexShader: string; fragmentShader: string }) {
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

/**
 * The classic (WebGL) outfit material for the previews and busts: vertex colours, with roughness, metalness, a cloth
 * sheen toward the silhouette and glow read per vertex from _finish. With a map, a generated item's texture in place
 * of its channels' colours, recoloured where the player chose another (printedColor).
 */
export function classicClothMaterial(map?: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, ...(map ? { map } : {}) })
  m.onBeforeCompile = (shader) => {
    if (map) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 _base;\nvarying vec3 vBase;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBase = _base;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vBase;\n${PRINTED_GLSL}`)
        // the map has already been sampled into diffuseColor
        .replace('#include <color_fragment>', 'diffuseColor.rgb = printedColor(diffuseColor.rgb, vColor.rgb, vBase);')
    }
    finishShader(shader)
  }
  m.customProgramCacheKey = () => (map ? 'psyblr-cloth-printed' : 'psyblr-cloth')
  return m
}

/**
 * The classic outfit material for a print: its tile laid on by where the cloth sits on the body at rest, each face
 * taking it from the axis it faces most and blending where it turns, so it rides the cloth as it moves. A built-in
 * print's mask mixes its ink over the channel's colour; a picture shows as it is. The finish is the channel's own.
 */
export function classicPrintMaterial(print: ClothPrint): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, map: print.map })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.printRepeat = { value: print.repeat }
    shader.uniforms.printInk = { value: print.ink ?? new THREE.Color() }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;\nvarying vec3 vRestNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;\nvRestNormal = normal;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float printRepeat;\nuniform vec3 printInk;\nvarying vec3 vRest;\nvarying vec3 vRestNormal;\n${TRIPLANAR_GLSL}`)
      .replace('#include <map_fragment>', 'vec4 printTile = triplanar(map, vRest * printRepeat, vRestNormal);')
      .replace('#include <color_fragment>', print.ink ? 'diffuseColor.rgb = mix(vColor.rgb, printInk, printTile.r);' : 'diffuseColor.rgb = printTile.rgb;')
    finishShader(shader)
  }
  m.customProgramCacheKey = () => (print.ink ? 'psyblr-cloth-print' : 'psyblr-cloth-picture')
  return m
}

/** A tile at a point of the body at rest: from the axis each face looks along, blended where it turns (keijiro's StandardTriplanar, sharpened). */
const TRIPLANAR_GLSL = `vec4 triplanar(sampler2D tile, vec3 p, vec3 n) {
  vec3 w = pow(abs(normalize(n)), vec3(4.0));
  w /= w.x + w.y + w.z;
  return texture2D(tile, p.zy) * w.x + texture2D(tile, p.xz) * w.y + texture2D(tile, p.xy) * w.z;
}`

/**
 * A generated item's colour at a point: its texture where its channel keeps its own colour, and where the player
 * chose another, that colour shaded by the texture's light and dark against the channel's own (the pattern survives
 * a recolour; the hue is the player's). Shared by the classic material (here) and the arena's (characters.ts).
 */
const PRINTED_GLSL = `vec3 printedColor(vec3 tex, vec3 color, vec3 base) {
  vec3 luma = vec3(0.2126, 0.7152, 0.0722);
  float shade = clamp(dot(tex, luma) / max(dot(base, luma), 0.04), 0.0, 2.0);
  return mix(color * shade, tex, 1.0 - step(0.002, distance(color, base)));
}`
