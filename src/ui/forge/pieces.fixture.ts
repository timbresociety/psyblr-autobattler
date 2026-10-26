import { vi } from 'vitest'
import type { PieceDeps } from '../api'

/** A repository with nothing in it and generation that never finishes, for tests that don't exercise either. */
export function pieceDeps(over: Partial<PieceDeps> = {}): PieceDeps {
  return {
    searchPieces: vi.fn(async () => []),
    searchItems: vi.fn(async () => []),
    generationReady: vi.fn(async () => true),
    session: vi.fn(async () => ({ signedIn: false })),
    startSignIn: vi.fn(async () => ({})),
    verifySignIn: vi.fn(async () => undefined),
    credits: vi.fn(async () => ({ balance: 0, freeGrant: 80, freeClaimed: false, packs: [] })),
    claimFree: vi.fn(async () => 80),
    purchase: vi.fn(async () => ({ url: '/' })),
    startPiece: vi.fn(async () => {
      throw new Error('unused')
    }),
    pollPiece: vi.fn(async () => {
      throw new Error('unused')
    }),
    ...over,
  }
}
