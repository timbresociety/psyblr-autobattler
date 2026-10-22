// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { QUALITY_LEVELS, createGuard, observe } from './quality'
import { loadAudio, saveAudio } from './settings'

describe('frame-rate guard (U18)', () => {
  it('steps quality down one level at a time under sustained 20 ms frames', () => {
    const g = createGuard()
    const seen: string[] = []
    for (let i = 0; i < 400; i++) seen.push(observe(g, 20))
    const changes = seen.filter((l, i) => i > 0 && l !== seen[i - 1])
    expect(changes.length).toBeGreaterThan(1)
    for (let i = 1; i < seen.length; i++) expect(Math.abs(QUALITY_LEVELS.indexOf(seen[i] as never) - QUALITY_LEVELS.indexOf(seen[i - 1] as never))).toBeLessThanOrEqual(1)
  })

  it('steps back up under sustained 12 ms frames', () => {
    const g = createGuard()
    for (let i = 0; i < 400; i++) observe(g, 20)
    const low = g.level
    for (let i = 0; i < 600; i++) observe(g, 11)
    expect(g.level).toBeLessThan(low)
  })
})

describe('audio settings (U18, R41)', () => {
  it('mute and volume survive a reload', () => {
    saveAudio({ volume: 0.25, muted: true })
    expect(loadAudio()).toEqual({ volume: 0.25, muted: true })
  })
})
