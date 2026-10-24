import * as THREE from 'three'
import { commandFrom, type InputState } from './input.js'
import type { ArenaController } from './match-view.js'
import { heroForKey } from './takeover.js'

/**
 * Wires the keyboard, mouse and pointer lock to a live match (U17, KTD16). Watching needs no pointer lock: drag to
 * turn the camera around what it looks at, right drag (or Shift drag) to slide it, the wheel to zoom, WASD to move,
 * Q and E to turn, a click on a hero to follow it and F to follow whoever is in the middle of the screen. Steering
 * a hero locks the pointer: a hero's number key or a double click on it asks for the lock and takes the hero once it
 * is granted; Escape releases it (the browser does that) and the hero goes back to the AI. Tab hands back too.
 */
/** True while the player is typing into a field, where a digit is text, not a hero. */
const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

export function attachControls(c: ArenaController, canvasHost: HTMLElement, onLockChange: (locked: boolean) => void, extra: (code: string) => void = () => {}): () => void {
  const input: InputState = { held: new Set() }
  // looked up each time: after a lost graphics device the stage swaps in a new canvas
  const canvas = () => canvasHost.querySelector('canvas') ?? canvasHost
  const locked = () => document.pointerLockElement === canvas()
  // a number key pressed with the mouse free asks for the lock first; the hero is taken once it is granted
  let pending: number | undefined

  const requestLock = async () => {
    const el = canvas() as HTMLElement & { requestPointerLock: (o?: { unadjustedMovement?: boolean }) => Promise<void> | void }
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
      else if (down && !c.arena.match.paused && !typing(e)) {
        pending = heroForKey(c.arena.match, c.side, e.code)
        void requestLock()
      }
      return
    }
    if (e.code === 'Space') e.preventDefault()
    if (down) input.held.add(e.code)
    else input.held.delete(e.code)
  }
  const keydown = onKey(true)
  const keyup = onKey(false)
  const watching = () => c.arena.match.human === undefined

  /** The living hero drawn nearest a point on the screen, within `reach` pixels of it. */
  const projected = new THREE.Vector3()
  const heroAt = (x: number, y: number, reach = 48): number | undefined => {
    const rect = (canvas() as HTMLElement).getBoundingClientRect()
    const drawn = c.positions()
    let best: number | undefined
    let bestD = reach
    c.arena.match.heroes.forEach((h, i) => {
      const at = drawn[i]
      if (!h.alive || !at) return
      projected.set(at.x, at.y + 1, at.z).project(c.camera)
      if (projected.z > 1) return
      const d = Math.hypot(rect.left + ((projected.x + 1) / 2) * rect.width - x, rect.top + ((1 - projected.y) / 2) * rect.height - y)
      if (d < bestD) [best, bestD] = [i, d]
    })
    return best
  }

  // watching: a press becomes a drag once it moves a few pixels; a press that never moved is a click on a hero
  let drag: { button: number; x: number; y: number; moved: boolean; shift: boolean } | undefined
  let lastClick = { at: 0, hero: -1 }
  const mousemove = (e: MouseEvent) => {
    if (locked()) return void c.cameras.look(e.movementX, e.movementY)
    if (!drag || !watching()) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) < 4) return
    drag.moved = true
    drag.x = e.clientX
    drag.y = e.clientY
    if (drag.button === 0 && !drag.shift) c.cameras.orbit(dx, dy)
    else {
      // grab the ground: it moves with the pointer, so the camera moves the other way
      const k = c.cameras.free.distanceTo(c.cameras.pivot()) * 0.0016
      c.cameras.pan(-dx * k, dy * k)
    }
  }
  const mousedown = (e: MouseEvent) => {
    if (locked()) {
      if (e.button === 0) input.held.add('Mouse0')
      return
    }
    // steering a hero needs the mouse; watching does not
    if (!watching()) return void requestLock()
    drag = { button: e.button, x: e.clientX, y: e.clientY, moved: false, shift: e.shiftKey }
  }
  const mouseup = (e: MouseEvent) => {
    if (e.button === 0) input.held.delete('Mouse0')
    const pressed = drag
    drag = undefined
    if (!pressed || pressed.moved || pressed.button !== 0 || locked() || !watching()) return
    const hero = heroAt(e.clientX, e.clientY)
    const now = performance.now()
    if (hero !== undefined && hero === lastClick.hero && now - lastClick.at < 400 && c.arena.match.heroes[hero].team === c.side) {
      // a double click on one of your heroes takes it
      pending = hero
      void requestLock()
    } else c.cameras.follow = hero
    lastClick = { at: now, hero: hero ?? -1 }
  }
  const wheel = (e: WheelEvent) => {
    if (locked() || !watching()) return
    e.preventDefault()
    c.cameras.zoom(Math.exp(Math.max(-200, Math.min(200, e.deltaY)) * 0.0015))
  }
  const noMenu = (e: MouseEvent) => e.preventDefault()
  const follow = (e: KeyboardEvent) => {
    if (e.code !== 'KeyF' || !watching() || typing(e)) return
    if (c.cameras.follow !== undefined) c.cameras.follow = undefined
    else {
      const rect = (canvas() as HTMLElement).getBoundingClientRect()
      c.cameras.follow = heroAt(rect.left + rect.width / 2, rect.top + rect.height / 2, Infinity)
    }
  }
  const lockchange = () => {
    if (locked() && pending !== undefined) c.take(pending)
    pending = undefined
    if (!locked()) {
      input.held.clear()
      // without the mouse a controlled hero cannot be steered, so the AI takes it back rather than leave it idle;
      // the pause menu frees the mouse too, and keeps the hero until the match resumes
      if (c.arena.match.human !== undefined && !c.arena.match.paused) c.handBack()
    }
    onLockChange(locked())
  }
  window.addEventListener('keydown', keydown)
  window.addEventListener('keydown', follow)
  window.addEventListener('keyup', keyup)
  window.addEventListener('mousemove', mousemove)
  canvasHost.addEventListener('mousedown', mousedown)
  canvasHost.addEventListener('wheel', wheel, { passive: false })
  canvasHost.addEventListener('contextmenu', noMenu)
  window.addEventListener('mouseup', mouseup)
  document.addEventListener('pointerlockchange', lockchange)

  c.hooks.human = () => commandFrom(input, c.cameras.yaw, c.cameras.pitch)
  const offFrame = c.hooks.on('frame', (dt) => {
    // watching: WASD slides the camera, Q and E turn it; a followed hero that falls is let go
    if (watching()) {
      const h = (code: string) => (input.held.has(code) ? 1 : 0)
      c.cameras.fly(dt, h('KeyW') - h('KeyS'), h('KeyD') - h('KeyA'), h('Space') - h('KeyZ'))
      const turn = h('KeyE') - h('KeyQ')
      if (turn) c.cameras.orbit(turn * dt * 280, 0)
      if (c.cameras.follow !== undefined && !c.arena.match.heroes[c.cameras.follow]?.alive) c.cameras.follow = undefined
    }
  })

  return () => {
    window.removeEventListener('keydown', keydown)
    window.removeEventListener('keydown', follow)
    window.removeEventListener('keyup', keyup)
    window.removeEventListener('mousemove', mousemove)
    canvasHost.removeEventListener('mousedown', mousedown)
    canvasHost.removeEventListener('wheel', wheel)
    canvasHost.removeEventListener('contextmenu', noMenu)
    window.removeEventListener('mouseup', mouseup)
    document.removeEventListener('pointerlockchange', lockchange)
    offFrame()
    c.hooks.human = undefined
    if (locked()) document.exitPointerLock()
  }
}
