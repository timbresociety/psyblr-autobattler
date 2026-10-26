import { bindPoints, toLocal, TriangleGrid, type SurfaceShape } from '../wear/bind.js'
import type { ItemChannel, ItemMeta, ItemSlot, Knob, SurfaceItem } from '../wear/item.js'
import type { BodyShape } from '../body/shape.js'

/**
 * A skin-tight item grown straight off the body: the skin triangles a selection keeps, lifted out along the normals.
 * Bodysuits, leggings and socks are made this way, and tests use it as an item whose right answer is known.
 */
export interface ShellSpec {
  id: string
  slot: ItemSlot
  /** Which welded vertices the item covers. */
  select: (vid: number) => boolean
  /** How far out from the skin, in metres. */
  lift: number
  channels?: ItemChannel[]
  knobs?: Knob[]
  hides?: boolean
}

/** The skin's triangles alone, for binding: nothing binds to the eyes. */
export function skinShape(body: BodyShape): SurfaceShape {
  const t = body.surface.triangles
  const tris: number[] = []
  for (let i = 0; i < t.length; i += 3) if (body.skin[t[i]] && body.skin[t[i + 1]] && body.skin[t[i + 2]]) tris.push(t[i], t[i + 1], t[i + 2])
  return { positions: body.positions, normals: body.normals, triangles: Uint32Array.from(tris) }
}

export function shellItem(body: BodyShape, spec: ShellSpec): SurfaceItem & { positions: Float32Array } {
  const shape = skinShape(body)
  const T = shape.triangles
  const of = new Map<number, number>()
  const vids: number[] = []
  const index: number[] = []
  for (let i = 0; i < T.length; i += 3) {
    const tri = [T[i], T[i + 1], T[i + 2]]
    if (!tri.every(spec.select)) continue
    for (const v of tri) {
      if (!of.has(v)) {
        of.set(v, vids.length)
        vids.push(v)
      }
      index.push(of.get(v)!)
    }
  }
  const n = vids.length
  const positions = new Float32Array(n * 3)
  const normals = new Float32Array(n * 3)
  vids.forEach((v, i) => {
    for (let d = 0; d < 3; d++) {
      normals[i * 3 + d] = body.normals[v * 3 + d]
      positions[i * 3 + d] = body.positions[v * 3 + d] + spec.lift * body.normals[v * 3 + d]
    }
  })
  const binding = bindPoints(positions, shape, new TriangleGrid(shape))
  const covers = [...new Set(vids)].sort((a, b) => a - b)
  const tenths = Math.round(spec.lift * 1e4)
  const meta: ItemMeta = {
    format: 'psyblr-wear',
    version: 1,
    id: spec.id,
    name: spec.id,
    slot: spec.slot,
    mode: 'surface',
    hides: spec.hides ?? true,
    channels: spec.channels ?? [{ name: 'main', color: '#808080', finish: 'cotton' }],
    knobs: spec.knobs ?? [],
    covers,
    shell: covers.flatMap(() => [tenths, tenths]),
  }
  return {
    meta,
    count: n,
    index: Uint32Array.from(index),
    binding,
    normal: toLocal(binding, shape, normals),
    uv: new Float32Array(n * 2),
    channel: new Uint8Array(n),
    positions,
  }
}
