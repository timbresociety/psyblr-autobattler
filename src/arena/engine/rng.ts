/**
 * Seeded random numbers (mulberry32) whose whole state is one number, so a snapshot captures it (KTD1). The engine
 * keeps two streams, one for rules and one for the AI, so AI tuning never shifts rule outcomes.
 */
export interface RngState {
  s: number
}

export const rngState = (seed: number): RngState => ({ s: seed >>> 0 })

export function next(rng: RngState): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0
  let t = rng.s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** A second stream derived from the match seed. */
export const aiSeed = (seed: number) => (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0) || 1
