import { describe, expect, it } from 'vitest'
import { effectScale, effectWindow, pickAnimation, viewerSource } from './viewer.js'

describe('hero viewer logic (U12)', () => {
  it('picks the clip by its file, and falls back to the preset name', () => {
    expect(pickAnimation({ kind: 'clip', url: 'https://x/clips/uppercut.glb' }, ['idle', 'uppercut'])).toBe('uppercut')
    expect(pickAnimation({ kind: 'preset', preset: 'slash' }, ['Armature|idle', 'Armature|slash'])).toBe('Armature|slash')
    expect(pickAnimation({ kind: 'preset', preset: 'run' }, ['idle'])).toBeUndefined()
  })

  it('a missing or fake mesh selects the mannequin', () => {
    expect(viewerSource(undefined)).toBe('mannequin')
    expect(viewerSource('fake://rig/abc.glb')).toBe('mannequin')
    expect(viewerSource('https://blob/forge/x/mesh/1/mesh.fbx')).toBe('mannequin')
    expect(viewerSource('https://blob/forge/x/motion/1/rig.glb')).toBe('glb')
  })

  it('effect timing follows the cast window, never the cooldown', () => {
    const melee = effectWindow({ kind: 'melee', range: 2 }, 1)
    expect(melee).toEqual({ start: 0.4, end: 0.65 })
    const beam = effectWindow({ kind: 'beam', range: 12 }, 2)
    expect(beam.end - beam.start).toBeCloseTo(1.2)
    const bolt = effectWindow({ kind: 'projectile', range: 15 }, 2)
    expect(bolt.end - bolt.start).toBeCloseTo(0.5)
    expect(effectWindow({ kind: 'aura', range: 0 }, 2)).toEqual({ start: 0, end: 2 })
  })

  it('effects are sized by the mechanic’s range and radius', () => {
    expect(effectScale({ delivery: 'zone', range: 8, radius: 3 })).toEqual({ width: 6, height: 6 })
    expect(effectScale({ delivery: 'beam', range: 12 })).toEqual({ width: 12, height: 1 })
  })
})
