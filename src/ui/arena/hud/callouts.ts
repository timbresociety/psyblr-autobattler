import { distanceScale, type ScreenPoint } from './world.js'

/**
 * A move's name called out as it's cast, the way anime fighters shout theirs: the skill's own name over the caster's
 * head, in the colours of its look. Only skills whose look asks for it are called (a famous move, an ultimate). Like
 * the damage numbers it is a small fixed pool of DOM nodes moved straight from the frame hook. A hero shows one call
 * at a time and a new cast replaces it; the controlled hero's own call sits low in the middle of the screen, clear
 * of the crosshair.
 */

export const CALLOUT_LIFE = 1.3
export const CALLOUT_CAP = 6

interface Call {
  node: HTMLSpanElement
  hero: number
  age: number
  born: number
  live: boolean
  shown: boolean
  fixed: boolean
}

export interface CalloutPool {
  /** `colors` are the look's core and glow. */
  spawn: (hero: number, text: string, colors: readonly [string, string], options?: { fixed?: boolean }) => void
  /** Advance and place every call: `anchor` gives the point over each hero's head, `fixedAt` the controlled hero's spot. */
  frame: (dt: number, anchor: (hero: number) => ScreenPoint | undefined, fixedAt: { x: number; y: number }) => void
  live: () => number
  size: () => number
  dispose: () => void
}

export function createCalloutPool(layer: HTMLElement, options: { cap?: number; reducedMotion?: boolean } = {}): CalloutPool {
  const cap = Math.max(1, options.cap ?? CALLOUT_CAP)
  const still = options.reducedMotion ?? false
  const calls: Call[] = []
  let serial = 0

  const conceal = (c: Call) => {
    if (!c.shown) return
    c.node.style.visibility = 'hidden'
    c.shown = false
  }

  return {
    spawn(hero, text, colors, { fixed = false } = {}) {
      let c = calls.find((x) => x.live && x.hero === hero) ?? calls.find((x) => !x.live)
      if (!c && calls.length < cap) {
        const node = document.createElement('span')
        node.style.visibility = 'hidden'
        layer.append(node)
        c = { node, hero, age: 0, born: 0, live: false, shown: false, fixed: false }
        calls.push(c)
      }
      // every node busy: the oldest call gives way to the newest
      c ??= calls.reduce((a, b) => (b.born < a.born ? b : a))
      conceal(c)
      c.hero = hero
      c.age = 0
      c.born = ++serial
      c.live = true
      c.fixed = fixed
      c.node.textContent = text
      c.node.className = `hud-callout${fixed ? ' fixed' : ''}`
      c.node.style.setProperty('--call-core', colors[0])
      c.node.style.setProperty('--call-glow', colors[1])
    },
    frame(dt, anchor, fixedAt) {
      for (const c of calls) {
        if (!c.live) continue
        c.age += dt
        if (c.age >= CALLOUT_LIFE) {
          c.live = false
          conceal(c)
          continue
        }
        const p: ScreenPoint | undefined = c.fixed ? { ...fixedAt, depth: 6, visible: true } : anchor(c.hero)
        if (!p?.visible) {
          conceal(c)
          continue
        }
        const t = c.age / CALLOUT_LIFE
        // it slams in big, settles, drifts up a little and fades over its last third
        const slam = still || c.age >= 0.12 ? 1 : 1.45 - (0.45 * c.age) / 0.12
        const rise = still ? 0 : t * 14
        const alpha = t < 0.66 ? 1 : 1 - (t - 0.66) / 0.34
        const near = c.fixed ? 1 : distanceScale(p.depth)
        // over a hero it sits above the damage numbers, which start about 30 px over the bar
        const lift = c.fixed ? 0 : 58 * near
        c.node.style.transform = `translate3d(${p.x.toFixed(1)}px, ${(p.y - lift - rise).toFixed(1)}px, 0) translate(-50%, -100%) scale(${(near * slam).toFixed(3)})`
        c.node.style.opacity = alpha.toFixed(3)
        if (!c.shown) {
          c.node.style.visibility = 'visible'
          c.shown = true
        }
      }
    },
    live: () => calls.reduce((k, c) => k + (c.live ? 1 : 0), 0),
    size: () => calls.length,
    dispose() {
      for (const c of calls) c.node.remove()
      calls.length = 0
    },
  }
}
