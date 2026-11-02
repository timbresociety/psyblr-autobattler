import { describe, expect, it } from 'vitest'
import type { Build } from '../../charter/build.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { carriedStyle, rangedStyleOf, styleOf } from './motions.js'

const withSlot = (build: Build, slot: keyof Build['slots'], templateId: string): Build => ({ ...build, slots: { ...build.slots, [slot]: { ...build.slots[slot], templateId } } })

describe('a hero fights in the styles its kit names (GAME.md §4)', () => {
  it('its combo comes from its melee style, whatever its role', () => {
    expect(styleOf(withSlot(defaultBuild('mage'), 'basic', 'melee-greatsword'))).toBe('greatsword')
    expect(styleOf(withSlot(defaultBuild('tank'), 'basic', 'melee-club'))).toBe('club')
  })

  it('its ranged clip comes from its weapon: a gun its own, magic the magic set', () => {
    expect(rangedStyleOf(withSlot(defaultBuild('marksman'), 'active1', 'marksman-rifle-shot'))).toBe('rifle')
    expect(rangedStyleOf(withSlot(defaultBuild('fighter'), 'active1', 'shared-sidearm'))).toBe('pistol')
    expect(rangedStyleOf(withSlot(defaultBuild('mage'), 'active1', 'mage-arcane-bolt'))).toBe('magic')
  })

  it('a role that keeps its range moves with its gun; a melee role moves unarmed between swings', () => {
    expect(carriedStyle(withSlot(defaultBuild('marksman'), 'active1', 'marksman-rifle-shot'))).toBe('rifle')
    expect(carriedStyle(withSlot(defaultBuild('fighter'), 'active1', 'shared-sidearm'))).toBeUndefined()
    expect(carriedStyle(withSlot(defaultBuild('mage'), 'active1', 'mage-arcane-bolt'))).toBeUndefined()
  })

  it("a look's style still overrides (the dev ?style= and the Forge's pick)", () => {
    const b = defaultBuild('fighter')
    const styled = { ...b, look: { gender: 'm' as const, hair: 'short' as const, armour: false, cape: false, colors: {}, style: 'staff' as const } }
    expect(styleOf(styled)).toBe('staff')
    expect(carriedStyle(styled)).toBe('staff')
  })
})
