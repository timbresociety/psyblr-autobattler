import { describe, expect, it } from 'vitest'
import type { Delivery } from '../../charter/types.js'
import { fakeDirectorBrain } from '../../forge/director/fake.js'
import { composeRecipe, defaultRecipe, passiveRecipe } from './defaults.js'
import { lookFor } from './looks.js'
import type { EffectRecipe } from './schema.js'
import { validateRecipe } from './validate.js'

const KINDS: Delivery['kind'][] = ['melee', 'projectile', 'beam', 'cone', 'zone', 'self', 'aura', 'dash', 'blink', 'grapple']

describe('effect recipes (U9)', () => {
  it('every delivery kind and both passive visuals have a default recipe that validates', () => {
    for (const kind of KINDS) expect(validateRecipe(defaultRecipe(kind)), kind).toEqual([])
    expect(validateRecipe(passiveRecipe('aura'))).toEqual([])
    expect(validateRecipe(passiveRecipe('body-element'))).toEqual([])
  })

  it('rejects a damaging layer drawn bigger than its hit area', () => {
    const r = defaultRecipe('zone')
    const bad: EffectRecipe = { ...r, layers: r.layers.map((l) => (l.damaging ? { ...l, size: 1.4 } : l)) }
    expect(validateRecipe(bad).some((p) => p.includes('bigger than its hit area'))).toBe(true)
  })

  it('rejects an unknown primitive with a clear problem', () => {
    const r = defaultRecipe('beam')
    const bad = { ...r, layers: [...r.layers, { primitive: 'laser-cat', phase: 'impact', size: 1, color: 0 }] } as unknown as EffectRecipe
    expect(validateRecipe(bad)).toContain('layer 2: unknown primitive "laser-cat"')
  })

  it('turns "spirit bomb" into a charged recipe with a big orb and a sky tint, its hit layer still true to size', () => {
    const look = lookFor('Spirit Bomb')!
    const r = composeRecipe('projectile', look)
    expect(r.charge).toBeGreaterThan(1)
    expect(r.layers.some((l) => l.primitive === 'sky' && l.phase === 'charge')).toBe(true)
    expect(r.layers.some((l) => l.primitive === 'gather')).toBe(true)
    const core = r.layers.find((l) => l.damaging)!
    expect(core.primitive).toBe('orb')
    expect(core.size).toBe(1)
    expect(validateRecipe(r)).toEqual([])
  })

  it('the offline director gives a spirit-bomb skill its look', () => {
    const out = fakeDirectorBrain({ prompt: 'Goku with skills around spirit bomb, instant transmission and kamehameha', referenceCaptions: [], chat: [], answers: { tone: 'heroic' } })
    const skill = out.spec?.skills.find((s) => /spirit bomb/i.test(s.theme))
    expect(skill?.look?.charged).toBe(true)
  })

  it('a recipe survives a JSON round trip unchanged', () => {
    const r = composeRecipe('zone', lookFor('earthquake'))
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
  })
})
