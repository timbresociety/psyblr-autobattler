import type { Team } from '../../../arena/engine/state.js'
import { segmentPct } from './format.js'
import { statusKey, type HeroStatus } from './status.js'
import { FAR_METRES, distanceScale, type ScreenPoint } from './world.js'

/**
 * A health bar over every living hero, both sides (R38): team colour, a tick every 250 health, shields as a white
 * overlay, a trailing chunk that shows the last hit draining away, the hero's short name and a pip that lights when
 * the ultimate is ready. One DOM node per hero, made once and moved from the frame hook; a style is written only
 * when the value it shows changes.
 */

export interface OverheadHero {
  team: Team
  short: string
}

export interface OverheadLive {
  alive: boolean
  hp: number
  maxHp: number
  shield: number
  ultReady: boolean
  /** What is on the hero, worst first; the top two show under the bar. */
  statuses?: readonly HeroStatus[]
}

interface Item {
  root: HTMLDivElement
  bar: HTMLElement
  hp: HTMLElement
  trail: HTMLElement
  shield: HTMLElement
  ult: HTMLElement
  st: HTMLElement
  stKey: string
  shown: boolean
  far?: boolean
  crowded?: boolean
  low?: boolean
  ready?: boolean
  maxHp: number
  hpShown: number
  trailShown: number
  shieldKey: string
  /** The trailing chunk's level and how long it has held since the last drop. */
  trailLevel: number
  hold: number
}

const q = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 1000) / 1000
/** Seconds the trailing chunk holds after a hit, then how much of the bar it drains per second. */
const TRAIL_HOLD = 0.35
const TRAIL_RATE = 0.9
/** How many statuses show under a bar: the worst two, so a pile of debuffs never buries the one that matters. */
const STATUS_SHOWN = 2
/** The name row's box at scale 1, in pixels: its width, its height, and how far above the overhead's foot it starts. */
const NAME = { w: 70, h: 13, above: 23 }

export function createOverheads(layer: HTMLElement, heroes: readonly OverheadHero[]) {
  const items: Item[] = heroes.map((h) => {
    const root = document.createElement('div')
    root.className = `hud-oh team-${h.team}`
    root.style.visibility = 'hidden'
    root.innerHTML = '<div class="hud-oh-top"><span class="hud-oh-name"></span><i class="hud-oh-ult"></i></div><div class="hud-oh-bar"><i class="hud-oh-trail"></i><i class="hud-oh-hp"></i><i class="hud-oh-sh"></i></div><div class="hud-oh-st"></div>'
    root.querySelector('.hud-oh-name')!.textContent = h.short
    layer.append(root)
    const part = (c: string) => root.querySelector<HTMLElement>(c)!
    return { root, bar: part('.hud-oh-bar'), hp: part('.hud-oh-hp'), trail: part('.hud-oh-trail'), shield: part('.hud-oh-sh'), ult: part('.hud-oh-ult'), st: part('.hud-oh-st'), stKey: '', shown: false, maxHp: -1, hpShown: -1, trailShown: -1, shieldKey: '', trailLevel: 1, hold: 0 }
  })

  const order: number[] = []
  const placed: number[] = []
  return {
    items: () => items.map((i) => i.root),
    /**
     * After every hero is updated: a name that would sit on a nearer hero's name gives way and keeps only its bar,
     * so a melee of twenty still reads. Nearest first, so the heroes closest to the camera keep their names.
     */
    declutter(points: readonly ScreenPoint[]) {
      order.length = 0
      for (let i = 0; i < items.length; i++) if (items[i].shown && !items[i].far && points[i]) order.push(i)
      order.sort((a, b) => points[a].depth - points[b].depth)
      placed.length = 0
      for (const i of order) {
        const p = points[i]
        const s = distanceScale(p.depth)
        const w = NAME.w * s
        const x0 = p.x - w / 2
        const y0 = p.y - NAME.above * s
        const y1 = y0 + NAME.h * s
        let hit = false
        for (let k = 0; k < placed.length && !hit; k += 4) hit = x0 < placed[k + 2] && placed[k] < x0 + w && y0 < placed[k + 3] && placed[k + 1] < y1
        if (!hit) placed.push(x0, y0, x0 + w, y1)
        const it = items[i]
        if (hit !== !!it.crowded) it.root.classList.toggle('crowded', (it.crowded = hit))
      }
    },
    /** One hero, one frame. `hidden` drops the bar (the controlled hero, whose own HUD shows its health). */
    update(i: number, p: ScreenPoint, live: OverheadLive, hidden: boolean, dt: number) {
      const it = items[i]
      if (!it) return
      const hpF = q(live.hp / Math.max(1, live.maxHp))
      if (hpF >= it.trailLevel) {
        it.trailLevel = hpF
        it.hold = 0
      } else if ((it.hold += dt) > TRAIL_HOLD) it.trailLevel = Math.max(hpF, it.trailLevel - dt * TRAIL_RATE)

      if (!live.alive || hidden || !p.visible) {
        if (it.shown) {
          it.root.style.visibility = 'hidden'
          it.shown = false
        }
        return
      }
      if (!it.shown) {
        it.root.style.visibility = 'visible'
        it.shown = true
      }
      it.root.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${distanceScale(p.depth).toFixed(3)})`
      const far = p.depth > FAR_METRES
      if (far !== it.far) it.root.classList.toggle('far', (it.far = far))
      if (live.maxHp !== it.maxHp) it.bar.style.setProperty('--seg', segmentPct((it.maxHp = live.maxHp)))
      if (hpF !== it.hpShown) {
        it.hp.style.transform = `scaleX(${(it.hpShown = hpF)})`
        const low = hpF < 0.3
        if (low !== it.low) it.root.classList.toggle('low', (it.low = low))
      }
      const trail = q(it.trailLevel)
      if (trail !== it.trailShown) it.trail.style.transform = `scaleX(${(it.trailShown = trail)})`
      const shF = q(live.shield / Math.max(1, live.maxHp))
      const key = `${shF}|${hpF}`
      if (key !== it.shieldKey) {
        it.shieldKey = key
        // the shield sits on the end of the health, pushed back inside the bar when the two overflow it
        it.shield.style.transform = `translateX(${(Math.min(hpF, 1 - shF) * 100).toFixed(1)}%) scaleX(${shF})`
      }
      if (live.ultReady !== it.ready) it.ult.classList.toggle('ready', (it.ready = live.ultReady))
      const statuses = live.statuses ?? []
      const shown = statusKey(statuses, STATUS_SHOWN)
      if (shown !== it.stKey) {
        it.stKey = shown
        it.st.replaceChildren(
          ...statuses.slice(0, STATUS_SHOWN).map((st) => {
            const chip = document.createElement('i')
            chip.className = `hud-oh-chip tone-${st.tone}`
            chip.textContent = st.label
            return chip
          }),
        )
      }
    },
    dispose() {
      for (const it of items) it.root.remove()
    },
  }
}
