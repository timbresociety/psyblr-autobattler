/** Seeded random numbers (mulberry32), so every simulated fight is reproducible (KTD6). */
import { next, rngState } from '../arena/engine/rng'

export type Rng = () => number

export function createRng(seed: number): Rng {
  const state = rngState(seed)
  return () => next(state)
}
