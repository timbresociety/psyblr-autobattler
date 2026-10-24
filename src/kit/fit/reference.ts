import { readFileSync } from 'node:fs'
import type { BodySockets } from '../../arena/client/gear.js'
import { readBody } from '../body/node.js'
import { bodyBase, shapeBody, type BodyShape } from '../body/shape.js'
import { TriangleGrid, type SurfaceShape } from '../wear/bind.js'
import { bodyFields, type BodyFields } from '../wear/fields.js'
import { skinShape } from './shell.js'
import { TriangleBVH, type V3 } from '../wear/ray.js'

/**
 * The body every item is fitted on: the medium male body as built, with no physique and no face of its own. Items
 * bind to its skin, measure their covers off it, and are checked against it; one file then fits every body, since
 * all twelve share its surface.
 */
export const REFERENCE_BODY = 'm-medium'

export interface Reference {
  shape: BodyShape
  /** Skin triangles only: nothing binds to the eyes. */
  skin: SurfaceShape
  grid: TriangleGrid
  /** Over the skin triangles. */
  bvh: TriangleBVH
  fields: BodyFields
  bones: string[]
  rest: Record<string, V3>
  sockets?: BodySockets
}

export async function readReference(glb: string | URL, kit?: string | URL): Promise<Reference> {
  const f = await readBody(glb)
  const sidecar = kit ? (JSON.parse(readFileSync(kit, 'utf8')) as { morphs?: string[]; sockets?: BodySockets }) : undefined
  const base = bodyBase({ vid: f.vid, index: f.index, positions: f.positions, morphs: f.morphs, joints: f.joints, weights: f.weights })
  const shape = shapeBody(base, sidecar?.morphs ?? [])
  const skin = skinShape(shape)
  return {
    shape,
    skin,
    grid: new TriangleGrid(skin),
    bvh: new TriangleBVH(skin.positions, skin.triangles),
    fields: bodyFields({ positions: shape.positions, joints: shape.joints, weights: shape.weights, bones: f.bones, rest: (b) => f.rest[b] }),
    bones: f.bones,
    rest: f.rest,
    ...(sidecar?.sockets ? { sockets: sidecar.sockets } : {}),
  }
}

/** How much welded vertex v's skin leans on any of `bones`. */
export function leanOn(ref: Reference, v: number, bones: readonly string[]): number {
  let w = 0
  for (let k = 0; k < 4; k++) if (bones.includes(ref.bones[ref.shape.joints[v * 4 + k]])) w += ref.shape.weights[v * 4 + k]
  return w
}
