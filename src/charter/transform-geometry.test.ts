import { describe, expect, it } from 'vitest'
import { hydrateBuild } from './build.js'
import { scoreTemplate } from './budget.js'
import { missingGeometry } from './geometry.js'
import { LOCOMOTION_HINT, locomotion } from './locomotion.js'
import { ALL_SIZE_CLASSES, SIZE_CLASSES, isAnySizeClass, isSizeClass } from './sizes.js'
import { proposeBuild } from './build.js'
import { getRole } from './roles.js'
import { deriveSheet } from './stats.js'
import { CATALOG, getTemplate } from './templates/catalog.js'
import { at, phys, resize, ultimate, ai } from './templates/dsl.js'
import { renderTooltip } from './tooltip.js'

describe('six size classes (R44, AE10)', () => {
  it('offers five choosable classes and keeps colossal for transformations', () => {
    expect(SIZE_CLASSES).toHaveLength(5)
    expect(ALL_SIZE_CLASSES).toHaveLength(6)
    expect(isSizeClass('colossal')).toBe(false)
    expect(isAnySizeClass('colossal')).toBe(true)
  })

  it('rejects colossal as a chosen size', () => {
    const build = proposeBuild({ heroName: 'Titan', roleId: 'tank', skills: {} }).build
    expect(hydrateBuild({ ...build, sizeClass: 'colossal' }).ok).toBe(false)
    expect(hydrateBuild({ ...build, sizeClass: 'huge' }).ok).toBe(true)
  })
})

describe('transformations resize the hero (R23, R29)', () => {
  const base = { id: 'x', name: 'X', roles: ['tank' as const], tags: ['x'], delivery: at.self(), cooldown: 60, ai: ai('engage', 1) }

  it('a resize to a larger class costs more budget than the same skill without it', () => {
    const plain = ultimate({ ...base, effects: [phys(100)] })
    const grown = ultimate({ ...base, effects: [resize('colossal', 8), phys(100)] })
    expect(scoreTemplate(grown)).toBeGreaterThan(scoreTemplate(plain))
    expect(scoreTemplate(ultimate({ ...base, effects: [resize('huge', 8), phys(100)] }))).toBeLessThan(scoreTemplate(grown))
  })

  it('every transform-tagged ultimate carries a resize, and Titan Form goes colossal', () => {
    const transforms = CATALOG.filter((t) => t.tags.includes('transform'))
    expect(transforms.length).toBeGreaterThan(0)
    for (const t of transforms) expect(t.effects.some((e) => e.kind === 'resize'), t.id).toBe(true)
    expect(getTemplate('tank-titan-form').effects).toContainEqual({ kind: 'resize', sizeClass: 'colossal', duration: 8 })
  })

  it("Titan Form's tooltip states its target class and duration", () => {
    const sheet = deriveSheet(getRole('tank'), getRole('tank').defaultSpread).sheet
    expect(renderTooltip(getTemplate('tank-titan-form'), { name: 'Fox Titan', flavour: '' }, sheet).lines).toContain('Becomes Colossal for 8 s')
  })
})

describe('per-skill hit geometry (R43)', () => {
  const base = { id: 'p', name: 'P', roles: ['mage' as const], tags: ['p'], effects: [phys(80)], cooldown: 8, ai: ai('poke', 1) }

  it('a projectile at double speed costs more than the same projectile at the default speed', () => {
    const slow = ultimate({ ...base, delivery: at.proj(20) })
    const fast = ultimate({ ...base, delivery: at.proj(20, undefined, 60) })
    expect(scoreTemplate(fast)).toBeGreaterThan(scoreTemplate(slow))
  })

  it('every projectile, melee, cone and beam template carries the geometry its kind needs', () => {
    for (const t of CATALOG) expect(missingGeometry(t.delivery), t.id).toEqual([])
    expect(missingGeometry({ kind: 'projectile', range: 10 })).toEqual(['speed', 'projectileRadius'])
  })

  it('tooltips show the geometry', () => {
    const t = CATALOG.find((x) => x.delivery.kind === 'projectile')!
    const sheet = deriveSheet(getRole('mage'), getRole('mage').defaultSpread).sheet
    expect(renderTooltip(t, { name: '', flavour: '' }, sheet).lines.some((l) => l.startsWith('Shot speed'))).toBe(true)
  })
})

describe('locomotion (R28)', () => {
  it('derives flight and jump reach from move speed, and the hint names all three', () => {
    const l = locomotion(6)
    expect(l.ground).toBe(6)
    expect(l.flight).toBeLessThan(6)
    expect(locomotion(8).jumpReach).toBeGreaterThan(l.jumpReach)
    expect(LOCOMOTION_HINT).toMatch(/Ground speed/)
    expect(LOCOMOTION_HINT).toMatch(/Flight/)
    expect(LOCOMOTION_HINT).toMatch(/flight meter/)
    expect(LOCOMOTION_HINT).toMatch(/jump range/)
  })
})
