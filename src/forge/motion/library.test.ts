import { describe, expect, it } from 'vitest'
import { CATALOG } from '../../charter/templates/catalog'
import { FLIGHT_SET, MOVEMENT_SET, TRIPO_PRESETS, basicMotions, motionsFor, playable, presetsNeeded } from './library'

describe('motion library (U6)', () => {
  it('every catalogue template resolves to 1-3 motions, each with a Tripo preset fallback', () => {
    for (const t of CATALOG) {
      const motions = motionsFor(t)
      expect(motions.length, t.id).toBeGreaterThanOrEqual(1)
      expect(motions.length, t.id).toBeLessThanOrEqual(3)
      for (const m of motions) expect(TRIPO_PRESETS).toContain(m.fallbackPreset)
    }
  })

  it('movement includes idle, walk, run and jump', () => {
    expect(MOVEMENT_SET.map((m) => m.preset)).toEqual(expect.arrayContaining(['idle', 'walk', 'run', 'jump']))
  })

  it('a ranged basic attack maps to shoot, a melee one to slash', () => {
    expect(basicMotions('ranged')[0].preset).toBe('shoot')
    expect(basicMotions('melee')[0].preset).toBe('slash')
  })

  it('an unlicensed clip plays its fallback preset; a licensed clip plays the clip', () => {
    const [, uppercut] = basicMotions('melee')
    expect(playable(uppercut)).toEqual({ kind: 'preset', preset: 'slash' })
    expect(playable({ ...uppercut, clipUrl: 'https://clips/uppercut.glb' })).toEqual({ kind: 'clip', url: 'https://clips/uppercut.glb' })
  })

  it('every hero gets five flight motions, each playing its fallback preset until clips are licensed (R32)', () => {
    expect(FLIGHT_SET.map((m) => m.label)).toEqual(['Take off', 'Hover', 'Fly', 'Air dash', 'Land'])
    expect(FLIGHT_SET.map((m) => playable(m))).toEqual([
      { kind: 'preset', preset: 'jump' },
      { kind: 'preset', preset: 'fall' },
      { kind: 'preset', preset: 'dive' },
      { kind: 'preset', preset: 'dive' },
      { kind: 'preset', preset: 'fall' },
    ])
    expect(presetsNeeded([...MOVEMENT_SET, ...FLIGHT_SET])).toEqual(expect.arrayContaining(['dive', 'fall']))
  })

  it('the presets needed for retargeting are deduplicated', () => {
    expect(presetsNeeded([...MOVEMENT_SET, ...basicMotions('melee')])).toEqual(['idle', 'walk', 'run', 'jump', 'fall', 'turn', 'slash'])
  })
})
