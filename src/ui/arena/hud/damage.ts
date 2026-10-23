import { distanceScale, type ScreenPoint } from './world'

/**
 * Floating damage numbers (R38): a fixed pool of DOM nodes moved straight from the frame hook, so twenty heroes
 * trading blows never re-render React. Each number pops, rises and fades over `DAMAGE_LIFE` seconds above the hero
 * it hit; when every node is busy the oldest is reused. Quick hits on one hero add up in a single number that pops
 * again with each hit, so a brawl reads as a few running totals instead of a tower of digits.
 */

export const DAMAGE_LIFE = 0.8
export const DAMAGE_CAP = 40
/** A hit this soon after the last number on the same hero adds to it, seconds. */
export const DAMAGE_MERGE = 0.4

interface Num {
  node: HTMLSpanElement
  target: number
  age: number
  /** Spawn order, so the oldest number gives way first even within one frame. */
  born: number
  live: boolean
  shown: boolean
  heavy: boolean
  own: boolean
  total: number
  /** Seconds since it last popped: at spawn, and again with every hit added to it. */
  pop: number
  dx: number
  dy: number
}

export interface DamagePool {
  spawn: (target: number, amount: number, kind?: { heavy?: boolean; own?: boolean }) => void
  /** Advance and place every live number; `anchor` gives the screen point over each hero's head this frame. */
  frame: (dt: number, anchor: (target: number) => ScreenPoint | undefined) => void
  /** Numbers on screen or still running. */
  live: () => number
  /** DOM nodes made so far; never more than the cap. */
  size: () => number
  dispose: () => void
}

export function createDamagePool(layer: HTMLElement, options: { cap?: number; reducedMotion?: boolean; random?: () => number } = {}): DamagePool {
  const cap = Math.max(1, options.cap ?? DAMAGE_CAP)
  const random = options.random ?? Math.random
  const still = options.reducedMotion ?? false
  const nums: Num[] = []
  let serial = 0

  const conceal = (n: Num) => {
    if (!n.shown) return
    n.node.style.visibility = 'hidden'
    n.shown = false
  }

  return {
    spawn(target, amount, kind = {}) {
      if (!(amount >= 0.5)) return
      const own = !!kind.own
      const running = nums.find((x) => x.live && x.target === target && x.own === own && x.age < DAMAGE_MERGE)
      if (running) {
        running.total += amount
        // it pops again where it is and lives a little longer, rather than snapping back down to start over
        running.pop = 0
        running.age = Math.min(running.age, 0.25)
        running.heavy ||= !!kind.heavy
        running.node.textContent = String(Math.round(running.total))
        running.node.className = `hud-dmg${running.heavy ? ' heavy' : ''}${own ? ' own' : ''}`
        return
      }
      let n = nums.find((x) => !x.live)
      if (!n && nums.length < cap) {
        const node = document.createElement('span')
        node.style.visibility = 'hidden'
        layer.append(node)
        n = { node, target, age: 0, born: 0, live: false, shown: false, heavy: false, own: false, total: 0, pop: 0, dx: 0, dy: 0 }
        nums.push(n)
      }
      // every node busy: the oldest number gives way to the newest
      n ??= nums.reduce((a, b) => (b.born < a.born ? b : a))
      // a reused node stays hidden until the next frame places it over its new hero
      conceal(n)
      n.target = target
      n.age = 0
      n.born = ++serial
      n.live = true
      n.heavy = !!kind.heavy
      n.own = own
      n.total = amount
      n.pop = 0
      n.dx = (random() - 0.5) * 44
      n.dy = random() * 10
      n.node.textContent = String(Math.round(amount))
      n.node.className = `hud-dmg${kind.heavy ? ' heavy' : ''}${kind.own ? ' own' : ''}`
    },
    frame(dt, anchor) {
      for (const n of nums) {
        if (!n.live) continue
        n.age += dt
        n.pop += dt
        if (n.age >= DAMAGE_LIFE) {
          n.live = false
          conceal(n)
          continue
        }
        const p = anchor(n.target)
        if (!p?.visible) {
          conceal(n)
          continue
        }
        const t = n.age / DAMAGE_LIFE
        const rise = still ? 0 : (1 - (1 - t) ** 3) * 54
        const big = n.heavy ? 1.9 : 1.55
        const p0 = n.pop / DAMAGE_LIFE
        const pop = still || p0 >= 0.14 ? 1 : big - ((big - 1) * p0) / 0.14
        const alpha = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35
        const near = distanceScale(p.depth)
        // starts just above the overhead bar and its name, which stand about 26 px tall at full size
        n.node.style.transform = `translate3d(${(p.x + n.dx * near).toFixed(1)}px, ${(p.y - (30 + n.dy) * near - rise).toFixed(1)}px, 0) translate(-50%, -100%) scale(${(near * pop).toFixed(3)})`
        n.node.style.opacity = alpha.toFixed(3)
        if (!n.shown) {
          n.node.style.visibility = 'visible'
          n.shown = true
        }
      }
    },
    live: () => nums.reduce((k, n) => k + (n.live ? 1 : 0), 0),
    size: () => nums.length,
    dispose() {
      for (const n of nums) n.node.remove()
      nums.length = 0
    },
  }
}
