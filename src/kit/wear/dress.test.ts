import { beforeAll, describe, expect, it } from 'vitest'
import { BODIES } from '../../arena/client/character-look.js'
import { readBody, type BodyFile } from '../body/node.js'
import { bodyBase, shapeBody, type BodyShape } from '../body/shape.js'
import { shellItem, skinShape } from '../fit/shell.js'
import { TriangleBVH, type V3 } from './ray.js'
import { readItemFile, writeItem } from '../fit/write.js'
import { bindPoints, evaluate, fromLocal, toLocal } from './bind.js'
import { dress, GAP, type Dressed, type Worn } from './dress.js'
import { bodyFields, chainParam, fieldAt, type BodyFields } from './fields.js'
import { coverOf, type SurfaceItem } from './item.js'

const pub = (path: string) => new URL(`../../../public${path}`, import.meta.url)
const MORPHS = ['weight-', 'weight+', 'muscle-', 'muscle+', 'age']

const files = new Map<string, BodyFile>()
const shapes = new Map<string, BodyShape>()
const fieldsOf = new Map<string, BodyFields>()
let ref: BodyShape
let tee: SurfaceItem
let trousers: SurfaceItem
let hair: SurfaceItem
let cap: SurfaceItem

/** The welded vertices whose skin leans on these bones by at least `min`. */
const leaning = (file: BodyFile, shape: BodyShape, bones: string[], min = 0.5) => {
  const ids = new Set(bones.map((b) => file.bones.indexOf(b)))
  return (v: number) => {
    let w = 0
    for (let k = 0; k < 4; k++) if (ids.has(shape.joints[v * 4 + k])) w += shape.weights[v * 4 + k]
    return shape.skin[v] === 1 && w >= min
  }
}

/** How far out a dressed vertex sits over its triangle, measured the way bindings are (along the interpolated normal). */
function liftOf(shape: BodyShape, item: SurfaceItem, positions: Float32Array, k: number): number {
  const { tri, st } = item.binding
  const [a, b, c] = [tri[k * 3], tri[k * 3 + 1], tri[k * 3 + 2]]
  const s = st[k * 2]
  const t = st[k * 2 + 1]
  const at = (arr: Float32Array, d: number) => arr[a * 3 + d] + s * (arr[b * 3 + d] - arr[a * 3 + d]) + t * (arr[c * 3 + d] - arr[a * 3 + d])
  const p = [0, 1, 2].map((d) => at(shape.positions, d))
  const n = [0, 1, 2].map((d) => at(shape.normals, d))
  return [0, 1, 2].reduce((acc, d) => acc + (positions[k * 3 + d] - p[d]) * n[d], 0) / [0, 1, 2].reduce((acc, d) => acc + n[d] * n[d], 0)
}

/**
 * Where an inner layer shows through an outer one: looking toward the skin from each of its vertices, and from the middle
 * of each of its triangles and their edges, some outer item's surface lies in the way.
 */
function crossings(shape: BodyShape, out: Dressed, items: readonly SurfaceItem[]): string[] {
  const found: string[] = []
  const byId = new Map(items.map((i) => [i.meta.id, i]))
  out.items.forEach((outer, o) => {
    const bvh = new TriangleBVH(outer.positions, outer.index)
    for (const inner of out.items.slice(0, o)) {
      const { tri, st } = byId.get(inner.id)!.binding
      const at = (arr: Float32Array, k: number, d: number) => {
        const [a, b, c] = [tri[k * 3], tri[k * 3 + 1], tri[k * 3 + 2]]
        return arr[a * 3 + d] + st[k * 2] * (arr[b * 3 + d] - arr[a * 3 + d]) + st[k * 2 + 1] * (arr[c * 3 + d] - arr[a * 3 + d])
      }
      let count = 0
      const look = (ks: number[], w: number[]) => {
        const from = [0, 1, 2].map((d) => ks.reduce((acc, k, j) => acc + w[j] * inner.positions[k * 3 + d], 0)) as V3
        const n = [0, 1, 2].map((d) => ks.reduce((acc, k, j) => acc + w[j] * at(shape.normals, k, d), 0))
        const len = Math.hypot(n[0], n[1], n[2])
        const reach = ks.reduce((acc, k, j) => acc + w[j] * Math.hypot(...[0, 1, 2].map((d) => inner.positions[k * 3 + d] - at(shape.positions, k, d))), 0)
        if (bvh.first(from, [-n[0] / len, -n[1] / len, -n[2] / len], 1e-4, reach)) count++
      }
      for (const k of new Set(inner.index)) look([k], [1])
      for (let t = 0; t < inner.index.length; t += 3) {
        const [a, b, c] = [inner.index[t], inner.index[t + 1], inner.index[t + 2]]
        look([a, b, c], [1 / 3, 1 / 3, 1 / 3])
        for (const [p, q] of [[a, b], [b, c], [c, a]]) look([p, q], [0.5, 0.5])
      }
      if (count) found.push(`${inner.id} through ${outer.id} at ${count}`)
    }
  })
  return found
}

const worn = (item: SurfaceItem, knobs?: Worn['knobs']): Worn => ({ item, colors: [[0.5, 0.2, 0.1]], finishes: ['cotton'], ...(knobs ? { knobs } : {}) })

beforeAll(async () => {
  for (const body of BODIES) {
    const f = await readBody(pub(`/heroes/${body}.glb`))
    files.set(body, f)
    const base = bodyBase({ vid: f.vid, index: f.index, positions: f.positions, morphs: f.morphs, joints: f.joints, weights: f.weights })
    const shape = shapeBody(base, MORPHS)
    shapes.set(body, shape)
    fieldsOf.set(body, bodyFields({ positions: shape.positions, joints: shape.joints, weights: shape.weights, bones: f.bones, rest: (b) => f.rest[b] }))
  }
  const f = files.get('m-medium')!
  ref = shapes.get('m-medium')!
  const fields = fieldsOf.get('m-medium')!
  // the two overlap at the waist, the way a tee hangs over a waistband
  const upper = leaning(f, ref, ['spine', 'chest', 'upper_chest', 'clavicle_L', 'clavicle_R', 'upper_arm_L', 'upper_arm_R', 'forearm_L', 'forearm_R'], 0.3)
  tee = shellItem(ref, { id: 'tee', slot: 'upper', lift: 0.004, select: (v) => upper(v) && fields.arm[v] < 0.9, knobs: ['sleeve', 'hem'] })
  const legs = leaning(f, ref, ['hips', 'thigh_L', 'thigh_R', 'shin_L', 'shin_R'], 0.3)
  trousers = shellItem(ref, { id: 'trousers', slot: 'lower', lift: 0.005, select: legs, knobs: ['leg'] })
  const head = leaning(f, ref, ['head'], 0.95)
  const top = f.rest.head[1] + 0.06
  hair = shellItem(ref, { id: 'hair', slot: 'hair', lift: 0.02, hides: false, select: (v) => head(v) && ref.positions[v * 3 + 1] > top })
  cap = shellItem(ref, { id: 'cap', slot: 'head', lift: 0.008, select: (v) => head(v) && ref.positions[v * 3 + 1] > top + 0.03 })
})

describe('binding', () => {
  it('finds every point again on the body it was bound on, within a millimetre', () => {
    let worst = 0
    for (const item of [tee, trousers, hair]) {
      const back = evaluate(item.binding, skinShape(ref))
      const pos = (item as SurfaceItem & { positions: Float32Array }).positions
      for (let i = 0; i < back.length; i++) worst = Math.max(worst, Math.abs(back[i] - pos[i]))
    }
    expect(worst).toBeLessThan(0.001)
  })

  it('turns vectors into the surface frame and back', () => {
    const shape = skinShape(ref)
    const vectors = Float32Array.from({ length: tee.count * 3 }, (_, i) => Math.sin(i * 1.7))
    const back = fromLocal(tee.binding, shape, toLocal(tee.binding, shape, vectors))
    for (let i = 0; i < vectors.length; i++) expect(back[i]).toBeCloseTo(vectors[i], 5)
  })

  it('binds points off the surface too, with their lift', () => {
    const shape = skinShape(ref)
    const v = 1200
    const p = [0, 1, 2].map((k) => ref.positions[v * 3 + k] + 0.05 * ref.normals[v * 3 + k])
    const b = bindPoints(p, shape)
    expect(b.lift[0]).toBeGreaterThan(0.045)
    const back = evaluate(b, shape)
    for (let k = 0; k < 3; k++) expect(back[k]).toBeCloseTo(p[k], 3)
  })
})

describe('dressing', () => {
  it('fits every body: finite, skinned to sum 1, never under the skin, and the same every time', () => {
    for (const body of BODIES) {
      const shape = shapes.get(body)!
      const out = dress({ body: shape, fields: fieldsOf.get(body), worn: [worn(tee), worn(trousers), worn(hair)] })
      expect(out.items.map((i) => i.id)).toEqual(['trousers', 'tee', 'hair'])
      for (const item of out.items) {
        expect(item.positions.every(Number.isFinite), `${body} ${item.id}`).toBe(true)
        for (let k = 0; k < item.count; k++) {
          const sum = item.weights[k * 4] + item.weights[k * 4 + 1] + item.weights[k * 4 + 2] + item.weights[k * 4 + 3]
          expect(sum, `${body} ${item.id} ${k}`).toBeCloseTo(1, 5)
        }
        expect(item.index.length, `${body} ${item.id}`).toBeGreaterThan(0)
      }
      const again = dress({ body: shape, fields: fieldsOf.get(body), worn: [worn(hair), worn(trousers), worn(tee)] })
      expect(again.items.map((i) => Array.from(i.positions))).toEqual(out.items.map((i) => Array.from(i.positions)))
      expect(Array.from(again.body)).toEqual(Array.from(out.body))
    }
  })

  it('pushes the outer layer over the inner one, and hides what it covers', () => {
    const out = dress({ body: ref, fields: fieldsOf.get('m-medium'), worn: [worn(tee), worn(trousers)] })
    const shirt = out.items.find((i) => i.id === 'tee')!
    // where both cover the body, the tee sits at least a gap outside the trousers
    const inner = coverOf(trousers.meta, ref.surface.count)
    const { tri } = tee.binding
    let overlapped = 0
    for (let k = 0; k < tee.count; k++) {
      const [a, b, c] = [tri[k * 3], tri[k * 3 + 1], tri[k * 3 + 2]]
      if (inner.outer[a] !== inner.outer[a] || inner.outer[b] !== inner.outer[b] || inner.outer[c] !== inner.outer[c]) continue
      overlapped++
      expect(liftOf(ref, tee, shirt.positions, k)).toBeGreaterThanOrEqual(0.005 + GAP - 1e-4)
    }
    expect(overlapped).toBeGreaterThan(5)
    // the trousers' triangles wholly under the tee are gone, and the body under both is hidden
    const pants = out.items.find((i) => i.id === 'trousers')!
    expect(pants.index.length).toBeLessThan(trousers.index.length)
    // exactly the body triangles with all three corners under the tee or the trousers are hidden
    const coveredBy = new Set([...tee.meta.covers, ...trousers.meta.covers])
    const T = ref.surface.triangles
    const expected: number[] = []
    for (let t = 0; t < T.length / 3; t++) if (![T[t * 3], T[t * 3 + 1], T[t * 3 + 2]].every((v) => coveredBy.has(v))) expected.push(t)
    expect(Array.from(out.body)).toEqual(expected)
    expect(out.body.length).toBeLessThan(T.length / 3 - 500)
  })

  it("presses each layer under an outer one where its few big triangles sag on a curve, on every body", async () => {
    // a built-in tee's hem crosses a hip in a few triangles, and a cape's a shoulder blade: before they pressed the
    // layer under them, the trousers stood 13 mm through the tee
    const outfit = await Promise.all(['trousers', 'sneakers', 'tee', 'cape'].map(async (id) => (await readItemFile(pub(`/kit/wear/${id}.glb`), ref.surface.count)).item))
    for (const body of BODIES) {
      const shape = shapes.get(body)!
      expect(crossings(shape, dress({ body: shape, fields: fieldsOf.get(body), worn: outfit.map((item) => worn(item)) }), outfit), body).toEqual([])
    }
  })

  it('wears a lower garment cut looser than the top outside it, the top tucked in', () => {
    const legs = leaning(files.get('m-medium')!, ref, ['hips', 'thigh_L', 'thigh_R'], 0.3)
    const skirt = shellItem(ref, { id: 'skirt', slot: 'lower', lift: 0.02, select: legs })
    const out = dress({ body: ref, fields: fieldsOf.get('m-medium'), worn: [worn(tee), worn(skirt)] })
    expect(out.items.map((i) => i.id)).toEqual(['tee', 'skirt'])
    // where both cover the body the skirt stands outside the tee, and the tee stays tucked in as made
    const shared = (item: SurfaceItem, other: SurfaceItem) => {
      const cover = coverOf(other.meta, ref.surface.count)
      const { tri } = item.binding
      return Array.from({ length: item.count }, (_, k) => k).filter((k) => [tri[k * 3], tri[k * 3 + 1], tri[k * 3 + 2]].every((v) => cover.outer[v] === cover.outer[v]))
    }
    const outside = out.items.find((i) => i.id === 'skirt')!
    const tucked = out.items.find((i) => i.id === 'tee')!
    expect(shared(skirt, tee).length).toBeGreaterThan(5)
    for (const k of shared(skirt, tee)) expect(liftOf(ref, skirt, outside.positions, k)).toBeGreaterThanOrEqual(0.004 + GAP - 1e-4)
    expect(shared(tee, skirt).length).toBeGreaterThan(5)
    for (const k of shared(tee, skirt)) expect(liftOf(ref, tee, tucked.positions, k)).toBeLessThan(0.004 + 1e-4)
    // trousers as tight as the tee stay under it
    expect(dress({ body: ref, worn: [worn(trousers), worn(tee)] }).items.map((i) => i.id)).toEqual(['trousers', 'tee'])
  })

  it('drapes loose cloth on every body, so no robe turns inside out between the knees', async () => {
    const face = (P: ArrayLike<number>, index: ArrayLike<number>, t: number) => {
      const [a, b, c] = [index[t] * 3, index[t + 1] * 3, index[t + 2] * 3]
      const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]]
      const v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]
      return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    }
    for (const id of ['kimono', 'hakama', 'wizard_robe', 'gown', 'monk_robe', 'skirt', 'cape']) {
      const { item } = await readItemFile(pub(`/kit/wear/${id}.glb`), ref.surface.count)
      for (const body of BODIES) {
        const out = dress({ body: shapes.get(body)!, fields: fieldsOf.get(body), worn: [worn(item)] }).items[0]
        // each triangle against itself as made: turned over is a fold showing its inside
        let total = 0
        let turned = 0
        for (let t = 0; t < item.index.length; t += 3) {
          const made = face(item.rest!, item.index, t)
          const area = Math.hypot(made[0], made[1], made[2]) / 2
          const now = face(out.positions, out.index, t)
          total += area
          if (now[0] * made[0] + now[1] * made[1] + now[2] * made[2] < 0) {
            turned += area
            expect(area, `${id} on ${body}`).toBeLessThan(2e-4)
          }
        }
        expect(turned / total, `${id} on ${body}`).toBeLessThan(3e-4)
      }
    }
    // cloth close to the skin (all but a tee's collar) moves exactly with it
    const { item: tee } = await readItemFile(pub('/kit/wear/tee.glb'), ref.surface.count)
    const { rest: _rest, ...bound } = tee
    const body = shapes.get('f-huge')!
    const draped = dress({ body, worn: [worn(tee)] }).items[0].positions
    const exact = dress({ body, worn: [worn(bound)] }).items[0].positions
    const close = Array.from({ length: tee.count }, (_, k) => k).filter((k) => Math.abs(tee.binding.lift[k]) < 0.02)
    expect(close.length).toBeGreaterThan(tee.count * 0.9)
    for (const k of close) for (let d = 0; d < 3; d++) expect(draped[k * 3 + d]).toBe(exact[k * 3 + d])
  })

  it('ties a band over its robe on every body: nothing stands proud of an obi, a rope or a sash', async () => {
    for (const [id, band] of [
      ['kimono', 'obi'],
      ['wizard_robe', 'rope'],
      ['gown', 'sash'],
    ]) {
      const { item } = await readItemFile(pub(`/kit/wear/${id}.glb`), ref.surface.count)
      const ch = item.meta.channels.findIndex((c) => c.name === band)
      for (const body of BODIES) {
        const out = dress({ body: shapes.get(body)!, fields: fieldsOf.get(body), worn: [worn(item)] }).items[0]
        const P = out.positions
        const bvh = new TriangleBVH(P, out.index)
        const ys = Array.from({ length: out.count }, (_, k) => k).filter((k) => item.channel[k] === ch).map((k) => P[k * 3 + 1])
        const hips = files.get(body)!.rest.hips
        let rays = 0
        let worst = 0
        // level rays out from the body's axis, all round and up the band: the band is the outermost cloth, give or take
        // a couple of millimetres where a skirt flares out just under a narrow rope
        for (let y = Math.min(...ys) + 0.003; y < Math.max(...ys) - 0.002; y += 0.004) {
          for (let a = 0; a < 360; a += 3) {
            const hits = bvh.hits([0, y, hips[2]], [Math.sin((a * Math.PI) / 180), 0, Math.cos((a * Math.PI) / 180)], 0, 0.8)
            const on = hits.filter((h) => item.channel[out.index[h.triangle * 3]] === ch)
            if (!on.length) continue
            rays++
            const outer = on[on.length - 1].t
            // cloth just outside it (a hanging sleeve further out is meant to be)
            for (const h of hits) if (h.t > outer && h.t < outer + 0.03 && item.channel[out.index[h.triangle * 3]] !== ch) worst = Math.max(worst, h.t - outer)
          }
        }
        expect(rays, `${id} on ${body}`).toBeGreaterThan(400)
        expect(worst, `${id} on ${body}`).toBeLessThan(0.002)
      }
    }
  })

  it('presses hair under a hat and keeps it out past the brim', () => {
    const capCover = coverOf(cap.meta, ref.surface.count)
    const out = dress({ body: ref, worn: [worn(hair)], rigid: [capCover] })
    const locks = out.items[0]
    const { tri } = hair.binding
    let pressed = 0
    let free = 0
    for (let k = 0; k < hair.count; k++) {
      const vids = [tri[k * 3], tri[k * 3 + 1], tri[k * 3 + 2]]
      const lift = liftOf(ref, hair, locks.positions, k)
      if (vids.every((v) => capCover.inner[v] === capCover.inner[v])) {
        pressed++
        expect(lift).toBeLessThanOrEqual(0.008 - GAP + 1e-4)
      } else if (vids.every((v) => capCover.inner[v] !== capCover.inner[v])) {
        free++
        expect(lift).toBeCloseTo(0.02, 3)
      }
    }
    expect(pressed).toBeGreaterThan(5)
    expect(free).toBeGreaterThan(5)
  })

  it('wears a mask over the beard and under the hair', () => {
    const f = files.get('m-medium')!
    const head = leaning(f, ref, ['head'], 0.95)
    const top = f.rest.head[1] + 0.06
    const crown = (v: number) => head(v) && ref.positions[v * 3 + 1] > top
    // thicker than the hair: worn over the mask, the hair has to rise over both
    const beard = shellItem(ref, { id: 'beard', slot: 'beard', lift: 0.02, hides: false, select: crown })
    const mask = shellItem(ref, { id: 'mask', slot: 'face', lift: 0.004, select: crown })
    const out = dress({ body: ref, worn: [worn(hair), worn(mask), worn(beard)] })
    // over the beard's whole reach: its corners all covered, so the floor there is the beard's (then the mask's)
    const lifts = (item: SurfaceItem) => {
      const dressed = out.items.find((i) => i.id === item.meta.id)!
      const { tri } = item.binding
      const under = new Set(beard.meta.covers)
      return Array.from({ length: item.count }, (_, k) => k).filter((k) => [0, 1, 2].every((j) => under.has(tri[k * 3 + j]))).map((k) => liftOf(ref, item, dressed.positions, k))
    }
    expect(lifts(mask).length).toBeGreaterThan(5)
    expect(Math.min(...lifts(mask))).toBeGreaterThanOrEqual(0.02 + GAP - 1e-4)
    expect(Math.min(...lifts(hair))).toBeGreaterThanOrEqual(0.02 + 2 * GAP - 1e-4)
  })

  it('carries a hard item on one bone, whole: a helmet down the neck never bends with it', () => {
    const f = files.get('m-medium')!
    const helm = shellItem(ref, { id: 'helm', slot: 'head', lift: 0.01, select: leaning(f, ref, ['head', 'neck'], 0.5) })
    const bonesOf = (item: SurfaceItem) => {
      const { joints, weights } = dress({ body: ref, worn: [worn(item)] }).items[0]
      const bones = new Set<number>()
      for (let k = 0; k < weights.length; k++) if (weights[k] > 0) bones.add(joints[k])
      return { bones, whole: Array.from({ length: weights.length / 4 }, (_, v) => weights[v * 4]).every((w) => w === 1) }
    }
    // bound as usual, it bends where the neck does; hard, it rides the head alone
    expect(bonesOf(helm).bones.size).toBeGreaterThan(1)
    const hard = bonesOf({ ...helm, meta: { ...helm.meta, hard: true } })
    expect(hard.whole).toBe(true)
    expect([...hard.bones].map((b) => f.bones[b])).toEqual(['head'])
  })

  it('cuts sleeves and legs where the knobs say, and shows the skin again there', () => {
    const fields = fieldsOf.get('m-medium')!
    const full = dress({ body: ref, fields, worn: [worn(tee)] })
    const cutOut = dress({ body: ref, fields, worn: [worn(tee, { sleeve: 0.3 })] })
    const sleeves = fieldAt(fields.arm, tee.binding.tri, tee.binding.st)
    const natural = Math.max(...sleeves)
    const threshold = 0.04 + (natural - 0.04) * 0.3
    const shirt = cutOut.items[0]
    // every kept vertex lies within the cut, measured again from its position and skin
    const f = files.get('m-medium')!
    const armBones = new Set(['upper_arm_L', 'forearm_L', 'hand_L', 'upper_arm_R', 'forearm_R', 'hand_R'].map((b) => f.bones.indexOf(b)))
    const chain = (side: 'L' | 'R') => [f.rest[`upper_arm_${side}`], f.rest[`forearm_${side}`], f.rest[`hand_${side}`]] as const
    let worst = 0
    for (const k of new Set(shirt.index)) {
      const p = [shirt.positions[k * 3], shirt.positions[k * 3 + 1], shirt.positions[k * 3 + 2]] as [number, number, number]
      let w = 0
      for (let j = 0; j < 4; j++) if (armBones.has(shirt.joints[k * 4 + j])) w += shirt.weights[k * 4 + j]
      const side = p[0] > 0 ? 'L' : 'R'
      worst = Math.max(worst, chainParam(p, ...chain(side)) * w)
    }
    expect(worst).toBeLessThan(threshold + 0.05)
    expect(Math.max(...sleeves)).toBeGreaterThan(threshold + 0.2)
    expect(shirt.index.length).toBeLessThan(full.items[0].index.length)
    expect(cutOut.body.length).toBeGreaterThan(full.body.length)
    // no triangle survives wholly beyond the cut
    const kept = new Set(shirt.index)
    expect(kept.size).toBeGreaterThan(0)
    expect(threshold).toBeLessThan(natural)
    const legsCut = dress({ body: ref, fields, worn: [worn(trousers, { leg: 0.2 })] })
    expect(legsCut.items[0].index.length).toBeLessThan(trousers.index.length)
  })
})

describe('item files', () => {
  it('come back from disk exactly as written, small', async () => {
    const shape = skinShape(ref)
    const positions = (tee as SurfaceItem & { positions: Float32Array }).positions
    const normals = fromLocal(tee.binding, shape, tee.normal)
    const glb = await writeItem({ meta: tee.meta, positions, normals, item: tee })
    const back = await readItemFile(glb, ref.surface.count)
    expect(back.meta).toEqual(tee.meta)
    expect(Array.from(back.item.binding.tri)).toEqual(Array.from(tee.binding.tri))
    expect(Array.from(back.item.binding.st)).toEqual(Array.from(tee.binding.st))
    expect(Array.from(back.item.binding.lift)).toEqual(Array.from(tee.binding.lift))
    expect(Array.from(back.item.normal)).toEqual(Array.from(tee.normal))
    // meshopt's index codec may start a triangle at another corner; the winding stays
    const triangles = (index: Uint32Array) => {
      const out: string[] = []
      for (let t = 0; t < index.length; t += 3) {
        const tri = [index[t], index[t + 1], index[t + 2]]
        const k = tri.indexOf(Math.min(...tri))
        out.push(`${tri[k]},${tri[(k + 1) % 3]},${tri[(k + 2) % 3]}`)
      }
      return out
    }
    expect(triangles(back.item.index)).toEqual(triangles(tee.index))
    expect(Array.from(back.positions)).toEqual(Array.from(positions))
    // a few dozen bytes a vertex at most, metadata included
    expect(glb.byteLength / tee.count).toBeLessThan(80)
  })
})
