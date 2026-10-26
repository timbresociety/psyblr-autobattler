import { describe, expect, it } from 'vitest'
import { proposeBuild } from '../../../charter/build'
import { emptyFormation, place } from './formation'
import { tryItStaging } from './try-it'

describe('try it', () => {
  it('stages the hero and a training dummy on their own halves, clear of the ruins', () => {
    const staged = tryItStaging(proposeBuild({ heroName: 'Ada', roleId: 'mage', skills: {} }).build)
    let formation = emptyFormation()
    for (const side of [0, 1] as const) {
      for (const p of staged.formation[side]) {
        const placed = place(formation, side, p.hero, p.x, p.z)
        expect(placed.ok).toBe(true)
        if (placed.ok) formation = placed.formation
      }
    }
    expect(staged.loadout.map((e) => e.build.heroName)).toEqual(['Ada', 'Training dummy'])
    expect(staged.dummy).toBe(true)
  })
})
