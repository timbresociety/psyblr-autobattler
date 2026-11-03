// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { QUALITY_LEVELS, SCALER, TARGET_PIXELS, atFloor, basePixelRatio, createGuard, createScaler, observe, scaleFor } from './quality.js'
import { loadAudio, saveAudio } from './settings.js'

describe('frame-rate guard (U18)', () => {
  it('steps quality down one level at a time under sustained 25 ms frames', () => {
    const g = createGuard()
    const seen: string[] = []
    for (let i = 0; i < 400; i++) seen.push(observe(g, 25))
    const changes = seen.filter((l, i) => i > 0 && l !== seen[i - 1])
    expect(changes.length).toBeGreaterThan(1)
    for (let i = 1; i < seen.length; i++) expect(Math.abs(QUALITY_LEVELS.indexOf(seen[i] as never) - QUALITY_LEVELS.indexOf(seen[i - 1] as never))).toBeLessThanOrEqual(1)
  })

  it('steps back up once a vsync-capped display holds 60 fps', () => {
    const g = createGuard()
    for (let i = 0; i < 400; i++) observe(g, 25)
    const low = g.level
    for (let i = 0; i < 60 * 12; i++) observe(g, 1000 / 60)
    expect(g.level).toBeLessThan(low)
  })

  it('ignores a single stall, such as returning to the tab', () => {
    const g = createGuard()
    for (let i = 0; i < 300; i++) observe(g, 1000 / 60)
    observe(g, 250)
    for (let i = 0; i < 300; i++) observe(g, 1000 / 60)
    expect(g.level).toBe(0)
  })

  it('waits longer before each step up that does not hold', () => {
    const g = createGuard()
    for (let i = 0; i < 200; i++) observe(g, 25)
    const first = g.upDelay
    // headroom at the lower level, then load again right after stepping up
    for (let round = 0; round < 2; round++) {
      while (!g.probing) observe(g, 1000 / 60)
      for (let i = 0; i < 200 && g.probing; i++) observe(g, 25)
    }
    expect(g.upDelay).toBeGreaterThan(first)
  })
})

describe('render scale (Forge goal, phase 0)', () => {
  it('scales down in steps sized to how slow frames are, and stops at the floor', () => {
    const s = createScaler()
    const seen: number[] = []
    for (let i = 0; i < 60 * 3; i++) seen.push(scaleFor(s, 33))
    // a 33 ms frame wants about 0.71 of the pixels per axis, which is the largest single step
    expect(seen.find((v) => v < 1)).toBeCloseTo(0.71, 2)
    for (let i = 0; i < 60 * 10; i++) scaleFor(s, 33)
    expect(atFloor(s)).toBe(true)
    expect(s.scale).toBeCloseTo(SCALER.min)
  })

  it('creeps back up with headroom and backs off after a step up that does not hold', () => {
    const s = createScaler()
    for (let i = 0; i < 60 * 3; i++) scaleFor(s, 25)
    const low = s.scale
    for (let i = 0; i < 60 * 5; i++) scaleFor(s, 1000 / 60)
    expect(s.scale).toBeGreaterThan(low)
    const delay = s.upDelay
    while (!s.probing) scaleFor(s, 1000 / 60)
    for (let i = 0; i < 60 * 2 && s.probing; i++) scaleFor(s, 25)
    expect(s.upDelay).toBeGreaterThan(delay)
  })

  it('ignores stalls', () => {
    const s = createScaler()
    for (let i = 0; i < 120; i++) scaleFor(s, i % 30 === 0 ? 400 : 1000 / 60)
    expect(s.scale).toBe(SCALER.max)
  })
})

describe('the 1440 × 900 target (GAME.md §10)', () => {
  it('the drawing buffer is never bigger than 1440 × 900 pixels, and never denser than the screen', () => {
    // a MacBook Air's full-screen browser window, at its Retina density
    const air = basePixelRatio(1440, 821, 2)
    expect(1440 * air * 821 * air).toBeLessThanOrEqual(TARGET_PIXELS + 1)
    // a large external screen
    const big = basePixelRatio(2560, 1340, 1)
    expect(2560 * big * 1340 * big).toBeLessThanOrEqual(TARGET_PIXELS + 1)
    // a small window keeps the screen's own density, up to 2x
    expect(basePixelRatio(800, 500, 1)).toBe(1)
    expect(basePixelRatio(600, 400, 3)).toBe(2)
  })
})

describe('audio settings (U18, R41)', () => {
  it('mute and volume survive a reload', () => {
    saveAudio({ volume: 0.25, muted: true })
    expect(loadAudio()).toEqual({ volume: 0.25, muted: true })
  })
})
