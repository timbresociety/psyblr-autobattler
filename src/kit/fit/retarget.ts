import { bindPoints, evaluate, type Binding } from '../wear/bind.js'
import type { RawItem } from './fit.js'
import type { Reference } from './reference.js'

/**
 * A raw item modelled on one body, carried over to another of the same shape at another resolution: the first bodies'
 * 2,600-point proxy and the Psyblr Human (docs/plans/2026-10-31-canon-psyblr-human.md). Bound straight to the new
 * skin, an item sat where it was modelled, and where the new body is fuller (its longer feet, its rounder thighs) the
 * skin came out through it: a boot's toe cap pushed out along the toe's top gets no longer. So every vertex is read as
 * where it sits on the first skin (its nearest point there, and its lift along the normal), that skin point is found
 * on the new skin, and the vertex is put back at the same lift along the new normal. Close to the skin the lift says
 * where it goes; well off it (a cape's hem, a skirt's flare) the vertex keeps its offset from the skin point instead,
 * so a hanging part keeps its shape.
 */
export function retargetRaw(raw: RawItem, from: Reference, to: Reference): RawItem {
  const P = raw.positions
  const n = P.length / 3
  const onFrom = bindPoints(P, from.skin, from.grid, REACH)
  // the skin points under each vertex, on the first body
  const flat: Binding = { tri: onFrom.tri, st: onFrom.st, lift: new Float32Array(n) }
  const S = evaluate(flat, from.skin)
  // the same points found on the new skin, and the new normals there
  const onTo = bindPoints(S, to.skin, to.grid, REACH)
  const flatTo: Binding = { tri: onTo.tri, st: onTo.st, lift: new Float32Array(n) }
  const S2 = evaluate(flatTo, to.skin)
  const N2 = evaluate({ tri: onTo.tri, st: onTo.st, lift: new Float32Array(n).fill(1) }, to.skin)
  const positions = new Float32Array(n * 3)
  for (let v = 0; v < n; v++) {
    const lift = onFrom.lift[v]
    // 0 at HUG (along the normal), 1 at LOOSE and beyond (the offset kept)
    const loose = Math.min(1, Math.max(0, (Math.abs(lift) - HUG) / (LOOSE - HUG)))
    for (let k = 0; k < 3; k++) {
      const normal = N2[v * 3 + k] - S2[v * 3 + k]
      const along = S2[v * 3 + k] + normal * lift
      const kept = S2[v * 3 + k] + (P[v * 3 + k] - S[v * 3 + k])
      positions[v * 3 + k] = along + (kept - along) * loose
    }
  }
  // the normals as they were (the surfaces run the same way); the fit recomputes what it needs
  return { ...raw, positions }
}

/** How far a point may bind from either skin. */
const REACH = 1.2
/** Within this lift a vertex follows the new normal; from LOOSE it keeps its offset. */
const HUG = 0.02
const LOOSE = 0.06
