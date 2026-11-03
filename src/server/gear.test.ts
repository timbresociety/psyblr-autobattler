import { describe, expect, it } from 'vitest'
import { gearProblem } from './gear.js'
import { isOwnPieceUrl } from './photo-url.js'

const look = (gear: object) => ({ gender: 'm' as const, colors: {}, gear })

const community = new Map([['0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e', { id: '0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e', name: 'Jade glaive', kind: 'hand' as const, tags: ['jade glaive'], url: 'https://store.public.blob.vercel-storage.com/pieces/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e.glb', thumb: '', tint: null, source: 'community' as const }]])

describe('gear on a saved hero', () => {
  it('takes a community piece the repository still shows, at its own URL', () => {
    const glaive = community.get('0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e')!
    expect(gearProblem(look({ hand_r: { id: glaive.id, url: glaive.url } }), community)).toBeUndefined()
    expect(gearProblem(look({ hand_r: { id: glaive.id, url: glaive.url } }))).toMatch(/no piece/)
  })

  it('takes built-in pieces at their own URLs in hands they fit', () => {
    expect(gearProblem(look({ hand_r: { id: 'katana', url: '/kit/pieces/katana.glb' }, hand_l: { id: 'shield', url: '/kit/pieces/shield.glb' } }))).toBeUndefined()
    expect(gearProblem(undefined)).toBeUndefined()
  })

  it('refuses unknown pieces, borrowed URLs and pieces in the wrong hand', () => {
    expect(gearProblem(look({ hand_r: { id: 'lightsaber', url: '/kit/pieces/lightsaber.glb' } }))).toMatch(/no piece/)
    expect(gearProblem(look({ hand_r: { id: 'katana', url: '/kit/pieces/sword.glb' } }))).toMatch(/must load from/)
    expect(gearProblem(look({ hand_r: { id: 'shield', url: '/kit/pieces/shield.glb' } }))).toMatch(/can't go in hand_r/)
  })

  it('ignores what an older save wore: heroes are drawn bare', () => {
    expect(gearProblem({ ...look({}), wear: { head: { id: 'top_hat', url: '/kit/pieces/top_hat.glb' } } } as never)).toBeUndefined()
  })
})

describe("this deployment's own generated files", () => {
  const id = '0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e'
  it('are pieces under pieces/ (and garments under wear/, from before), in its own store', () => {
    const env = { BLOB_STORE_ID: 'abc' }
    expect(isOwnPieceUrl(`https://abc.public.blob.vercel-storage.com/pieces/${id}.glb`, env)).toBe(true)
    expect(isOwnPieceUrl(`https://abc.public.blob.vercel-storage.com/wear/${id}.webp`, env)).toBe(true)
    expect(isOwnPieceUrl(`https://xyz.public.blob.vercel-storage.com/wear/${id}.glb`, env)).toBe(false)
    expect(isOwnPieceUrl(`https://abc.public.blob.vercel-storage.com/heroes/${id}.glb`, env)).toBe(false)
  })
})
