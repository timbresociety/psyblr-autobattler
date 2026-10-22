// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { armyModifiers } from '../../charter/synergy'
import { defaultBuild } from '../../sim/fixtures'
import { createMatch } from '../engine/match'
import { attachControls } from './controls'
import { createHooks, type ArenaController } from './match-view'

/** Just enough of a live match for the controls: the match, hooks, cameras and the take / hand-back calls. */
function controller() {
  const arena = createMatch(armyModifiers([defaultBuild('fighter'), defaultBuild('mage')]), armyModifiers([defaultBuild('tank')]), 1)
  const hooks = createHooks()
  const c = {
    arena,
    hooks,
    side: 0,
    cameras: { yaw: 0, pitch: 0, look: vi.fn(), fly: vi.fn() },
    take: vi.fn((hero: number | undefined) => {
      if (hero === undefined) return false
      arena.match.human = hero
      return true
    }),
    handBack: vi.fn(() => void (arena.match.human = undefined)),
  } as unknown as ArenaController & { hooks: ReturnType<typeof createHooks> }
  const host = document.createElement('div')
  host.append(document.createElement('canvas'))
  document.body.append(host)
  return { c, host, canvas: host.querySelector('canvas')! }
}

const lock = (el: Element | null) => {
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => el })
  document.dispatchEvent(new Event('pointerlockchange'))
}
const key = (code: string, type: 'keydown' | 'keyup' = 'keydown') => window.dispatchEvent(new KeyboardEvent(type, { code, cancelable: true }))

// jsdom has no pointer lock; detaching while locked releases it
document.exitPointerLock = () => lock(null)

afterEach(() => {
  lock(null)
  document.body.innerHTML = ''
})

describe('attachControls (U17)', () => {
  it('with the mouse captured, a digit takes a hero and Tab hands it back', () => {
    const { c, host, canvas } = controller()
    const detach = attachControls(c, host, () => {})
    lock(canvas)
    key('Digit1')
    expect(c.take).toHaveBeenCalledWith(0)
    expect(c.arena.match.human).toBe(0)
    key('Tab')
    expect(c.handBack).toHaveBeenCalled()
    detach()
  })

  it('with the mouse free, digits and Tab leave the match alone so menus stay usable', () => {
    const { c, host } = controller()
    const detach = attachControls(c, host, () => {})
    key('Digit1')
    expect(c.take).not.toHaveBeenCalled()
    const tab = new KeyboardEvent('keydown', { code: 'Tab', cancelable: true })
    window.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(false)
    detach()
  })

  it('losing the mouse mid-fight hands the hero back to the AI, but pausing keeps it', () => {
    const { c, host, canvas } = controller()
    const detach = attachControls(c, host, () => {})
    lock(canvas)
    key('Digit1')
    c.arena.match.paused = true
    lock(null)
    expect(c.arena.match.human).toBe(0)
    c.arena.match.paused = false
    lock(canvas)
    lock(null)
    expect(c.arena.match.human).toBeUndefined()
    detach()
  })

  it('detaching removes every listener and the frame hook', () => {
    const { c, host, canvas } = controller()
    const detach = attachControls(c, host, () => {})
    detach()
    lock(canvas)
    key('Digit1')
    expect(c.take).not.toHaveBeenCalled()
    c.hooks.emit.frame(0.016, 0)
    expect(c.cameras.fly).not.toHaveBeenCalled()
    expect(c.hooks.human).toBeUndefined()
  })
})

describe('frame hooks', () => {
  it('runs listeners in the order added, and each removal drops only its own', () => {
    const hooks = createHooks()
    const order: string[] = []
    const offA = hooks.on('frame', () => order.push('a'))
    hooks.on('frame', () => order.push('b'))
    hooks.emit.frame(0, 0)
    offA()
    hooks.emit.frame(0, 0)
    expect(order).toEqual(['a', 'b', 'b'])
  })
})
