import { describe, expect, it } from 'vitest'
import { gearProblem, wearProblem } from './gear.js'

const look = (gear: object) => ({ gender: 'm' as const, hair: 'crop' as const, armour: false, cape: false, colors: {}, gear })

const community = new Map([['0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e', { id: '0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e', name: 'Straw hat', kind: 'head' as const, tags: ['straw hat'], url: 'https://store.public.blob.vercel-storage.com/pieces/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e.glb', thumb: '', tint: null, source: 'community' as const }]])

describe('gear on a saved hero', () => {
  it('takes a community piece the repository still shows, at its own URL', () => {
    const straw = community.get('0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e')!
    expect(gearProblem(look({ head: { id: straw.id, url: straw.url } }), community)).toBeUndefined()
    expect(gearProblem(look({ hand_r: { id: straw.id, url: straw.url } }), community)).toMatch(/can't go in hand_r/)
    expect(gearProblem(look({ head: { id: straw.id, url: straw.url } }))).toMatch(/no piece/)
  })

  it('takes built-in pieces at their own URLs in slots they fit', () => {
    expect(gearProblem(look({ hand_r: { id: 'katana', url: '/kit/pieces/katana.glb' }, hand_l: { id: 'shield', url: '/kit/pieces/shield.glb' }, head: { id: 'crown', url: '/kit/pieces/crown.glb', color: '#00ff00' } }))).toBeUndefined()
    expect(gearProblem(undefined)).toBeUndefined()
  })

  it('refuses unknown pieces, borrowed URLs and pieces in the wrong slot', () => {
    expect(gearProblem(look({ hand_r: { id: 'lightsaber', url: '/kit/pieces/lightsaber.glb' } }))).toMatch(/no piece/)
    expect(gearProblem(look({ hand_r: { id: 'katana', url: '/kit/pieces/sword.glb' } }))).toMatch(/must load from/)
    expect(gearProblem(look({ hand_r: { id: 'shield', url: '/kit/pieces/shield.glb' } }))).toMatch(/can't go in hand_r/)
    expect(gearProblem(look({ head: { id: 'katana', url: '/kit/pieces/katana.glb' } }))).toMatch(/can't go in head/)
  })
})

describe('the wardrobe on a saved hero', () => {
  const wearing = (wear: object) => ({ gender: 'm' as const, hair: 'crop' as const, armour: false, cape: false, colors: {}, wear })

  it('takes library items at their own URLs in slots they fit, and community ones the repository shows', () => {
    const straw = community.get('0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e')!
    expect(wearProblem(wearing({ head: { id: 'top_hat', url: '/kit/pieces/top_hat.glb', colors: ['#112233'] }, hand_l: { id: 'shield', url: '/kit/pieces/shield.glb' } }))).toBeUndefined()
    expect(wearProblem(wearing({ head: { id: straw.id, url: straw.url } }), community)).toBeUndefined()
    expect(wearProblem(undefined)).toBeUndefined()
  })

  it('refuses unknown items, borrowed URLs and items in the wrong slot', () => {
    expect(wearProblem(wearing({ upper: { id: 'mystery_robe', url: '/kit/wear/mystery_robe.glb' } }))).toMatch(/no item/)
    expect(wearProblem(wearing({ head: { id: 'top_hat', url: '/kit/pieces/crown.glb' } }))).toMatch(/must load from/)
    expect(wearProblem(wearing({ hand_r: { id: 'shield', url: '/kit/pieces/shield.glb' } }))).toMatch(/can't go in hand_r/)
    expect(wearProblem(wearing({ feet: { id: 'katana', url: '/kit/pieces/katana.glb' } }))).toMatch(/can't go in feet/)
    // gearProblem checks the wardrobe too, since that's what the store calls
    expect(gearProblem(wearing({ upper: { id: 'mystery_robe', url: '/kit/wear/mystery_robe.glb' } }))).toMatch(/no item/)
  })
})
