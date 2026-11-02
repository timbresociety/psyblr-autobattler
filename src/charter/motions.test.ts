import { describe, expect, it } from 'vitest'
import { MOTIONS, motionOf, pickMotions, SLOT_KINDS, STYLES } from './motions.js'
import type { BuildSlot } from './types.js'

const SLOTS: BuildSlot[] = ['basic', 'active1', 'active2', 'movement', 'passive', 'ultimate']

describe('motions', () => {
  it('names every clip once', () => {
    expect(new Set(MOTIONS.map((m) => m.id)).size).toBe(MOTIONS.length)
  })

  it('gives each slot of a hero its own motion, of a kind the slot plays', () => {
    for (const style of STYLES) {
      const picks = pickMotions(style, SLOTS, (s) => `hero/${s}`)
      const ids = Object.values(picks)
      expect(ids.every(Boolean)).toBe(true)
      expect(new Set(ids).size).toBe(ids.length)
      for (const slot of SLOTS) expect(SLOT_KINDS[slot]).toContain(motionOf(picks[slot]!)!.kind)
    }
  })

  it("takes the hero's style first and keeps a chosen motion", () => {
    const picks = pickMotions('rifle', SLOTS, (s) => `huang/${s}`, { ultimate: 'crouch_rapid_fire' })
    expect(motionOf(picks.basic!)!.style).toBe('rifle')
    expect(motionOf(picks.active1!)!.style).toBe('rifle')
    expect(picks.ultimate).toBe('crouch_rapid_fire')
    expect(Object.values(picks).filter((id) => id === 'crouch_rapid_fire')).toHaveLength(1)
  })

  it('picks the same motions every time, and only clips the library has', () => {
    const seed = (s: BuildSlot) => `modi/${s}`
    expect(pickMotions('kicks', SLOTS, seed)).toEqual(pickMotions('kicks', SLOTS, seed))
    const have = new Set(['roundhouse_kick', 'fireball', 'spell_cast'])
    const picks = pickMotions('kicks', SLOTS, seed, {}, (id) => have.has(id))
    expect(Object.values(picks).filter(Boolean).every((id) => have.has(id!))).toBe(true)
  })
})
