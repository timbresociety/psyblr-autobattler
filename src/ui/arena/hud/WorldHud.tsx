import { useEffect, useRef } from 'react'
import { capsule } from '../../../arena/engine/state'
import type { HudController } from './controller'
import { createDamagePool } from './damage'
import { prefersReducedMotion } from './format'
import type { HudHeroInfo } from './model'
import { createOverheads, type OverheadLive } from './overheads'
import { overheadLift, project, screenPoint } from './world'

/**
 * The HUD layer that lives in the 3D world: overhead bars on every hero and floating damage numbers. It mounts once
 * per match and then runs entirely from the frame and event hooks; React never re-renders it.
 */
export function WorldHud({ controller, heroes }: { controller: HudController; heroes: readonly HudHeroInfo[] }) {
  const layer = useRef<HTMLDivElement>(null)
  useEffect(() => (layer.current ? attachWorldHud(layer.current, controller, heroes) : undefined), [controller, heroes])
  return <div ref={layer} className="hud-world" aria-hidden="true" />
}

/** Wire the layer to a live match; returns the teardown. Read live health and cooldowns straight from the engine. */
export function attachWorldHud(el: HTMLElement, controller: HudController, heroes: readonly HudHeroInfo[]) {
  const overheads = createOverheads(el, heroes)
  const damage = createDamagePool(el, { reducedMotion: prefersReducedMotion() })
  const heads = heroes.map(screenPoint)
  // the layer covers the canvas exactly; its size is read on resize, never inside a frame
  const size = { w: el.clientWidth, h: el.clientHeight }
  const measure = () => {
    size.w = el.clientWidth
    size.h = el.clientHeight
  }
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined
  if (observer) observer.observe(el)
  else window.addEventListener('resize', measure)
  const live: OverheadLive = { alive: false, hp: 0, maxHp: 1, shield: 0, ultReady: false }

  const offEvents = controller.hooks.on('events', (events) => {
    const me = controller.arena.match.human
    for (const e of events) {
      // the controlled hero's own health block shows what it takes; numbers over its head would sit in the crosshair
      if (e.type === 'hit' && e.target !== me) damage.spawn(e.target, e.amount, { heavy: e.heavy, own: me !== undefined && e.source === me })
    }
  })
  const offFrame = controller.hooks.on('frame', (dt) => {
    const { camera } = controller
    const { match } = controller.arena
    const drawn = controller.positions()
    // the cameras moved this frame and the renderer has not refreshed the matrices yet
    camera.updateMatrixWorld()
    for (let i = 0; i < heads.length; i++) {
      const hero = match.heroes[i]
      const at = drawn[i]
      if (!hero || !at) continue
      const lift = overheadLift(capsule(hero).height, controller.views[i]?.root.scale.y ?? 1)
      project(camera, at.x, at.y + lift, at.z, size.w, size.h, heads[i])
      live.alive = hero.alive
      live.hp = hero.hp
      live.maxHp = hero.maxHp
      live.shield = hero.shield
      live.ultReady = hero.cooldowns.ultimate <= 0
      overheads.update(i, heads[i], live, match.human === i, dt)
    }
    damage.frame(dt, (t) => heads[t])
  })

  return () => {
    offEvents()
    offFrame()
    observer?.disconnect()
    window.removeEventListener('resize', measure)
    overheads.dispose()
    damage.dispose()
  }
}
