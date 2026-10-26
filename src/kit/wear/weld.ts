/**
 * Vertices that sit in the same place, joined: a mesh is split wherever its UVs or materials part, so the fit and the
 * dressing weld by position before asking what touches what.
 */
export function weldPositions(positions: ArrayLike<number>, tolerance = 1e-5): { id: Uint32Array; count: number } {
  const n = positions.length / 3
  const id = new Uint32Array(n)
  const seen = new Map<string, number>()
  const q = (x: number) => Math.round(x / tolerance)
  let count = 0
  for (let v = 0; v < n; v++) {
    const key = `${q(positions[v * 3])},${q(positions[v * 3 + 1])},${q(positions[v * 3 + 2])}`
    let w = seen.get(key)
    if (w === undefined) {
      w = count++
      seen.set(key, w)
    }
    id[v] = w
  }
  return { id, count }
}
