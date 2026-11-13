import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUILD_SLOTS, hydrateBuild } from '../charter/build'
import { ALL_SIZE_CLASSES } from '../charter/sizes'
import { WEAPONS } from '../kit/weapons.gen'
import { shortName } from '../ui/arena/hud/format'
import { ROSTER } from './roster'

const generated = JSON.parse(readFileSync('public/heroes/generated/index.json', 'utf8')) as { label: string }[]

describe('the roster', () => {
  it('is six Johns, one a size, and six characters', () => {
    const johns = ROSTER.filter((h) => h.squad === 'vanguard')
    expect(johns.map((h) => h.sizeClass)).toEqual(ALL_SIZE_CLASSES)
    expect(ROSTER.filter((h) => h.squad === 'outlaws')).toHaveLength(6)
    expect(new Set(ROSTER.map((h) => h.id)).size).toBe(12)
  })

  it('gives every hero a build a saved hero could hold, its own templates kept', () => {
    for (const hero of ROSTER) {
      // a saved hero cannot start colossal (GAME.md R44: only a form reaches it), so those two are checked a size down
      const back = hydrateBuild(hero.sizeClass === 'colossal' ? { ...hero.build, sizeClass: 'huge' } : hero.build)
      expect(back.ok, hero.heroName).toBe(true)
      for (const slot of BUILD_SLOTS) {
        expect(back.build.slots[slot].templateId, `${hero.heroName} ${slot}`).toBe(hero.build.slots[slot].templateId)
        expect(hero.build.slots[slot].name, `${hero.heroName} ${slot}`).not.toBe('')
      }
      expect(back.build.look?.mesh).toBe(hero.build.look?.mesh)
    }
  })

  it('gives every hero a name of its own on the HUD', () => {
    const names = ROSTER.map((h) => shortName(h.heroName))
    expect(new Set(names).size).toBe(ROSTER.length)
    expect(names.slice(0, 3)).toEqual(['Tiny John', 'Small John', 'John'])
  })

  it('dresses each John in John’s mesh at its own size', () => {
    for (const hero of ROSTER.filter((h) => h.squad === 'vanguard')) expect(generated.some((g) => g.label === hero.build.look?.mesh), hero.heroName).toBe(true)
  })

  it('arms each hero from the weapon library: a sword for a sword, nothing for fists, feet and palms', () => {
    const arms = (id: string) => ROSTER.find((h) => h.id === id)!.build.look?.arms?.map((a) => `${a.piece.id}:${a.use}`) ?? []
    for (const hero of ROSTER) for (const arm of hero.build.look?.arms ?? []) {
      expect(WEAPONS.some((w) => w.id === arm.piece.id), `${hero.heroName}: ${arm.piece.id}`).toBe(true)
      expect(existsSync(`public${arm.piece.url}`), arm.piece.url).toBe(true)
    }
    expect(arms('harry')).toEqual(['gryffindor-sword:melee', 'holly-wand:ranged'])
    expect(arms('l')).toEqual(['handcuffs:ranged'])
    expect(arms('groot')).toEqual(['branch-whip:melee'])
    expect(arms('attack-titan')).toEqual(['boulder:ranged'])
    expect(arms('broly')).toEqual([])
    expect(arms('iron-hulk')).toEqual([])
    expect(arms('john')).toEqual(['katana:melee', 'pistol:ranged'])
  })
})
