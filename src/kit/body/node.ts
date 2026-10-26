import { readFileSync } from 'node:fs'
import { NodeIO, type Primitive } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { weldSurface, type BodySurface } from './surface.js'

/**
 * Reading body files in Node (tests and tools/wardrobe): the skinned mesh's raw arrays and its welded surface, without
 * three.js.
 */
export interface BodyFile {
  surface: BodySurface
  /** The file's own vertex order: welded index per vertex, and the index buffer. */
  vid: Float32Array
  index: Uint32Array
  /** Per file vertex. */
  positions: Float32Array
  joints: Uint16Array | Uint8Array
  weights: Float32Array
  /** Morph target position deltas per file vertex, in file order. */
  morphs: Float32Array[]
  bones: string[]
  /** Each bone's rest position (glTF axes), from the skin's inverse bind matrices. */
  rest: Record<string, [number, number, number]>
  clips: string[]
}

let io: Promise<NodeIO> | undefined

function reader(): Promise<NodeIO> {
  io ??= MeshoptDecoder.ready.then(() => new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }))
  return io
}

function array(p: Primitive, semantic: string) {
  const a = p.getAttribute(semantic)
  if (!a) throw new Error(`body file has no ${semantic}`)
  return a.getArray()!
}

export async function readBody(path: string | URL): Promise<BodyFile> {
  const doc = await (await reader()).readBinary(new Uint8Array(readFileSync(path)))
  const root = doc.getRoot()
  const prims = root.listMeshes().flatMap((m) => m.listPrimitives())
  if (prims.length !== 1) throw new Error(`a body file has one primitive, this one ${prims.length}`)
  const p = prims[0]
  const skin = root.listSkins()[0]
  const joints = skin?.listJoints() ?? []
  const inverse = skin?.getInverseBindMatrices()?.getArray()
  const rest: BodyFile['rest'] = {}
  joints.forEach((j, i) => {
    if (!inverse) return
    const m = Array.from(inverse.slice(i * 16, i * 16 + 16))
    rest[j.getName()] = invertTranslation(m)
  })
  const vid = Float32Array.from(array(p, '_VID'))
  const index = Uint32Array.from(p.getIndices()!.getArray()!)
  return {
    surface: weldSurface(vid, index),
    vid,
    index,
    positions: Float32Array.from(array(p, 'POSITION')),
    joints: array(p, 'JOINTS_0') as Uint16Array | Uint8Array,
    weights: Float32Array.from(array(p, 'WEIGHTS_0')),
    morphs: p.listTargets().map((t) => Float32Array.from(t.getAttribute('POSITION')!.getArray()!)),
    bones: joints.map((j) => j.getName()),
    rest,
    clips: root.listAnimations().map((a) => a.getName()),
  }
}

/** Where an inverse bind matrix (column-major) puts its bone: the translation of its inverse. */
function invertTranslation(m: number[]): [number, number, number] {
  // a rigid inverse bind matrix: the rotation's transpose takes the translation back
  const [r00, r10, r20, , r01, r11, r21, , r02, r12, r22, , tx, ty, tz] = m
  return [-(r00 * tx + r10 * ty + r20 * tz), -(r01 * tx + r11 * ty + r21 * tz), -(r02 * tx + r12 * ty + r22 * tz)]
}
