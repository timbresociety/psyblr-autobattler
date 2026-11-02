import * as THREE from 'three'
import type { LookSlot, Worn } from '../../../charter/look.js'
import { bodyBase, shapeBody, type BodyBase, type BodyShape } from '../../../kit/body/shape.js'
import { proportion } from './proportions.js'
import { splitValues } from '../../../kit/body/surface.js'
import { dress, type DressedItem, type Worn as WornItem } from '../../../kit/wear/dress.js'
import { bodyFields, type BodyFields } from '../../../kit/wear/fields.js'
import { linearRgb } from '../../../kit/wear/finish.js'
import { CARD_U, coverOf, type Cover } from '../../../kit/wear/item.js'
import { PRINT_SCALE, drawPrint, inkFor, type PrintId } from '../../../kit/wear/prints.js'
import { bodyKitLoaded } from '../body-kit.js'
import { characterMap, characterNormalMap, GRAIN_GLSL, metaChannel, type CharacterLook } from '../character-look.js'
import { faceShape } from '../face/shape.js'
import { hangPieces, shapedSockets, type Piece } from '../gear.js'
import type { GearSlot } from '../../../charter/look.js'
import { rigCloth } from './cloth-model.js'
import type { LoadedWear } from './items.js'
import { refineGeometry } from '../../../kit/body/refine.js'
import { helperSkin, planHelpers } from '../../../kit/body/helpers.js'
import { bodySpread } from '../../../kit/body/spread.js'
import { meshRest, upgradeRig } from '../metarig/upgrade.js'
import { applyPosture } from '../metarig/posture.js'
import { buildHead } from '../head/build.js'

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
  /**
   * Hair cards drawn as strands over the shell (the creator's close look; the cloth material must draw them, as
   * classicClothMaterial does). Without, they are left off and the shell alone is the hair.
   */
  cards?: boolean
}

/**
 * How dark and how rough a hair shell goes under its cards, so it reads as the depth of the hair between them: dark
 * hair this dark, and light hair, which lets light through to its depths, only UNDER_LIGHT. As dark as dark hair,
 * white hair's depths showed between its strands as grey patches.
 */
const UNDER_CARDS = 0.45
const UNDER_LIGHT = 0.75
/**
 * And how much richer in its own hue: light that went through more hair takes on more of its colour, so a blond's
 * depths go golden brown. Darkened evenly they went olive.
 */
const UNDER_RICHER = 0.6
const UNDER_ROUGH = 0.9
/**
 * How far into the hair's fringe (dress.ts FRINGE, 12 mm) the shell's edge draws back under the cards, as a share of
 * it, cut clean instead of parting into strands: the hairline is then the cards' own roots lying on the skin. Parted
 * there, the shell's strands (which run straight down) met its edge on the slant over each temple in a staircase,
 * and the cards showed it through.
 */
const UNDER_RECEDE = 0.45

/** The items with their hair cards kept, the shell under them darkened, or left off. */
export function withCards(items: DressedItem[], keep: boolean): DressedItem[] {
  return items.map((item) => {
    const card = (v: number) => item.uv[v * 2] > CARD_U
    let has = false
    for (let v = 0; v < item.count && !has; v++) has = card(v)
    if (!has) return item
    if (keep) {
      const color = Float32Array.from(item.color)
      const finish = Float32Array.from(item.finish)
      const weave = Float32Array.from(item.weave)
      for (let v = 0; v < item.count; v++) {
        if (card(v)) continue
        // its ragged edge along the hairline (weave's fraction past HAIR_LOOK's, 0 there) keeps its colour, so what
        // shows of it there reads as more strands, not as a dark fringe
        const fringe = item.weave[v] - 5
        const t = THREE.MathUtils.smoothstep(fringe, 0, 0.8)
        const [r, g, b] = item.color.subarray(v * 3, v * 3 + 3)
        const under = UNDER_CARDS + (UNDER_LIGHT - UNDER_CARDS) * THREE.MathUtils.smoothstep(0.2126 * r + 0.7152 * g + 0.0722 * b, 0.1, 0.6)
        const top = Math.max(r, g, b, 1e-6)
        for (let c = 0; c < 3; c++) color[v * 3 + c] *= 1 - (1 - under * (item.color[v * 3 + c] / top) ** UNDER_RICHER) * t
        finish[v * 4] += (UNDER_ROUGH - finish[v * 4]) * t
        // and draws back: the fringe moves on past 6, which the strands shader cuts at UNDER_RECEDE
        if (fringe >= 0 && fringe < 1) weave[v] = 6 + fringe
      }
      return { ...item, color, finish, weave }
    }
    // left off: their triangles go, and their vertices with them, so twenty heroes don't carry them all
    const kept: number[] = []
    for (let t = 0; t < item.index.length; t += 3) if (!card(item.index[t])) kept.push(item.index[t], item.index[t + 1], item.index[t + 2])
    const at = new Int32Array(item.count).fill(-1)
    const order: number[] = []
    for (const v of kept) if (at[v] < 0) at[v] = order.push(v) - 1
    const pick = <T extends Float32Array | Uint16Array>(values: T, size: number): T => {
      const out = new (values.constructor as new (n: number) => T)(order.length * size)
      order.forEach((v, i) => out.set(values.subarray(v * size, v * size + size), i * size))
      return out
    }
    return {
      ...item,
      count: order.length,
      positions: pick(item.positions, 3),
      normals: pick(item.normals, 3),
      uv: pick(item.uv, 2),
      joints: pick(item.joints, 4),
      weights: pick(item.weights, 4),
      color: pick(item.color, 3),
      finish: pick(item.finish, 4),
      weave: pick(item.weave, 1),
      ...(item.chain ? { chain: pick(item.chain, 3) } : {}),
      index: Uint32Array.from(kept, (v) => at[v]),
    }
  })
}

interface BodyCache {
  base: BodyBase
  fields: BodyFields
  morphs: string[]
  /** Each bone where it stands in the rest pose, in the mesh's own space. */
  rest: Map<string, [number, number, number]>
}

const bodies = new WeakMap<THREE.BufferGeometry, BodyCache>()

/** Brows for a hero with no hair colour: a dark brown. */
const DARK_BROW = new THREE.Color().setStyle('#2b1d14', THREE.SRGBColorSpace)

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
function outfitItems(outfit: Partial<Record<LookSlot, Worn>>, wear: LoadedWear | undefined, vertices: number): { worn: WornItem[]; rigid: Cover[]; textured: Map<string, OwnTexture>; patterns: Map<string, Pattern> } {
  const worn: WornItem[] = []
  const rigid: Cover[] = []
  const textured = new Map<string, OwnTexture>()
  const patterns = new Map<string, Pattern>()
  for (const w of Object.values(outfit)) {
    const loaded = w ? wear?.items.get(w.url) : undefined
    if (!w || !loaded) continue
    if (loaded.kind === 'rigid') {
      if (loaded.meta?.covers.length) rigid.push(coverOf(loaded.meta, vertices))
      continue
    }
    const { item, texture } = loaded
    worn.push({
      item,
      colors: item.meta.channels.map((c, i) => linearRgb(w.colors?.[i] ?? c.color)),
      finishes: item.meta.channels.map((_, i) => w.finishes?.[i] ?? undefined),
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
  for (const t of shown) {
    const v = [index[t * 3], index[t * 3 + 1], index[t * 3 + 2]]
    if (v.every((i) => isSkin[i])) kept.push(...v)
  }
  geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(kept), 1))
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

/**
 * Hang each rigid item on its socket, its first channel tinting the piece's 'primary' material. The sockets move with
 * the hero's shape (`shape`, from the built body's `rest` positions), so glasses sit on the eyes the hero has.
 */
function hangRigid(model: THREE.Object3D, outfit: Partial<Record<LookSlot, Worn>>, wear: LoadedWear, rest: ArrayLike<number>, shaped: ArrayLike<number>): THREE.Object3D[] {
  if (!wear.sockets) return []
  const pieces: Piece[] = []
  for (const [slot, w] of Object.entries(outfit) as [LookSlot, Worn][]) {
    const loaded = wear.items.get(w.url)
    const socket = (loaded?.kind === 'rigid' && (loaded.meta?.socket as GearSlot | undefined)) || SOCKET[slot]
    if (loaded?.kind !== 'rigid' || !socket) continue
    pieces.push({ name: slot, socket, file: loaded.file, ...(w.colors?.[0] ? { color: w.colors[0] } : {}) })
  }
  return pieces.length ? hangPieces(model, pieces, shapedSockets(wear.sockets, rest, shaped)) : []
}

/**
 * Dress a cloned body (from SkeletonUtils.clone) for one hero. Returns false for a model that isn't one of the bodies,
 * which then draws as its file made it. `refine` splits the body's triangles that many times over for a close look
 * (src/kit/body/refine.ts): the creator's studio, not the arena.
 */
export function dressModel(model: THREE.Object3D, look: CharacterLook, wear: LoadedWear | undefined, materials: WearMaterials, atlas?: THREE.Texture | null, refine = 0): boolean {
  const mesh = bodyMesh(model)
  if (!mesh || !onSharedSurface(mesh)) return false
  const cache = bodyCache(mesh)
  const kit = bodyKitLoaded(look.build)
  const face = faceShape(look.face, look.sculpt, look.build, kit, cache.base.positions)
  // the physique's weight, muscle and age in the morphs and its Volume dials sculpted on, then its proportions on the
  // skeleton's rest; then the metarig (GAME.md §9.2): helpers placed and weighted on this body, before the clothes copy
  // its skin, so they swell with it
  const gender = look.build.startsWith('f') ? 'f' : 'm'
  const fileSkeleton = { bones: mesh.skeleton.bones.map((b) => b.name), rest: Object.fromEntries(cache.rest) }
  const proportioned = proportion(mesh, shapeBody(cache.base, cache.morphs, look.physique, face, { skeleton: fileSkeleton, gender }), look.physique)
  const restNow = meshRest(mesh)
  const plans = planHelpers(proportioned, restNow)
  const helped = helperSkin(proportioned, restNow, plans)
  const shape = { ...proportioned, joints: helped.joints, weights: helped.weights }
  const metarig = upgradeRig(model, mesh, plans)
  metarig.spread = bodySpread(proportioned, restNow)
  model.userData.metarig = metarig
  applyPosture(model, look.physique)
  const { worn, rigid, textured, patterns } = outfitItems(look.outfit, wear, cache.base.surface.count)
  const dressed = dress({ body: shape, fields: cache.fields, worn, rigid })
  // dev probe: what the dresser kept, to check against the fit tool's report (window.__dressed)
  if (typeof window !== 'undefined') (window as unknown as { __dressed?: unknown }).__dressed = { items: dressed.items.map((i) => ({ id: i.id, tris: i.index.length / 3 })), body: dressed.body.length, total: shape.surface.triangles.length / 3 }
  const items = withCards(dressed.items, materials.cards ?? false)
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
  // the head as its own object (GAME.md §9.1): its triangles leave the body's, it brings its eyes, teeth and face shapes
  if (wear?.head && kit?.faceScale) {
    const brow = look.outfit.hair?.colors?.[0]
    model.userData.head = buildHead({
      model,
      mesh,
      body: shape,
      kit: wear.head,
      faceScale: kit.faceScale,
      iris: look.colors.iris,
      white: look.colors.eye,
      brow: brow ? new THREE.Color().setStyle(brow, THREE.SRGBColorSpace) : DARK_BROW,
      full: refine > 0,
      refine,
    })
  }
  if (refine) mesh.geometry = refineGeometry(mesh.geometry, refine)
  const parts = drawn(items, textured)
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
  if (wear) hangRigid(model, look.outfit, wear, cache.base.positions, shape.positions)
  return true
}

/**
 * Hair strands (weave 5), drawn without UVs: on a head, the way a surface faces round the vertical axis holds steady
 * down a strand and turns across them, so locks, clumps and fine strands laid round that angle run from the crown down
 * to the hairline, wavering a little as they fall. Whole cells round the circle, so the back of the head shows no seam.
 * Each strand lightens or darkens the colour and roughens or smooths the highlight, the grooves between the locks sit
 * in shade, and the locks bump the surface (hairRelief, applied with leather's relief once the normal is known). Toward
 * the hair's edge (the fraction past 5) the strands part, each ending at its own distance, so the skin shows through a
 * ragged hairline instead of the mesh's cut edge. A pattern whose cells cross a pixel in under two fades to its mean
 * there, where it would only alias into bands; the turn's seam is stepped over by measuring on its far side.
 */
const STRANDS_GLSL = `
float turn = atan(vStrandNormal.x, vStrandNormal.z) / 6.2831853 + 0.5;
float turnStep = min(fwidth(turn), fwidth(fract(turn + 0.5)));
float wave = 0.15 * sin(vStrandY * 34.0 + turn * 31.4159265);
// under cards, where strands are laid by place (below): across the head, and level slices tipped toward the nape
float slice = vRest.y - 0.65 * vRest.z;
float sliceStep = fwidth(slice);
float acrossStep = fwidth(vRest.x);
float hairRelief = 0.0;
if (vCardUv.x > 1.5) roughnessFactor = mix(0.6, 0.75, cardShade);
else if (vWeave > 4.5) {
  float clump = mix(0.5, strandNoise(turn * 96.0 + wave, 96.0), 1.0 - smoothstep(0.25, 0.5, turnStep * 96.0));
  float fine = mix(0.5, strandNoise(turn * 433.0 + wave * 3.0, 433.0), 1.0 - smoothstep(0.25, 0.5, turnStep * 433.0));
  float lock = strandNoise(turn * 40.0 + wave * 0.6, 40.0);
  if (vWeave > 5.995) {
    // under a hair's cards its fringe runs on past 6 (withCards), and its edge draws back under their roots: cut at
    // UNDER_RECEDE, and feathered over the half centimetre inside it (edgeA, below), so the skin shows through the
    // strands at the hairline the way it does between the cards' roots
    if (vWeave - 6.0 < ${UNDER_RECEDE} * 0.6) discard;
    // and its strands run with the cards' (wardrobe.py hair_cards, runs), laid by place: straight back over the top and
    // down the back, and at the sides back and a little down, along level slices tipped toward the nape. Laid round the
    // way the surface faces, as on a shell alone, they ran from the crown straight down at the sides, and on a shell
    // rising out of the skin unevenly, they zigzagged into chevrons over the temples and broke into facets on top
    float side = smoothstep(0.035, 0.065, abs(vRest.x));
    float sideWave = 0.15 * sin(vRest.z * 40.0);
    float topWave = 0.15 * sin(vRest.y * 34.0 + vRest.z * 20.0);
    clump = mix(strandSeen(vRest.x * 160.0 + topWave, acrossStep * 160.0), strandSeen(slice * 140.0 + sideWave, sliceStep * 140.0), side);
    fine = mix(strandSeen(vRest.x * 700.0 + topWave * 3.0, acrossStep * 700.0), strandSeen(slice * 600.0 + sideWave * 3.0, sliceStep * 600.0), side);
    lock = mix(strandNoise(vRest.x * 67.0 + topWave * 0.6, 4096.0), strandNoise(slice * 56.0 + sideWave * 0.6, 4096.0), side);
    float recede = clamp((vWeave - 6.0 - ${UNDER_RECEDE} * 0.6) / (${UNDER_RECEDE} * 0.8), 0.0, 1.0);
    float edgeA = smoothstep(0.0, 1.0, recede * 1.3 + (0.5 - fine) * 0.5 + (0.5 - clump) * 0.4);
    if (edgeA < 0.03) discard;
    diffuseColor.a = edgeA;
  } else {
    float fringe = clamp((vWeave - 5.0) / 0.99, 0.0, 1.0);
    if (fine * 0.8 + clump * 0.2 > fringe * 0.9 + 0.35) discard;
  }
  diffuseColor.rgb *= mix(0.76, 1.06, lock) * mix(0.72, 1.12, clump) * mix(0.88, 1.06, fine);
  roughnessFactor = clamp(roughnessFactor + (0.5 - clump) * 0.22 + (0.5 - fine) * 0.1, 0.2, 1.0);
  hairRelief = lock * 0.0035 + clump * 0.0008;
}`

/**
 * Leather (weave 4), drawn without UVs on where the cloth sits on the body at rest: a pebbled grain two millimetres
 * across, a soft swell a couple of centimetres across where the hide doesn't lie quite flat, and broad patches worn
 * a little smoother or drier. They bump the surface by their slope in metres, so the relief holds its depth at any
 * distance, and the jacket catches light the way hide does instead of in one smooth sweep like vinyl. The grain fades
 * out where its cells shrink under a couple of pixels (a hero seen whole), where it would only shimmer. Hair's locks
 * (STRANDS_GLSL) bump the same way.
 */
const LEATHER_GLSL = `
float relief = hairRelief;
vec3 at = vRest * 520.0;
float seen = 1.0 - smoothstep(0.6, 1.2, length(fwidth(at)));
if (vWeave > 3.5 && vWeave < 4.5) {
  float grain = grainNoise(at);
  float worn = grainNoise(vRest * 9.0 + 17.0);
  roughnessFactor = clamp(roughnessFactor + 0.06 + (worn - 0.5) * 0.3 + (grain - 0.5) * 0.16 * seen, 0.2, 0.95);
  relief = grain * 0.0003 * seen + grainNoise(vRest * 38.0 + 5.0) * 0.0022;
}
// a triangle carries one weave, and a pixel's neighbours in the derivatives come from its own triangle
float reliefX = dFdx(relief);
float reliefY = dFdy(relief);
if (vWeave > 3.5) normal = grainNormal(-vViewPosition, normal, reliefX, reliefY, faceDirection);`

/**
 * A hair card (u past 1.5, tools/blender/wardrobe.py hair_cards): five clumps of strands across it, each its own
 * width, shade, start and length, thinning to its tip and fewer toward the card's long edges, so neither its root nor
 * its sides show as a straight cut. The gaps between them are see-through: its alpha, which the material turns into
 * coverage across the pixel's samples, so the strands' edges stay smooth without sorting. The hair darkens toward the
 * roots, where less light gets in.
 */
const CARD_GLSL = `
const float CARD_CLUMPS = 5.0;
float cardShade = 0.5;
// how squarely a card faces the eye, and how nearly its strands run straight at it (vStrandFlow): there (over the
// crown from the front, say) its clumps shrink to dashes while the gaps between them stay whole, so they widen until
// they close the gaps
vec3 cardEye = normalize(vViewPosition);
float cardFacing = abs(dot(normalize(vNormal), cardEye));
float cardFill = smoothstep(0.5, 0.85, abs(dot(normalize(vStrandFlow), cardEye)));
if (vCardUv.x > 1.5) {
  // past 2, a whole number: the card's seed (0 to 63), plus 64 for every 5 mm of its length (wardrobe.py hair_cards)
  float cardCode = floor(vCardUv.x) - 2.0;
  float cardSeed = 2.0 + mod(cardCode, 64.0);
  float cardLength = floor(cardCode / 64.0) * 0.005;
  // each strand starts up to 6 mm along the card and comes in over a centimetre, darker for its first one and a half,
  // so hair thickens over a centimetre or two from the hairline whatever the card's length. As shares of the card, a
  // swept card's took up to 5 cm and left a grey band over the temples (cards built before carry no length: shares)
  float rootFrom = cardLength > 0.0 ? 0.006 / cardLength : 0.1;
  float rootIn = cardLength > 0.0 ? 0.01 / cardLength : 0.25;
  float rootDark = cardLength > 0.0 ? 0.015 / cardLength : 0.35;
  float along = vCardUv.y;
  float k = fract(vCardUv.x) * CARD_CLUMPS;
  float cell = floor(k);
  float cover = 0.0;
  for (int j = -1; j <= 1; j++) {
    float c = cell + float(j);
    float h1 = strandHash(cardSeed * 7.13 + c * 1.31);
    float h2 = strandHash(cardSeed * 3.77 + c * 2.91 + 0.5);
    float h3 = strandHash(cardSeed * 5.21 + c * 0.73 + 0.25);
    float h4 = strandHash(cardSeed * 1.93 + c * 3.37 + 0.75);
    float end = 0.5 + 0.5 * h3;
    float start = rootFrom * h4;
    float reach = mix(0.3 + 0.3 * h2, 0.8, cardFill) * (1.0 - 0.6 * smoothstep(0.0, end, along));
    float a = (1.0 - smoothstep(reach * 0.5, reach, abs(k - c - 0.5 - (h1 - 0.5) * 0.5))) * smoothstep(start, start + rootIn, along) * (1.0 - smoothstep(end - 0.1, end, along));
    if (a > cover) {
      cover = a;
      cardShade = h2;
    }
  }
  // and thins out toward the card's long edges, so no strand is cut along them, and fades seen edge-on, where the
  // shell under it holds the shape
  float sides = smoothstep(0.0, 1.2, k) * smoothstep(CARD_CLUMPS, CARD_CLUMPS - 1.2, k) * smoothstep(0.1, 0.35, cardFacing);
  cover *= sides;
  // seen from further off, where its clumps cross a pixel in under two, the card reads as one lock of hair, with its
  // own soft root and tip, not as a flicker of strands
  float sheet = 0.8 * sides * smoothstep(rootFrom * 0.5, rootFrom * 0.5 + rootIn, along) * (1.0 - smoothstep(0.65, 0.95, along));
  float far = smoothstep(0.5, 1.0, fwidth(k));
  cover = mix(cover, sheet, far);
  cardShade = mix(cardShade, 0.5, far);
  if (cover < 0.02) discard;
  diffuseColor.a = cover;
  // darker at its root, but only a little: every card in the layers over the shell has one, and seen together as
  // bands across the hair they read as stripes, not as roots
  diffuseColor.rgb *= mix(0.84, 1.0, smoothstep(0.0, rootDark, along)) * mix(0.86, 1.12, cardShade);
}`

/**
 * The way a hair card's strands run, in view space, for its highlights (used on cards alone, hairCard): from tip to
 * root, as the highlights' shifts were set. It comes smooth from the vertices (vStrandFlow). Worked out per triangle
 * from the screen derivatives, each centimetre of a card bent round a temple caught its highlight as one flat plate,
 * and they stacked into steps.
 */
const CARD_TANGENT_GLSL = `
hairTangent = -normalize(vStrandFlow);
hairCard = step(1.5, vCardUv.x);
hairShade = cardShade;`

/**
 * Direct light on a hair card, on top of three's: two highlights that run across the strands (Kajiya and Kay's, as
 * Scheuermann shifts them), a sharp white one from the hair's surface and a broader one in the hair's own colour from
 * light that went through a strand and back. Each strand catches them a little more or less (hairShade).
 */
const HAIR_LIGHT_GLSL = `vec3 hairTangent = vec3(0.0, 1.0, 0.0);
float hairCard = 0.0;
float hairShade = 0.5;
float strandSpecular(const in vec3 t, const in vec3 n, const in vec3 h, const in float shift, const in float sharp) {
  vec3 ts = normalize(t + n * shift);
  float th = dot(ts, h);
  return pow(sqrt(max(0.0, 1.0 - th * th)), sharp) * smoothstep(-1.0, 0.0, th);
}
void RE_Direct_Hair(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
  RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
  if (hairCard < 0.5) return;
  vec3 h = normalize(directLight.direction + geometryViewDir);
  float lit = saturate(dot(geometryNormal, directLight.direction) * 0.6 + 0.4);
  float catchLight = mix(0.7, 1.2, hairShade);
  float sharp = strandSpecular(hairTangent, geometryNormal, h, -0.08, 70.0);
  float broad = strandSpecular(hairTangent, geometryNormal, h, 0.12, 22.0);
  reflectedLight.directSpecular += directLight.color * lit * catchLight * (vec3(sharp * 0.1) + broad * 0.35 * material.diffuseColor);
}
#undef RE_Direct
#define RE_Direct RE_Direct_Hair`

const STRAND_NOISE_GLSL = `
varying float vWeave;
varying vec3 vStrandNormal;
varying float vStrandY;
varying vec3 vRest;
varying vec3 vStrandFlow;
${GRAIN_GLSL}
float strandHash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
// value noise along x, repeating every period cells
float strandNoise(float x, float period) {
  float i = floor(x);
  float f = fract(x);
  return mix(strandHash(mod(i, period)), strandHash(mod(i + 1.0, period)), f * f * (3.0 - 2.0 * f));
}
// and faded to its mean where its cells cross a pixel in under two (\`cells\`: how many cross one), where it would only
// alias into bands
float strandSeen(float x, float cells) { return mix(0.5, strandNoise(x, 4096.0), 1.0 - smoothstep(0.25, 0.5, cells)); }`

/**
 * The way hair runs where its surface faces n, at rest: tools/blender/wardrobe.py hair_cards' flow, in glTF's axes. Up
 * and back over the brow, straight back over the crown, back and down at the sides. A card's strands run along it
 * (less the few degrees each card is turned), so it gives their direction smooth from vertex to vertex.
 */
const HAIR_FLOW_GLSL = `
varying vec3 vStrandFlow;
vec3 hairFlow(vec3 n) {
  vec3 along = cross(n, vec3(1.0, 0.0, 0.0));
  vec3 d = vec3(0.0, -0.65, -1.0);
  d -= n * dot(d, n);
  if (length(along) < 1e-6) return length(d) < 1e-6 ? vec3(0.0, -1.0, 0.0) : normalize(d);
  if (length(d) < 1e-6) return normalize(along);
  vec3 f = mix(normalize(along), normalize(d), smoothstep(0.0, 1.0, (abs(n.x) - 0.35) / 0.45));
  return length(f) > 1e-6 ? normalize(f) : vec3(0.0, -1.0, 0.0);
}`

/** The finish read per vertex from _finish: roughness, metalness, a cloth sheen toward the silhouette, and glow; hair's strands and leather's grain. */
function finishShader(shader: { vertexShader: string; fragmentShader: string }) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\nattribute vec4 _finish;\nvarying vec4 vFinish;\nattribute float _weave;\nvarying float vWeave;\nvarying vec3 vStrandNormal;\nvarying float vStrandY;\nvarying vec3 vRest;\nvarying vec2 vCardUv;\n${HAIR_FLOW_GLSL}`)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFinish = _finish;\nvWeave = _weave;\nvStrandNormal = normal;\nvStrandY = position.y;\nvRest = position;\nvCardUv = uv;')
    // the flow turns with the bone the hair rides, like its normal
    .replace(
      '#include <defaultnormal_vertex>',
      '#include <defaultnormal_vertex>\nvec3 strandFlow = hairFlow(normal);\n#ifdef USE_SKINNING\nstrandFlow = (skinMatrix * vec4(strandFlow, 0.0)).xyz;\n#endif\nvStrandFlow = normalize(mat3(modelViewMatrix) * strandFlow);',
    )
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nvarying vec4 vFinish;\nvarying vec2 vCardUv;\n${STRAND_NOISE_GLSL}`)
    .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>\n${CARD_GLSL}`)
    .replace('#include <roughnessmap_fragment>', `float roughnessFactor = vFinish.x;\n${STRANDS_GLSL}`)
    .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vFinish.y;')
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${LEATHER_GLSL}\n${CARD_TANGENT_GLSL}`)
    .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${HAIR_LIGHT_GLSL}`)
    .replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\nfloat grazing = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);\ntotalEmissiveRadiance += diffuseColor.rgb * (vFinish.w + vFinish.z * 0.3 * grazing);',
    )
    // a glowing channel shows its own colour, dimming toward its edges: lit and then tone mapped, a bright saturated
    // green comes out pale lime
    .replace('#include <tonemapping_fragment>', '#include <tonemapping_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, diffuseColor.rgb * (1.0 - 0.35 * grazing), vFinish.w);')
}

/**
 * The classic (WebGL) outfit material for the previews and busts: vertex colours, with roughness, metalness, a cloth
 * sheen toward the silhouette and glow read per vertex from _finish. With a map, a generated item's texture in place
 * of its channels' colours, recoloured where the player chose another (printedColor).
 */
export function classicClothMaterial(map?: THREE.Texture): THREE.MeshStandardMaterial {
  // hair cards' strands set their alpha: as coverage across the samples, opaque cloth (alpha 1) is drawn as before
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, alphaToCoverage: true, ...(map ? { map } : {}) })
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
