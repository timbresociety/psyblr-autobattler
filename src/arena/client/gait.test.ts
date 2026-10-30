import { describe, expect, it } from 'vitest'
import { GAIT_CLIPS, pickTier, strideSeconds, strideTime, tierClips, tierSpeed, wayWeights, type Gait } from './gait.js'

// the masculine library as scripts/rpm-anim.ts measured it
const GAITS: Record<string, Gait> = {
  walk: { speed: 1.58, strides: 2, strike: 0.75 },
  walk_back: { speed: 1.35, strides: 3, strike: 0.667 },
  walk_left: { speed: 1.41, strides: 2, strike: 0.792 },
  walk_right: { speed: 1.4, strides: 2, strike: 0.292 },
  jog: { speed: 3.39, strides: 1, strike: 0.583 },
  jog_back: { speed: 3.02, strides: 1, strike: 0.5 },
  jog_left: { speed: 3.84, strides: 1, strike: 0.542 },
  jog_right: { speed: 3.92, strides: 1, strike: 0.208 },
  run: { speed: 5.45, strides: 1, strike: 0.458 },
  run_back: { speed: 4.3, strides: 1, strike: 0.375 },
  run_left: { speed: 5.26, strides: 1, strike: 0.458 },
  run_right: { speed: 5.45, strides: 1, strike: 0.167 },
}
const DURATIONS: Record<string, number> = { walk: 1.92, walk_back: 2.75, walk_left: 2, walk_right: 2, jog: 0.71, jog_back: 0.63, jog_left: 0.67, jog_right: 0.67, run: 0.58, run_back: 0.46, run_left: 0.5, run_right: 0.5 }

describe('the gait', () => {
  it('names every clip it blends, each tier forward, left, back and right', () => {
    expect(tierClips('jog')).toEqual(['jog', 'jog_left', 'jog_back', 'jog_right'])
    expect(GAIT_CLIPS).toHaveLength(12)
  })

  it('plays one way straight on, and the two either side of a heading between them', () => {
    expect(wayWeights(0)).toEqual([1, 0, 0, 0])
    expect(wayWeights(Math.PI / 2)).toEqual([0, 1, 0, 0])
    expect(wayWeights(-Math.PI / 2)).toEqual([0, 0, 0, 1])
    const back = wayWeights(Math.PI)
    expect(back[2]).toBeCloseTo(1)
    const diagonal = wayWeights(Math.PI / 4)
    expect(diagonal[0]).toBeCloseTo(0.5)
    expect(diagonal[1]).toBeCloseTo(0.5)
    const rightBack = wayWeights(-0.75 * Math.PI)
    expect(rightBack[2]).toBeCloseTo(0.5)
    expect(rightBack[3]).toBeCloseTo(0.5)
    for (const h of [-7, -1, 0.3, 2, 9]) expect(wayWeights(h).reduce((s, w) => s + w, 0)).toBeCloseTo(1)
  })

  it('picks the tier nearest the speed, and holds it until the speed is well past halfway to the next', () => {
    const ahead = wayWeights(0)
    expect(pickTier(GAITS, ahead, 1.5, undefined)).toBe('walk')
    expect(pickTier(GAITS, ahead, 3.2, undefined)).toBe('jog')
    expect(pickTier(GAITS, ahead, 5.5, undefined)).toBe('run')
    // halfway between jog and run (geometric) is about 4.3 m/s: a jog holds just past it, and gives way well past it
    expect(pickTier(GAITS, ahead, 4.5, 'jog')).toBe('jog')
    expect(pickTier(GAITS, ahead, 4.5, 'run')).toBe('run')
    expect(pickTier(GAITS, ahead, 5.0, 'jog')).toBe('run')
    expect(pickTier(GAITS, ahead, 3.6, 'run')).toBe('jog')
    expect(tierSpeed(GAITS, 'run', wayWeights(Math.PI / 4))).toBeCloseTo((5.45 + 5.26) / 2)
  })

  it('starts each clip’s stride where its left foot lands, and wraps round its loop', () => {
    expect(strideTime(GAITS.run, DURATIONS.run, 0)).toBeCloseTo(0.458)
    expect(strideTime(GAITS.run, DURATIONS.run, 0.5)).toBeCloseTo((0.458 + 0.29) % 0.58)
    // a clip with two strides covers half of itself each stride
    expect(strideTime(GAITS.walk, DURATIONS.walk, 0.5)).toBeCloseTo(0.75 + 0.48)
    expect(strideTime(GAITS.walk, DURATIONS.walk, 1.25)).toBeCloseTo(0.75 + 0.24)
    expect(strideSeconds(GAITS, DURATIONS, 'walk', wayWeights(0))).toBeCloseTo(0.96)
    expect(strideSeconds(GAITS, DURATIONS, 'run', wayWeights(Math.PI / 4))).toBeCloseTo((0.58 + 0.5) / 2)
  })
})
