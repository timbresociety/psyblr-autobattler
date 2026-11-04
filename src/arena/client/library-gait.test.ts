import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { toClip, type ClipFile } from './anim-library.js'
import type { AnimIndex } from './anim-index.js'
import { rollLine, shifted, turned } from './library-gait.js'

const index = JSON.parse(readFileSync('public/anim/standard/index.json', 'utf8')) as AnimIndex
const clip = (name: string) => toClip(name, JSON.parse(readFileSync(`public/anim/standard/m/${name}.json`, 'utf8')) as ClipFile, index)
const deg = (a: number) => (a * 180) / Math.PI

describe('tumbles rolled along the way the hero goes (owner, 2026-11-04)', () => {
  it('reads the line a Mixamo roll goes along off its hips', () => {
    // the dodge roll went over the right shoulder, 65 degrees off the way it was played; the dive roll goes straight
    expect(deg(rollLine(clip('quick_roll_to_run'))!)).toBeCloseTo(-65, -1)
    expect(Math.abs(deg(rollLine(clip('cmu_dive_roll'))!))).toBeLessThan(8)
    expect(Math.abs(deg(rollLine(clip('backflip'))!))).toBeGreaterThan(170)
    expect(rollLine(clip('idle'))).toBeUndefined()
  })

  it('turned by its line, a roll goes straight ahead', () => {
    for (const name of ['quick_roll_to_run', 'falling_to_roll']) {
      const roll = clip(name)
      expect(Math.abs(deg(rollLine(turned(roll, -rollLine(roll)!))!)), name).toBeLessThan(1)
    }
  })
})

describe('hips moved where the engine wants them (owner, 2026-11-04)', () => {
  const hips = (c: ReturnType<typeof clip>) => c.tracks.find((t) => t.name.endsWith('.position'))!
  it('a hang goes forward to the wall all through', () => {
    const hang = clip('hanging_from_a_ledge_idle')
    const moved = hips(shifted(hang, { ahead: 0.4 }))
    hips(hang).values.forEach((v, i) => expect(moved.values[i] - v).toBeCloseTo(i % 3 === 2 ? 0.4 : 0, 5))
  })
  it('a dive comes down to the floor by its end, untouched over its first half', () => {
    const dive = clip('cmu_dive_roll')
    const before = hips(dive)
    const after = hips(shifted(dive, { down: 0.14 }))
    expect(after.values[after.values.length - 2]).toBeCloseTo(0.14, 5)
    const half = before.times.findIndex((t) => t > dive.duration / 2)
    for (let i = 0; i < half; i++) expect(after.values[i * 3 + 1]).toBe(before.values[i * 3 + 1])
  })
})
