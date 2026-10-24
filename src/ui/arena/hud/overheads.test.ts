// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createOverheads, type OverheadLive } from './overheads.js'
import type { ScreenPoint } from './world.js'

const live: OverheadLive = { alive: true, hp: 800, maxHp: 1000, shield: 0, ultReady: false }
const at = (x: number, y: number, depth: number): ScreenPoint => ({ x, y, depth, visible: true })

describe('overhead names in a crowd', () => {
  it('keeps the nearest name where names overlap, hides the rest, and leaves every bar up', () => {
    const layer = document.createElement('div')
    const overheads = createOverheads(layer, [0, 1, 0, 1].map((team) => ({ team: team as 0 | 1, short: 'HERO' })))
    // three heroes stacked on one spot at different distances, and one well apart
    const points = [at(400, 300, 14), at(405, 302, 10), at(398, 298, 18), at(900, 300, 16)]
    points.forEach((p, i) => overheads.update(i, p, live, false, 1 / 60))
    overheads.declutter(points)
    const crowded = overheads.items().map((el) => el.classList.contains('crowded'))
    expect(crowded).toEqual([true, false, true, false])
    expect(overheads.items().every((el) => el.style.visibility === 'visible')).toBe(true)
  })

  it('gives a name back once the crowd moves apart', () => {
    const layer = document.createElement('div')
    const overheads = createOverheads(layer, [0, 1].map((team) => ({ team: team as 0 | 1, short: 'HERO' })))
    const close = [at(400, 300, 12), at(402, 300, 14)]
    close.forEach((p, i) => overheads.update(i, p, live, false, 1 / 60))
    overheads.declutter(close)
    expect(overheads.items()[1].classList.contains('crowded')).toBe(true)
    const apart = [at(400, 300, 12), at(700, 300, 14)]
    apart.forEach((p, i) => overheads.update(i, p, live, false, 1 / 60))
    overheads.declutter(apart)
    expect(overheads.items()[1].classList.contains('crowded')).toBe(false)
  })
})
