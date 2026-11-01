import { bindPoints, evaluate, type Binding } from '../wear/bind.js'
import { CARD_U } from '../wear/item.js'
import { BUDGET, type RawItem } from './fit.js'
import type { Reference } from './reference.js'

/**
 * A coarse garment made finer against the body it is fitted to. The first wardrobe was modelled on a 2,600-point
 * proxy, so a pair of trousers is 500 triangles with edges ten centimetres long across the thigh. On the Psyblr
 * Human the thigh is rounder, and such a triangle is a chord through it: its three corners stand a centimetre off the
 * skin while the skin bulges out through its middle (docs/plans/2026-10-31-creator-library-plan.md, status). So
 * every triangle is split in four, pass by pass, while the item's longest edge is over `maxEdge` and the slot's
 * budget allows, and each new point on an edge is put on the skin under it at its two ends' mean lift, so the cloth
 * follows the body's curve instead of cutting it. Loose cloth (both ends well off the skin) keeps the flat midpoint.
 * Hair and beards keep their cards and strands as made.
 */
export function refineRaw(raw: RawItem, ref: Reference, maxEdge = 0.04, passes = 2): RawItem {
  if (raw.spec.slot === 'hair' || raw.spec.slot === 'beard') return raw
  if (raw.uv) for (let v = 0; v < raw.uv.length; v += 2) if (raw.uv[v] > CARD_U) return raw
  let out = raw
  for (let pass = 0; pass < passes; pass++) {
    if (longestEdge(out) <= maxEdge) break
    if ((out.index.length / 3) * 4 > BUDGET[raw.spec.slot]) break
    out = splitOnce(out, ref)
  }
  return out
}

function longestEdge(raw: RawItem): number {
  const P = raw.positions
  const I = raw.index
  let longest = 0
  for (let t = 0; t < I.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = I[t + k] * 3
      const b = I[t + ((k + 1) % 3)] * 3
      longest = Math.max(longest, Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]))
    }
  return longest
}

/** Within this lift at both ends, a new point hugs the skin; from LOOSE it keeps the flat midpoint. */
const HUG = 0.025
const LOOSE = 0.06
const REACH = 1.2

function splitOnce(raw: RawItem, ref: Reference): RawItem {
  const P = raw.positions
  const I = raw.index
  const n = P.length / 3
  const mids = new Map<string, number>()
  const ends: number[] = []
  const mid = (a: number, b: number) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`
    let m = mids.get(key)
    if (m === undefined) {
      m = n + ends.length / 2
      mids.set(key, m)
      ends.push(a, b)
    }
    return m
  }
  const index = new Uint32Array(I.length * 4)
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]
    const b = I[t + 1]
    const c = I[t + 2]
    const ab = mid(a, b)
    const bc = mid(b, c)
    const ca = mid(c, a)
    index.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], t * 4)
  }
  const added = ends.length / 2
  const total = n + added
  const grow = <T extends Float32Array | Uint8Array>(from: T | undefined, size: number, round: boolean): T | undefined => {
    if (!from) return undefined
    const to = new (from.constructor as new (length: number) => T)(total * size)
    to.set(from)
    for (let e = 0; e < added; e++) {
      const a = ends[e * 2] * size
      const b = ends[e * 2 + 1] * size
      for (let k = 0; k < size; k++) to[(n + e) * size + k] = round ? from[a + k] : (from[a + k] + from[b + k]) / 2
    }
    return to
  }
  const positions = grow(P, 3, false)!
  const normals = grow(raw.normals, 3, false)
  if (normals) {
    for (let v = n; v < total; v++) {
      const l = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]) || 1
      for (let k = 0; k < 3; k++) normals[v * 3 + k] /= l
    }
  }
  // the new points onto the skin's curve: bound where they are, then set at their ends' mean lift along the normal
  const onSkin = bindPoints(P, ref.skin, ref.grid, REACH)
  const fresh = new Float32Array(added * 3)
  for (let e = 0; e < added; e++) fresh.set(positions.subarray((n + e) * 3, (n + e) * 3 + 3), e * 3)
  const bound = bindPoints(fresh, ref.skin, ref.grid, REACH)
  const lifts = new Float32Array(added)
  for (let e = 0; e < added; e++) {
    const la = onSkin.lift[ends[e * 2]]
    const lb = onSkin.lift[ends[e * 2 + 1]]
    lifts[e] = (la + lb) / 2
  }
  const hugged: Binding = { tri: bound.tri, st: bound.st, lift: lifts }
  const at = evaluate(hugged, ref.skin)
  for (let e = 0; e < added; e++) {
    const la = onSkin.lift[ends[e * 2]]
    const lb = onSkin.lift[ends[e * 2 + 1]]
    const far = Math.min(1, Math.max(0, (Math.max(Math.abs(la), Math.abs(lb)) - HUG) / (LOOSE - HUG)))
    for (let k = 0; k < 3; k++) {
      const flat = positions[(n + e) * 3 + k]
      positions[(n + e) * 3 + k] = at[e * 3 + k] + (flat - at[e * 3 + k]) * far
    }
  }
  return {
    ...raw,
    positions,
    ...(normals ? { normals } : {}),
    index,
    ...(raw.uv ? { uv: grow(raw.uv, 2, false) } : {}),
    ...(raw.channel ? { channel: grow(raw.channel, 1, true) } : {}),
    ...(raw.hang ? { hang: grow(raw.hang, 1, false) } : {}),
    ...(raw.len ? { len: grow(raw.len, 1, false) } : {}),
  }
}
