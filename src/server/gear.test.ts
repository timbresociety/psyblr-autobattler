import { describe, expect, it } from 'vitest'
import { gearProblem } from './gear.js'

const look = (gear: object) => ({ gender: 'm' as const, hair: 'crop' as const, armour: false, cape: false, colors: {}, gear })

describe('gear on a saved hero', () => {
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
