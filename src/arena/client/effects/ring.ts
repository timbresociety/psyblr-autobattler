/**
 * A ring of slots for pooled particles (KTD11): spawning takes the next slots and wraps, overwriting the oldest,
 * so the pool never grows and a full budget drops the oldest cosmetic particles first.
 */
export interface Ring {
  size: number
  next: number
}

export const ring = (size: number): Ring => ({ size, next: 0 })

/** Reserve `count` consecutive slots (wrapping); returns their start indices as one or two ranges. */
export function take(r: Ring, count: number): [number, number][] {
  const n = Math.min(count, r.size)
  const start = r.next
  r.next = (r.next + n) % r.size
  return start + n <= r.size ? [[start, n]] : [[start, r.size - start], [0, n - (r.size - start)]]
}
