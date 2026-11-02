import { describe, expect, it } from 'vitest'
import { BUILD_SLOTS, hydrateBuild, remixBuild } from '../../charter/build.js'
import type { BuildSlot } from '../../charter/types.js'
import { GATE_CEILING, winRateVsField } from '../../sim/gate.js'
import { MOTION_SKILL, fitOf, motionOf, type MotionSlot } from '../../charter/motions.js'
import { ROLE_IDS } from '../../charter/roles.js'
import { getTemplate } from '../../charter/templates/catalog.js'
import { DEMO_HEROES, demoBuild, demoRoster } from './roster.js'

describe('demo roster (U1)', () => {
  it('has 10 moguls and 10 leaders with unique names', () => {
    expect(DEMO_HEROES.filter((h) => h.faction === 'mogul')).toHaveLength(10)
    expect(DEMO_HEROES.filter((h) => h.faction === 'leader')).toHaveLength(10)
    expect(new Set(DEMO_HEROES.map((h) => h.heroName)).size).toBe(20)
  })

  it('every build passes Charter validation at its own size', () => {
    for (const build of demoRoster()) {
      const result = hydrateBuild(build)
      expect(result.ok, build.heroName).toBe(true)
      expect(result.build.sizeClass ?? 'medium').toBe(build.sizeClass ?? 'medium')
    }
  })

  it('every skill carries a look of its own, kept through saving and a remix', () => {
    const elements = new Set<string>()
    for (const build of demoRoster()) {
      for (const slot of BUILD_SLOTS) {
        const look = build.look?.skills?.[slot]
        expect(look, `${build.heroName} ${slot}`).toBeDefined()
        elements.add(look!.element)
      }
      expect(hydrateBuild(build).build.look?.skills, build.heroName).toEqual(build.look?.skills)
      expect(remixBuild(build).look?.skills, build.heroName).toEqual(build.look?.skills)
    }
    // twenty heroes, not one blue glow: their moves come in many elements
    expect(elements.size).toBeGreaterThanOrEqual(10)
  })

  it('the eight role heroes follow the canon: a melee basic, a ranged Skill 1, and every skill its own motion that fits its slot', () => {
    const heroes = DEMO_HEROES.filter((h) => h.motions)
    expect(heroes.map((h) => h.roleId).sort()).toEqual([...ROLE_IDS].sort())
    for (const hero of heroes) {
      const build = demoBuild(hero)
      expect(getTemplate(hero.kit[0]).delivery.kind, hero.id).toBe('melee')
      expect(['projectile', 'beam'], hero.id).toContain(getTemplate(hero.kit[1]).delivery.kind)
      expect(new Set(hero.motions).size, hero.id).toBe(6)
      for (const [own, slot] of Object.entries(MOTION_SKILL) as [MotionSlot, BuildSlot][]) {
        const motion = build.look!.motions![own]!
        // a motion that fits what the skill does (a barricade braces behind a guard), or its slot
        expect(fitOf(getTemplate(build.slots[slot]!.templateId), slot).kinds, `${hero.id} ${slot} ${motion}`).toContain(motionOf(motion)?.kind)
      }
    }
  })

  it('every hero fights under the R15 ceiling at its own size, as any forged build must', () => {
    // demo heroes skip the forge's gate, so the roster itself has to stay fair: a 78% huge fighter once shipped here
    const over = demoRoster()
      .map((b) => ({ name: b.heroName, rate: winRateVsField(b) }))
      .filter((r) => r.rate > GATE_CEILING)
    expect(over).toEqual([])
    // the gate's own measurement (200 skirmishes a hero, 20 heroes): slow, but a cheaper sample would judge different fights
  }, 900_000)
})
