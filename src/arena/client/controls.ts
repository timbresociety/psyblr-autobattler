import { commandFrom, type InputState } from './input'
import type { ArenaController } from './match-view'
import { heroForKey } from './takeover'

/**
 * Wires the keyboard, mouse and pointer lock to a live match (U17, KTD16). Pointer lock starts from a click; Escape
 * releases it (the browser does that) and the screen shows a resume overlay, since Chrome refuses a new lock for
 * about a second after Escape. Tab hands the hero back and keeps the pointer locked.
 */
export function attachControls(c: ArenaController, canvasHost: HTMLElement, onLockChange: (locked: boolean) => void, extra: (code: string) => void = () => {}): () => void {
  const input: InputState = { held: new Set() }
  const canvas = canvasHost.querySelector('canvas') ?? canvasHost
  const locked = () => document.pointerLockElement === canvas

  const requestLock = async () => {
    const el = canvas as HTMLElement & { requestPointerLock: (o?: { unadjustedMovement?: boolean }) => Promise<void> | void }
    try {
      // unadjusted movement turns off OS mouse acceleration where the browser supports it
      await el.requestPointerLock({ unadjustedMovement: true })
    } catch {
      try {
        await el.requestPointerLock()
      } catch {
        // still in the browser's cooldown after Escape: the overlay stays and the next click tries again
      }
    }
  }

  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    if (down) extra(e.code)
    // with the mouse free a menu may be open: Tab moves focus and digits take no hero behind it
    if (e.code === 'Tab' && locked()) {
      e.preventDefault()
      if (down && c.arena.match.human !== undefined) c.handBack()
      return
    }
    if (/^Digit\d$/.test(e.code)) {
      if (down && locked()) c.take(heroForKey(c.arena.match, c.side, e.code))
      return
    }
    if (e.code === 'Space') e.preventDefault()
    if (down) input.held.add(e.code)
    else input.held.delete(e.code)
  }
  const keydown = onKey(true)
  const keyup = onKey(false)
  const mousemove = (e: MouseEvent) => locked() && c.cameras.look(e.movementX, e.movementY)
  const mousedown = (e: MouseEvent) => {
    if (!locked()) return void requestLock()
    if (e.button === 0) input.held.add('Mouse0')
  }
  const mouseup = (e: MouseEvent) => e.button === 0 && input.held.delete('Mouse0')
  const lockchange = () => {
    if (!locked()) {
      input.held.clear()
      // without the mouse a controlled hero cannot be steered, so the AI takes it back rather than leave it idle;
      // the pause menu frees the mouse too, and keeps the hero until the match resumes
      if (c.arena.match.human !== undefined && !c.arena.match.paused) c.handBack()
    }
    onLockChange(locked())
  }
  window.addEventListener('keydown', keydown)
  window.addEventListener('keyup', keyup)
  window.addEventListener('mousemove', mousemove)
  canvasHost.addEventListener('mousedown', mousedown)
  window.addEventListener('mouseup', mouseup)
  document.addEventListener('pointerlockchange', lockchange)

  c.hooks.human = () => commandFrom(input, c.cameras.yaw, c.cameras.pitch)
  const offFrame = c.hooks.on('frame', (dt) => {
    // watching: the free camera flies with the same keys
    if (c.arena.match.human === undefined) {
      const h = (code: string) => (input.held.has(code) ? 1 : 0)
      c.cameras.fly(dt, h('KeyW') - h('KeyS'), h('KeyD') - h('KeyA'), h('Space') - h('KeyZ'))
    }
  })

  return () => {
    window.removeEventListener('keydown', keydown)
    window.removeEventListener('keyup', keyup)
    window.removeEventListener('mousemove', mousemove)
    canvasHost.removeEventListener('mousedown', mousedown)
    window.removeEventListener('mouseup', mouseup)
    document.removeEventListener('pointerlockchange', lockchange)
    offFrame()
    c.hooks.human = undefined
    if (locked()) document.exitPointerLock()
  }
}
