import { describe, expect, it } from 'vitest'
import { BUILT_IN, type PieceEntry } from './pieces.js'
import { resolveGear } from './resolve.js'

const ids = (prompt: string, catalog: readonly PieceEntry[] = BUILT_IN) => {
  const { gear, gaps } = resolveGear(prompt, catalog)
  return { gear: Object.fromEntries(Object.entries(gear).map(([slot, p]) => [slot, p!.id])), gaps: gaps.map((g) => `${g.kind}:${g.phrase}`) }
}

describe('putting the repository on a prompt', () => {
  it('wears what it names and asks for what it lacks', () => {
    expect(ids('a samurai with a katana and a straw hat')).toEqual({ gear: { hand_r: 'katana' }, gaps: ['head:straw hat'] })
    expect(ids('A queen with a crown, a sword and a round shield')).toEqual({ gear: { head: 'crown', hand_r: 'sword', hand_l: 'shield' }, gaps: [] })
  })

  it('takes the most specific words first: "top hat" over "hat", "viking" over "king"', () => {
    expect(ids('a magician in a top hat').gear).toMatchObject({ head: 'top_hat' })
    expect(ids('a viking king').gear).toMatchObject({ head: 'horned_helm', hand_r: 'axe' })
  })

  it('lets an archetype dress several slots, and a plural weapon fill both hands', () => {
    expect(ids('an angel').gear).toEqual({ head: 'halo', back: 'wings' })
    expect(ids('a ninja with twin daggers').gear).toEqual({ hand_r: 'dagger', hand_l: 'dagger' })
    expect(ids('an archer').gear).toEqual({ hand_l: 'bow', back: 'quiver' })
  })

  it('reads only the hero, not the skills it lists', () => {
    expect(ids('a monk with skills around Chain Whip and Fan of Knives').gaps).toEqual([])
  })

  it('a generated piece in the repository fills its gap for everyone', () => {
    const straw: PieceEntry = { id: '0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e', name: 'Straw hat', kind: 'head', tags: ['straw hat'], url: 'https://s.public.blob.vercel-storage.com/pieces/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e.glb', thumb: '', tint: null, source: 'community' }
    expect(ids('a samurai with a katana and a straw hat', [...BUILT_IN, straw])).toEqual({ gear: { hand_r: 'katana', head: straw.id }, gaps: [] })
  })
})
