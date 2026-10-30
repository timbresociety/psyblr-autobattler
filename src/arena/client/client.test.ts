import { describe, expect, it } from 'vitest'
import { STANCE, createAnimator, onEvents, settle, stance } from './animation.js'
import { createClock, frame } from './loop.js'
import { createStore } from './store.js'
import { createHero, emptyMatch, prepareHero } from '../engine/state.js'
import { defaultBuild } from '../../sim/fixtures.js'

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
    onEvents(a, 0, [{ type: 'cast', hero: 0, slot: 'active1', templateId: 'x', release: 14, ends: 30 }], 2)
    expect(settle(a, hero, 0, 2, 1 / 60).kind).toBe('cast')
    for (let i = 0; i < 40; i++) settle(a, hero, 0, 3 + i, 1 / 60)
    expect(a.state.kind).toBe('idle')
    onEvents(a, 0, [{ type: 'death', hero: 0 }], 50)
    expect(settle(a, hero, 1, 50, 1 / 60).kind).toBe('dead')
    hero.airborne = true
    const b = createAnimator()
    expect(settle(b, hero, 0, 1, 1 / 60).kind).toBe('fly')
    expect(emptyMatch(1).tick).toBe(0)
  })
})

describe('how a hero stands while it moves (Forge goal, phase 1)', () => {
  const deg = (d: number) => (d * Math.PI) / 180
  // a long frame, so the hips finish turning
  const still = { body: 0, twist: 0, back: false, pivot: false }
  const settled = (aim: number, move: { x: number; z: number } | undefined, mode: 'run' | 'stand' | 'square' = 'run') => stance(still, aim, move, mode, 1)

  it('runs where it goes and twists its chest back to its aim, strafing', () => {
    // aiming along +z, moving along +x: the hips face +x and the chest turns back a quarter turn
    const s = settled(0, { x: 1, z: 0 })
    expect(s.body).toBeCloseTo(deg(90))
    expect(s.twist).toBeCloseTo(deg(-90))
    expect(s.back).toBe(false)
    expect(s.body + s.twist).toBeCloseTo(0)
  })

  it('faces its aim and runs backwards when it backs away, and doesn\u2019t flip back and forth near the line', () => {
    const s = settled(0, { x: 0.1, z: -1 })
    expect(s.back).toBe(true)
    expect(Math.abs(s.twist)).toBeLessThan(deg(10))
    // a quarter turn off the aim: whichever way it was running, it keeps running that way
    const off = { x: 1, z: 0 }
    expect(stance({ ...still, body: deg(90), twist: deg(-90) }, 0, off, 'run', 1 / 60).back).toBe(false)
    expect(stance({ ...still, body: deg(-90), twist: deg(90), back: true }, 0, off, 'run', 1 / 60).back).toBe(true)
    // and neither way twists the chest past its limit, so the hips stay on the line the legs run along
    for (let a = 0; a <= 180; a += 5) {
      const move = { x: Math.sin(deg(a)), z: Math.cos(deg(a)) }
      for (const back of [false, true]) {
        const s = stance({ ...still, body: back ? deg(a + 180) : deg(a), back }, 0, move, 'run', 1)
        expect(Math.abs(s.twist)).toBeLessThanOrEqual(STANCE.twist + 1e-9)
        expect(Math.abs(Math.sin(s.body - deg(a)))).toBeLessThan(1e-9)
      }
    }
  })

  it('squares up to its aim flying', () => {
    expect(settled(deg(30), undefined, 'square')).toEqual({ body: expect.closeTo(deg(30)), twist: expect.closeTo(0), back: false, pivot: false })
    expect(settled(0, { x: 1, z: 0 }, 'square').body).toBeCloseTo(0)
  })

  it('keeps its feet still standing: the chest follows the aim, and the hips turn only once it is far round', () => {
    // a small turn of the aim twists the chest and leaves the hips (and so the feet) where they were
    expect(settled(deg(30), undefined, 'stand')).toEqual({ body: 0, twist: expect.closeTo(deg(30)), back: false, pivot: false })
    // a big one turns the hips at their rate, and they keep turning until they face the aim, past the dead zone
    let s = stance(still, deg(90), undefined, 'stand', 1 / 60)
    expect(s.pivot).toBe(true)
    expect(s.body).toBeCloseTo(STANCE.turn / 60)
    for (let k = 0; k < 30 && s.pivot; k++) s = stance(s, deg(90), undefined, 'stand', 1 / 60)
    expect(s.body).toBeCloseTo(deg(90))
    expect(s.twist).toBeCloseTo(0)
    expect(stance(s, deg(90), undefined, 'stand', 1 / 60).pivot).toBe(false)
  })

  it('turns its hips at a limited rate, and never twists past its limit', () => {
    const turning = stance(still, 0, { x: 1, z: 0 }, 'run', 1 / 60)
    expect(turning.body).toBeCloseTo(STANCE.turn / 60)
    // a sudden aim far behind the hips drags them round
    const dragged = stance({ ...still, body: deg(90) }, deg(-100), undefined, 'square', 1 / 60)
    expect(Math.abs(dragged.twist)).toBeLessThanOrEqual(STANCE.twist + 1e-9)
  })
})
