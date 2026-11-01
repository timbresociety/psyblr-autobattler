import { describe, expect, it } from 'vitest'
import type { HeroLook } from '../charter/look.js'
import type { LibraryEntry } from '../kit/wear/library.js'
import { patchLook } from './patch.js'

const entry = (id: string, slot: LibraryEntry['slot'], name = id): LibraryEntry => ({ id, name, slot, tags: [], url: `/kit/wear/${id}.glb`, thumb: '', source: 'built-in', channels: [{ name: 'main', color: '#333333', finish: 'cotton' }], knobs: [] })
const catalog: LibraryEntry[] = [entry('hair_swept', 'hair', 'Swept back'), entry('hair_short', 'hair', 'Short'), entry('leather_jacket', 'upper', 'Leather jacket'), entry('cap', 'head', 'Cap')]

const jensen: HeroLook = {
  gender: 'm',
  physique: { weight: 0.5, muscle: 0.33, age: 0.7 },
  hair: 'none',
  armour: false,
  cape: false,
  colors: { hair: '#55565c', iris: '#3a2a1c', skin: '#d8b090' },
  sculpt: { chin_width: 0.2, nose_width: -0.3 },
  wear: { hair: { id: 'hair_short', url: '/kit/wear/hair_short.glb', colors: ['#55565c'] }, upper: { id: 'tee', url: '/kit/wear/tee.glb' }, head: { id: 'cap', url: '/kit/wear/cap.glb' } },
}

describe('natural-language patches to a built hero', () => {
  it('nudges the named part and keeps the rest of the sculpt', () => {
    const p = patchLook(jensen, 'give him a stronger jaw', catalog)!
    expect(p.said).toEqual(['stronger jaw'])
    expect(p.look.sculpt!.chin_width).toBeCloseTo(0.2 + 0.25 * 0.7, 1)
    expect(p.look.sculpt!.jaw_prognathism).toBeCloseTo(0.25 * 0.5, 1)
    expect(p.look.sculpt!.nose_width).toBe(-0.3)
  })

  it('reads two parts in one message, "much" doubling the nudge, and words for a feature', () => {
    const p = patchLook(jensen, 'a much bigger nose and smaller ears, with high cheekbones', catalog)!
    expect(p.said).toEqual(expect.arrayContaining(['bigger nose', 'smaller ears']))
    expect(p.look.sculpt!.nose_length).toBeCloseTo(0.5, 2)
    expect(p.look.sculpt!.ear_size).toBeCloseTo(-0.25, 2)
    expect(p.look.sculpt!.cheekbones).toBeCloseTo(0.7, 2)
  })

  it('shades a part by comparison and names a colour on another', () => {
    const p = patchLook(jensen, 'greyer hair and blue eyes', catalog)!
    expect(p.said).toEqual(expect.arrayContaining(['greyer hair', 'blue eyes']))
    expect(p.look.colors.iris).toBe('#2a5bd7')
    expect(p.look.colors.hair).not.toBe('#55565c')
    // and the hair worn takes the colour
    expect(p.look.wear!.hair!.colors![0]).toBe(p.look.colors.hair)
    expect(p.look.colors.skin).toBe('#d8b090')
  })

  it('moves the build a step at a time', () => {
    const p = patchLook(jensen, 'make him older and slimmer', catalog)!
    expect(p.look.physique).toEqual({ weight: 0.35, muscle: 0.33, age: 0.85 })
    expect(p.said).toEqual(['older', 'slimmer'])
  })

  it('dresses a named garment or hair style from the catalogue, and takes a named one off', () => {
    const p = patchLook(jensen, 'swept back hair and a leather jacket, no hat', catalog)!
    expect(p.look.wear!.hair!.id).toBe('hair_swept')
    expect(p.look.wear!.hair!.colors).toEqual(['#55565c'])
    expect(p.look.wear!.upper!.id).toBe('leather_jacket')
    expect(p.look.wear!.head).toBeUndefined()
  })

  it('leaves a message about stats alone', () => {
    expect(patchLook(jensen, 'more damage and less health', catalog)).toBeUndefined()
    expect(patchLook(jensen, 'make the ultimate hit harder', catalog)).toBeUndefined()
  })
})
