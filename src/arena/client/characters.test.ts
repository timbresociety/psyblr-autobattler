import { describe, expect, it } from 'vitest'
import { remixBuild } from '../../charter/build.js'
import { getTemplate } from '../../charter/templates/catalog.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { DEMO_HEROES, demoBuild } from '../demo/roster.js'
import { BODIES, bodyFor, characterLook } from './character-look.js'
import { castClip } from './characters.js'

const ids = (outfit: ReturnType<typeof characterLook>['outfit']) => Object.fromEntries(Object.entries(outfit).map(([slot, w]) => [slot, w!.id]))

describe('a hero’s look', () => {
  it('is the same wherever the hero fights: it follows the name, not the slot or side', () => {
    const a = characterLook(defaultBuild('fighter', 'Ada'), 0.3)
    const b = characterLook(defaultBuild('fighter', 'Ada'), 0.3)
    expect(b.outfit).toEqual(a.outfit)
    expect(b.colors.skin.getHex()).toBe(a.colors.skin.getHex())
  })

  it('dresses by role when it has no look: tanks in a helmet and armour, fighters caped and armoured, marksmen bare-headed', () => {
    const tank = characterLook(defaultBuild('tank', 'T'), 0)
    expect(tank.build).toBe('m-medium')
    expect(ids(tank.outfit)).toMatchObject({ head: 'legion_helm', upper: 'breastplate', back: 'cape' })
    expect(ids(characterLook(defaultBuild('fighter', 'F'), 0).outfit)).toMatchObject({ upper: 'breastplate', back: 'cape' })
    const marksman = ids(characterLook(defaultBuild('marksman', 'M'), 0).outfit)
    expect(marksman.upper).toBe('longsleeve')
    expect(marksman.back).toBeUndefined()
    expect(marksman.head).toBeUndefined()
    expect(characterLook(defaultBuild('mage', 'Mi'), 0).build).toBe('f-medium')
  })

  it('wears the body for its size: a huge hero a huge body, not a medium one scaled up', () => {
    expect(characterLook({ ...defaultBuild('fighter', 'Big'), sizeClass: 'huge' }, 0).build).toBe('m-huge')
    expect(characterLook({ ...defaultBuild('mage', 'Small'), sizeClass: 'tiny' }, 0).build).toBe('f-tiny')
    expect(bodyFor(defaultBuild('tank', 'T'), 'colossal')).toBe('m-colossal')
    expect(BODIES).toHaveLength(12)
  })

  it('its look picks the gender, the wardrobe and the skin, and carries its photo face', () => {
    const face = { url: '/dev-store/heroes/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e.webp', width: 512, height: 512, points: new Array(956).fill(10) }
    const build = { ...defaultBuild('tank', 'Ada'), look: { gender: 'f' as const, hair: 'long' as const, armour: false, cape: true, colors: { suit: '#ff0000', skin: '#8a5a3c' }, face } }
    const look = characterLook(build, 0.2)
    expect(look).toMatchObject({ build: 'f-medium', face })
    expect(ids(look.outfit)).toMatchObject({ hair: 'hair_long', upper: 'longsleeve', back: 'cape' })
    expect(look.outfit.upper!.colors![0]).toBe('#ff0000')
    expect(look.colors.skin.getHexString()).toBe('8a5a3c')
  })
})

describe('the demo roster', () => {
  it('wears the bodies and wardrobe everyone does: its gender at its size, its own outfit, its portrait', () => {
    for (const hero of DEMO_HEROES) {
      const build = demoBuild(hero)
      const look = characterLook(build, hero.hue)
      expect(look.build, hero.id).toBe(`${build.look!.gender}-${hero.sizeClass}`)
      expect(look.outfit, hero.id).toEqual(build.look!.wear)
      expect(look.face?.url, hero.id).toBe(`/kit/faces/${hero.id}.webp`)
      expect(look.colors.skin.getHexString(), hero.id).toBe(build.look!.colors.skin!.slice(1))
    }
  })

  it('a remix looks exactly like the hero it came from: nothing about it depends on the name', () => {
    for (const hero of DEMO_HEROES) {
      const build = demoBuild(hero)
      const remix = remixBuild(build)
      expect(remix.heroName).toBe(`${hero.heroName} Remix`)
      expect(remix.heroId).toBeUndefined()
      expect(remix.gate).toEqual({ state: 'draft' })
      expect(remix.look, hero.id).toEqual(build.look)
      // a copy: editing the remix's look never reaches the original
      expect(remix.look).not.toBe(build.look)
      // drawn under any name and hue, the same hero
      expect(characterLook({ ...remix, heroName: 'Someone else' }, 0), hero.id).toEqual(characterLook(build, hero.hue))
    }
  })
})

describe('which clip a cast plays', () => {
  it('swings for close skills, shoots a basic projectile, casts the rest, and plays the ultimate as its own', () => {
    const marksman = defaultBuild('marksman', 'M')
    const fighter = defaultBuild('fighter', 'F')
    expect(castClip(marksman, 'ultimate')).toBe('ultimate')
    const kindOf = (b: typeof marksman, slot: 'basic' | 'active1') => getTemplate(b.slots[slot].templateId).delivery.kind
    if (kindOf(marksman, 'basic') === 'projectile') expect(castClip(marksman, 'basic')).toBe('shoot')
    if (kindOf(fighter, 'basic') === 'melee') expect(castClip(fighter, 'basic')).toBe('slash')
    expect(['slash', 'shoot', 'cast']).toContain(castClip(fighter, 'active1'))
  })
})
