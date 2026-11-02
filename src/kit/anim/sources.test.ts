import { describe, expect, it } from 'vitest'
import { CORE_BONES, mapFor, SOURCES } from './sources.js'

describe('motion source maps (GAME.md §12)', () => {
  it('drives every core bone a mapped source has, never two bones onto one', () => {
    for (const [id, source] of Object.entries(SOURCES))
      for (const v of source.variants) {
        if (!Object.keys(v.map).length) continue
        const targets = Object.values(v.map)
        expect(new Set(targets).size, id).toBe(targets.length)
        expect(CORE_BONES.filter((b) => !targets.includes(b) && !v.lacks?.includes(b)), id).toEqual([])
      }
  })

  it("picks a source's variant by the bones the file has", () => {
    expect(mapFor('quaternius', ['pelvis', 'spine_01', 'spine_05'])?.spine_05).toBe('Spine2')
    expect(mapFor('quaternius', ['pelvis', 'spine_01', 'spine_03'])?.spine_03).toBe('Spine2')
    expect(mapFor('cmu', ['hip', 'abdomen', 'chest'])?.chest).toBe('Spine2')
    expect(mapFor('mixamo', ['Hips'])).toEqual({})
    expect(mapFor('nowhere', [])).toBeUndefined()
  })

  it('takes nothing from sources the owner excluded', () => {
    expect(Object.keys(SOURCES).filter((s) => /bandai|amass/i.test(s))).toEqual([])
  })
})
