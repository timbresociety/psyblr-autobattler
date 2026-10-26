import { describe, expect, it } from 'vitest'
import { createAnimator, onEvents, settle } from './animation'
import { createClock, frame } from './loop'
import { createStore } from './store'
import { createHero, emptyMatch, prepareHero } from '../engine/state'
import { defaultBuild } from '../../sim/fixtures'

describe('arena client core (U13)', () => {
  it('runs two ticks per frame at 30 fps and one every other frame at 120 fps', () => {
    const c = createClock()
    expect(frame(c, 1 / 30).ticks).toBe(2)
    const c2 = createClock()
    const counts = Array.from({ length: 8 }, () => frame(c2, 1 / 120).ticks)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(4)
    expect(Math.max(...counts)).toBe(1)
  })

  it('runs no ticks while paused, keeps alpha in [0, 1), and caps a long stall', () => {
    const c = createClock()
    for (let i = 0; i < 50; i++) {
      const { alpha } = frame(c, Math.random() / 20)
      expect(alpha).toBeGreaterThanOrEqual(0)
      expect(alpha).toBeLessThan(1)
    }
    c.paused = true
    expect(frame(c, 1).ticks).toBe(0)
    c.paused = false
    expect(frame(c, 10).ticks).toBeLessThanOrEqual(16)
  })

  it('tells subscribers at most about 10 times a second', () => {
    let t = 0
    const store = createStore(0, 10, () => t)
    let calls = 0
    store.subscribe(() => calls++)
    for (let i = 0; i < 60; i++) {
      t += 1000 / 60
      store.set(i)
    }
    expect(calls).toBeGreaterThanOrEqual(9)
    expect(calls).toBeLessThanOrEqual(11)
    store.flush()
    expect(calls).toBeGreaterThanOrEqual(10)
  })

  it('moves the animation from run to cast to idle on a cast, and to dead on death', () => {
    const hero = createHero(prepareHero(defaultBuild('fighter')), 0, 0, { x: 0, y: 0, z: 0 })
    const a = createAnimator()
    expect(settle(a, hero, 0.2, 1, 1 / 60).kind).toBe('run')
    onEvents(a, 0, [{ type: 'cast', hero: 0, slot: 'active1', templateId: 'x' }])
    expect(settle(a, hero, 0, 2, 1 / 60).kind).toBe('cast')
    for (let i = 0; i < 40; i++) settle(a, hero, 0, 3 + i, 1 / 60)
    expect(a.state.kind).toBe('idle')
    onEvents(a, 0, [{ type: 'death', hero: 0 }])
    expect(settle(a, hero, 1, 50, 1 / 60).kind).toBe('dead')
    hero.airborne = true
    const b = createAnimator()
    expect(settle(b, hero, 0, 1, 1 / 60).kind).toBe('fly')
    expect(emptyMatch(1).tick).toBe(0)
  })
})
