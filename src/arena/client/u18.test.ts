// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { QUALITY_LEVELS, createGuard, observe } from './quality'
import { loadAudio, saveAudio } from './settings'

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

describe('audio settings (U18, R41)', () => {
  it('mute and volume survive a reload', () => {
    saveAudio({ volume: 0.25, muted: true })
    expect(loadAudio()).toEqual({ volume: 0.25, muted: true })
  })
})
