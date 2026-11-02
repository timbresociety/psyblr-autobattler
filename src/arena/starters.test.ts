import { describe, expect, it } from 'vitest'
import { BUILD_SLOTS, SLOT_KIND } from '../charter/build.js'
import { fitsSlot, getTemplate } from '../charter/templates/catalog.js'
import { ROLE_IDS } from '../charter/roles.js'
import { shortName } from '../ui/arena/hud/format.js'
import { SQUADS, STARTERS, starterBuild } from './starters.js'

describe('the starter squads (GAME.md §13: generated, not hand-made)', () => {
  it('are two squads of ten, every role in each, every name its own', () => {
    for (const squad of SQUADS) {
      const mine = STARTERS.filter((s) => s.squad === squad)
      expect(mine).toHaveLength(10)
      expect(new Set(mine.map((s) => s.roleId))).toEqual(new Set(ROLE_IDS))
    }
    expect(new Set(STARTERS.map((s) => s.heroName)).size).toBe(STARTERS.length)
    // the HUD shows surnames only
    expect(new Set(STARTERS.map((s) => shortName(s.heroName))).size).toBe(STARTERS.length)
  })

  it('carry a kit from each row, every pick keeping its row typing rule', () => {
    for (const s of STARTERS) {
      for (const slot of BUILD_SLOTS) {
        const t = getTemplate(s.build.slots[slot].templateId)
        expect(fitsSlot(t, SLOT_KIND[slot]), `${s.heroName} ${slot} ${t.id}`).toBe(true)
        expect(t.roles, `${s.heroName} ${slot}`).toContain(s.roleId)
      }
    }
  })

  it('come out the same every time, and a copy never reaches the original', () => {
    const a = starterBuild(STARTERS[0])
    a.slots.basic.name = 'changed'
    expect(STARTERS[0].build.slots.basic.name).not.toBe('changed')
    expect(STARTERS.map((s) => s.heroName)).toMatchSnapshot()
  })
})
