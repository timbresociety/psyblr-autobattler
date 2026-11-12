import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CARRY_PAIRS, labArms } from './library'

describe("John's weapons", () => {
  it('places every V family against every LMB family without two kinds sharing a slot', () => {
    for (const { style, family } of CARRY_PAIRS) {
      const arms = labArms(style, family)
      const melee = new Set(arms.filter((a) => a.use === 'melee').map((a) => a.stow))
      const clash = arms.filter((a) => a.use === 'ranged' && melee.has(a.stow))
      expect(clash, `${style} with ${family}`).toEqual([])
    }
  })

  it('carries a weapon file for everything it names', () => {
    for (const { style, family } of CARRY_PAIRS) for (const a of labArms(style, family)) expect(existsSync(`public${a.piece.url}`), a.piece.url).toBe(true)
  })

  it('moves a weapon off its first slot only when the other kind holds it', () => {
    // a katana's first slot is the left hip; a wand's is the left thigh: no clash, both first
    expect(labArms('blade', 'magic1').map((a) => a.stow)).toEqual(['hip_l', 'thigh_l'])
    // a bow takes the back's left diagonal, so the scythe goes to the right one; the quiver, on its hip
    expect(labArms('axe', 'bow').map((a) => [a.piece.id, a.stow])).toEqual([
      ['scythe', 'back_r'],
      ['recurve-bow', 'back_l'],
      ['quiver', 'hip_r'],
    ])
  })
})
