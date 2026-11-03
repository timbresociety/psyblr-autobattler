import { describe, expect, it } from 'vitest'
import type { HeroLook } from '../charter/look.js'
import { patchLook } from './patch.js'

const jensen: HeroLook = {
  gender: 'm',
  physique: { weight: 0.5, muscle: 0.33, age: 0.7 },
  colors: { brow: '#55565c', iris: '#3a2a1c', skin: '#d8b090' },
  sculpt: { chin_width: 0.2, nose_width: -0.3 },
  gear: { hand_l: { id: 'shield', url: '/kit/pieces/shield.glb' } },
}

describe('natural-language patches to a built hero', () => {
  it('nudges the named part and keeps the rest of the sculpt', () => {
    const p = patchLook(jensen, 'give him a stronger jaw')!
    expect(p.said).toEqual(['stronger jaw'])
    expect(p.look.sculpt!.chin_width).toBeCloseTo(0.2 + 0.25 * 0.7, 1)
    expect(p.look.sculpt!.jaw_prognathism).toBeCloseTo(0.25 * 0.5, 1)
    expect(p.look.sculpt!.nose_width).toBe(-0.3)
  })

  it('reads two parts in one message, "much" doubling the nudge, and words for a feature', () => {
    const p = patchLook(jensen, 'a much bigger nose and smaller ears, with high cheekbones')!
    expect(p.said).toEqual(expect.arrayContaining(['bigger nose', 'smaller ears']))
    expect(p.look.sculpt!.nose_length).toBeCloseTo(0.5, 2)
    expect(p.look.sculpt!.ear_size).toBeCloseTo(-0.25, 2)
    expect(p.look.sculpt!.cheekbones).toBeCloseTo(0.7, 2)
  })

  it('shades a part by comparison and names a colour on another', () => {
    const p = patchLook(jensen, 'greyer brows and blue eyes')!
    expect(p.said).toEqual(expect.arrayContaining(['greyer brows', 'blue eyes']))
    expect(p.look.colors.iris).toBe('#2a5bd7')
    expect(p.look.colors.brow).not.toBe('#55565c')
    expect(p.look.colors.skin).toBe('#d8b090')
  })

  it('moves the build a step at a time', () => {
    const p = patchLook(jensen, 'make him older and slimmer')!
    expect(p.look.physique).toEqual({ weight: 0.35, muscle: 0.33, age: 0.85 })
    expect(p.said).toEqual(['older', 'slimmer'])
  })

  it('puts a named piece in a hand and takes a named one away', () => {
    const p = patchLook(jensen, 'give him a katana, no shield')!
    expect(p.look.gear).toEqual({ hand_r: { id: 'katana', url: '/kit/pieces/katana.glb' } })
    expect(p.said).toEqual(['katana', 'no round shield'])
    expect(patchLook(jensen, 'make him unarmed')!.look.gear).toBeUndefined()
  })

  it('never dresses the hero: heroes are drawn bare', () => {
    expect(patchLook(jensen, 'a leather jacket and a top hat')).toBeUndefined()
  })

  it('leaves a message about stats alone', () => {
    expect(patchLook(jensen, 'more damage and less health')).toBeUndefined()
    expect(patchLook(jensen, 'make the ultimate hit harder')).toBeUndefined()
  })
})
