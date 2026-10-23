// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { DAMAGE_CAP, DAMAGE_LIFE, DAMAGE_MERGE, createDamagePool } from './damage'
import type { ScreenPoint } from './world'

const head: ScreenPoint = { x: 400, y: 300, depth: 12, visible: true }

describe('damage numbers (R38)', () => {
  it('never makes more DOM nodes than the cap, however many hits land', () => {
    const layer = document.createElement('div')
    const pool = createDamagePool(layer, { cap: 8 })
    for (let i = 0; i < 100; i++) pool.spawn(i, 50 + i)
    expect(pool.size()).toBe(8)
    expect(layer.children).toHaveLength(8)
    expect(pool.live()).toBe(8)
    // the newest hits are the ones on screen: the oldest gave way
    const shown = [...layer.children].map((n) => Number(n.textContent))
    expect(Math.min(...shown)).toBeGreaterThanOrEqual(50 + 100 - 8)
  })

  it('defaults to a cap that keeps twenty heroes cheap', () => {
    const layer = document.createElement('div')
    const pool = createDamagePool(layer)
    for (let i = 0; i < 500; i++) pool.spawn(i, 10)
    expect(pool.size()).toBe(DAMAGE_CAP)
    expect(DAMAGE_CAP).toBeLessThanOrEqual(48)
  })

  it('reuses a node once its number has faded, instead of making another', () => {
    const layer = document.createElement('div')
    const pool = createDamagePool(layer, { cap: 4 })
    pool.spawn(1, 20)
    pool.frame(DAMAGE_LIFE + 0.01, () => head)
    expect(pool.live()).toBe(0)
    expect((layer.children[0] as HTMLElement).style.visibility).toBe('hidden')
    pool.spawn(2, 30)
    expect(pool.size()).toBe(1)
    expect(layer.children[0].textContent).toBe('30')
  })

  it('pops, rises and fades over its life, heavy hits marked out', () => {
    const layer = document.createElement('div')
    const pool = createDamagePool(layer, { random: () => 0.5 })
    pool.spawn(3, 123.4, { heavy: true })
    const node = layer.children[0] as HTMLElement
    expect(node.textContent).toBe('123')
    expect(node.className).toContain('heavy')
    pool.frame(0.05, () => head)
    expect(node.style.visibility).toBe('visible')
    const y = (n: HTMLElement) => Number(/translate3d\([^,]+, ([-\d.]+)px/.exec(n.style.transform)![1])
    const early = y(node)
    pool.frame(0.5, () => head)
    expect(y(node)).toBeLessThan(early)
    expect(Number(node.style.opacity)).toBeLessThan(1)
  })

  it('adds quick hits on one hero into one number, and starts a new one once the flurry pauses', () => {
    const layer = document.createElement('div')
    const pool = createDamagePool(layer)
    pool.spawn(1, 20)
    pool.frame(0.1, () => head)
    pool.spawn(1, 30.4, { heavy: true })
    expect(pool.size()).toBe(1)
    expect(layer.children[0].textContent).toBe('50')
    expect(layer.children[0].className).toContain('heavy')
    // another hero's hit and the player's own hit on the same hero keep numbers of their own
    pool.spawn(2, 7)
    pool.spawn(1, 9, { own: true })
    expect(pool.size()).toBe(3)
    pool.frame(DAMAGE_MERGE + 0.05, () => head)
    pool.spawn(1, 5)
    expect(pool.size()).toBe(4)
    expect(layer.children[3].textContent).toBe('5')
  })

  it('hides a number whose hero is off screen and skips glancing hits', () => {
    const layer = document.createElement('div')
    const pool = createDamagePool(layer)
    pool.spawn(1, 0.2)
    expect(pool.size()).toBe(0)
    pool.spawn(1, 40)
    pool.frame(0.05, () => ({ ...head, visible: false }))
    expect((layer.children[0] as HTMLElement).style.visibility).toBe('hidden')
    pool.dispose()
    expect(layer.children).toHaveLength(0)
  })
})
