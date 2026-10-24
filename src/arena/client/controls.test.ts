// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { armyModifiers } from '../../charter/synergy.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { createMatch } from '../engine/match.js'
import { attachControls } from './controls.js'
import type { ArenaController } from './match-view.js'

/** A canvas whose pointer lock is granted (or refused) the way a browser would, with the lock change event after. */
function stage(grant: boolean) {
  const host = document.createElement('div')
  const canvas = document.createElement('canvas')
  host.append(canvas)
  document.body.append(host)
  let lockedTo: Element | null = null
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => lockedTo })
  ;(document as unknown as { exitPointerLock: () => void }).exitPointerLock = () => {
    lockedTo = null
  }
  ;(canvas as unknown as { requestPointerLock: () => Promise<void> }).requestPointerLock = vi.fn(async () => {
    if (!grant) throw new Error('refused')
    lockedTo = canvas
    document.dispatchEvent(new Event('pointerlockchange'))
  })
  return { host, canvas }
}

function controller() {
  const arena = createMatch(armyModifiers([defaultBuild('fighter'), defaultBuild('mage')]), armyModifiers([defaultBuild('tank'), defaultBuild('support')]), 1)
  const take = vi.fn(() => true)
  const handBack = vi.fn()
  const c = { arena, side: 0, take, handBack, cameras: { look: vi.fn(), fly: vi.fn(), yaw: 0, pitch: 0 }, hooks: { on: () => () => {} } } as unknown as ArenaController
  return { c, take }
}

const press = (code: string) => window.dispatchEvent(new KeyboardEvent('keydown', { code }))

afterEach(() => {
  document.body.innerHTML = ''
})

describe('taking a hero with its number key (U17)', () => {
  it('works straight from watching: the key asks for the mouse, and the hero is taken once it is granted', async () => {
    const { host } = stage(true)
    const { c, take } = controller()
    const detach = attachControls(c, host, () => {})
    press('Digit2')
    await vi.waitFor(() => expect(take).toHaveBeenCalledWith(1))
    detach()
  })

  it('takes nothing when the browser refuses the mouse, while paused, or while typing', async () => {
    const refused = stage(false)
    const { c, take } = controller()
    const detach = attachControls(c, refused.host, () => {})
    press('Digit1')
    await Promise.resolve()
    expect(take).not.toHaveBeenCalled()
    c.arena.match.paused = true
    press('Digit1')
    c.arena.match.paused = false
    const field = document.createElement('input')
    document.body.append(field)
    field.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', bubbles: true }))
    await Promise.resolve()
    expect(take).not.toHaveBeenCalled()
    detach()
  })
})
