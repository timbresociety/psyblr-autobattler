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
  /** Per file vertex. */
  positions: Float32Array
  joints: Uint16Array | Uint8Array
  weights: Float32Array
  /** Morph target position deltas per file vertex, in file order. */
  morphs: Float32Array[]
  bones: string[]
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
  return {
    surface: weldSurface(array(p, '_VID'), p.getIndices()!.getArray()!),
    positions: Float32Array.from(array(p, 'POSITION')),
    joints: array(p, 'JOINTS_0') as Uint16Array | Uint8Array,
    weights: Float32Array.from(array(p, 'WEIGHTS_0')),
    morphs: p.listTargets().map((t) => Float32Array.from(t.getAttribute('POSITION')!.getArray()!)),
    bones: root.listSkins()[0]?.listJoints().map((j) => j.getName()) ?? [],
    clips: root.listAnimations().map((a) => a.getName()),
  }
}
