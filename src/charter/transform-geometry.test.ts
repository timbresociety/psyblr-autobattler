import { describe, expect, it } from 'vitest'
import { hydrateBuild } from './build.js'
import { scoreTemplate, validateTemplate } from './budget.js'
import { missingGeometry } from './geometry.js'
import { LOCOMOTION_HINT, locomotion } from './locomotion.js'
import { ALL_SIZE_CLASSES, SIZE_CLASSES, isAnySizeClass, isSizeClass } from './sizes.js'
import { proposeBuild } from './build.js'
import { getRole } from './roles.js'
import { deriveSheet } from './stats.js'
import { CATALOG, getTemplate } from './templates/catalog.js'
import { at, form, phys, resize, ultimate, ai } from './templates/dsl.js'
import { renderTooltip } from './tooltip.js'
import type { Template } from './types.js'
import { transformOf } from '../forge/form.js'

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

  it('every transform-tagged ultimate carries a resize or a form, and Titan Form goes colossal', () => {
    const transforms = CATALOG.filter((t) => t.tags.includes('transform'))
    expect(transforms.length).toBeGreaterThan(0)
    for (const t of transforms) expect(transformOf(t), t.id).toBeDefined()
    expect(getTemplate('tank-titan-form').effects).toContainEqual({ kind: 'resize', sizeClass: 'colossal', duration: 8 })
  })

  it("Titan Form's tooltip states its target class and duration", () => {
    const sheet = deriveSheet(getRole('tank'), getRole('tank').defaultSpread).sheet
    expect(renderTooltip(getTemplate('tank-titan-form'), { name: 'Fox Titan', flavour: '' }, sheet).lines).toContain('Becomes Colossal for 8 s')
  })
})

describe('a transformation grows the hero, keeps its size or shrinks it (R23)', () => {
  const base = { id: 'x', name: 'X', roles: ['fighter' as const], tags: ['x'], delivery: at.self(), cooldown: 60, ai: ai('engage', 1) }
  const problems = (t: Template) => {
    const v = validateTemplate(t)
    return v.ok ? [] : v.errors.map((e) => e.field)
  }

  it('the catalogue has one of each: shrink, keep, grow huge and grow colossal', () => {
    expect(transformOf(getTemplate('assassin-shrink-form'))).toEqual({ size: 'tiny', duration: 8 })
    expect(transformOf(getTemplate('fighter-ascended-form'))).toEqual({ duration: 10 })
    expect(transformOf(getTemplate('fighter-avatar-form'))).toEqual({ size: 'huge', duration: 8 })
    expect(transformOf(getTemplate('tank-titan-form'))?.size).toBe('colossal')
    expect(transformOf(getTemplate('fighter-haymaker'))).toBeUndefined()
  })

  it('marking a power-up as a form changes no number', () => {
    const plain = ultimate({ ...base, effects: [phys(100)] })
    expect(scoreTemplate(ultimate({ ...base, effects: [form(10), phys(100)] }))).toBeCloseTo(scoreTemplate(plain), 9)
  })

  it('is something a hero does to itself, once per skill', () => {
    expect(problems(ultimate({ ...base, effects: [form(10), phys(100)] }))).toEqual([])
    expect(problems(ultimate({ ...base, delivery: at.proj(20), effects: [form(10), phys(100)] }))).toContain('effects.transformation')
    expect(problems(ultimate({ ...base, delivery: at.proj(20), effects: [resize('huge', 8), phys(100)] }))).toContain('effects.transformation')
    expect(problems(ultimate({ ...base, effects: [resize('huge', 8), form(8), phys(100)] }))).toContain('effects.transformation')
  })

  it('tooltips say what happens to the size', () => {
    const sheet = deriveSheet(getRole('fighter'), getRole('fighter').defaultSpread).sheet
    const lines = (id: string) => renderTooltip(getTemplate(id), { name: '', flavour: '' }, sheet).lines
    expect(lines('assassin-shrink-form')).toContain('Becomes Tiny for 8 s')
    expect(lines('fighter-avatar-form')).toContain('Becomes Huge for 8 s')
    expect(lines('fighter-ascended-form')).toContain('Transforms for 10 s, keeping its size')
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
