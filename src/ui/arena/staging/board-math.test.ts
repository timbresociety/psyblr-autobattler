import { PerspectiveCamera } from 'three'
import { describe, expect, it } from 'vitest'
import { ENGINE } from '../../../arena/engine/calibration'
import { BOARD_FOV, applyView, clampView, fitDistance, floorPoint, homeView, judge, limitsFor, matchSlots, orbit, pan, pick, reasonText, toNdc, toScreen, wrapAngle, zoom, type Standee, type View } from './board-math'
import { MAX_PER_SIDE, deployHeroes, emptyFormation, place } from './formation'

const { halfWidth: W, halfLength: L } = ENGINE.arena

function cameraFor(view: View, aspect = 1.4) {
  const camera = new PerspectiveCamera(BOARD_FOV, aspect, 0.5, 1200)
  applyView(camera, view)
  return camera
}

describe('the staging camera', () => {
  it('starts behind your own half and shows the whole arena', () => {
    for (const side of [0, 1] as const) {
      const home = homeView(side, 1.4)
      const camera = cameraFor(home)
      // the camera sits behind the side's own half (side 0 holds z < 0)
      expect(Math.sign(camera.position.z)).toBe(side === 0 ? -1 : 1)
      for (const x of [-W, W])
        for (const z of [-L, L]) {
          const p = toScreen(camera, x, 0, z, 1400, 1000)
          expect(p.visible).toBe(true)
          expect(p.x).toBeGreaterThan(0)
          expect(p.x).toBeLessThan(1400)
          expect(p.y).toBeGreaterThan(0)
          expect(p.y).toBeLessThan(1000)
        }
      // your half is the nearer one: it fills the bottom of the frame
      expect(toScreen(camera, 0, 0, side === 0 ? -L : L, 1400, 1000).y).toBeGreaterThan(toScreen(camera, 0, 0, side === 0 ? L : -L, 1400, 1000).y)
    }
  })

  it('fits as close as it can: any nearer and a corner leaves the frame', () => {
    const home = homeView(0, 1.4)
    expect(fitDistance(home, 1.4)).toBeCloseTo(home.distance, 3)
    const camera = cameraFor({ ...home, distance: home.distance * 0.9 })
    const corners = [-W, W].flatMap((x) => [-L, L].map((z) => toScreen(camera, x, 0, z, 1400, 1000)))
    expect(corners.some((p) => p.x < 0 || p.x > 1400 || p.y < 0 || p.y > 1000)).toBe(true)
  })

  it('a wider board can come closer', () => {
    expect(homeView(0, 2).distance).toBeLessThan(homeView(0, 1.2).distance)
  })

  it('orbits gently: the turn and the tilt stop at their limits', () => {
    const home = homeView(0, 1.4)
    const lim = limitsFor(home)
    const far = orbit(home, -100_000, 100_000, lim)
    expect(far.yaw).toBeCloseTo(lim.yawRange, 6)
    expect(far.pitch).toBeCloseTo(lim.pitch[1], 6)
    const low = orbit(home, 100_000, -100_000, lim)
    expect(low.yaw).toBeCloseTo(-lim.yawRange, 6)
    expect(low.pitch).toBeCloseTo(lim.pitch[0], 6)
    // the far side's home turns about π, the short way round
    const red = limitsFor(homeView(1, 1.4))
    expect(Math.abs(wrapAngle(orbit(red.home, 50, 0, red).yaw - Math.PI))).toBeCloseTo(0.3, 6)
  })

  it('zooms toward the spot under the pointer and never past its limits', () => {
    const home = homeView(0, 1.4)
    const lim = limitsFor(home)
    const spot = { x: 20, z: -12 }
    const closer = zoom(home, -400, spot, lim)
    expect(closer.distance).toBeLessThan(home.distance)
    const before = Math.hypot(home.target.x - spot.x, home.target.z - spot.z)
    expect(Math.hypot(closer.target.x - spot.x, closer.target.z - spot.z)).toBeLessThan(before)
    let v = home
    for (let i = 0; i < 40; i++) v = zoom(v, -300, spot, lim)
    expect(v.distance).toBeCloseTo(lim.minDistance, 6)
    for (let i = 0; i < 40; i++) v = zoom(v, 300, spot, lim)
    expect(v.distance).toBeCloseTo(lim.maxDistance, 6)
    // zoomed back out, the view returns to the middle so the whole arena shows again
    expect(v.target).toEqual(home.target)
  })

  it('pans only while zoomed in, and never off the arena', () => {
    const home = homeView(0, 1.4)
    const lim = limitsFor(home)
    expect(pan(home, 15, 15, lim).target).toEqual(home.target)
    const close = clampView({ ...home, distance: lim.minDistance }, lim)
    const moved = pan(close, 1000, -1000, lim)
    expect(moved.target.x).toBeCloseTo(home.target.x + W, 6)
    expect(moved.target.z).toBeCloseTo(home.target.z - L, 6)
  })
})

describe('pointer and floor', () => {
  it('maps a pointer to the floor spot under it, and back to the same pixel', () => {
    const camera = cameraFor(homeView(0, 1.4))
    const box = { left: 100, top: 50, width: 1400, height: 1000 }
    for (const [x, z] of [
      [0, 0],
      [-25, -18],
      [31, 22],
    ]) {
      const s = toScreen(camera, x, 0, z, box.width, box.height)
      const ndc = toNdc(box.left + s.x, box.top + s.y, box)
      const hit = floorPoint(camera, ndc.x, ndc.y)!
      expect(hit.x).toBeCloseTo(x, 4)
      expect(hit.z).toBeCloseTo(z, 4)
    }
  })

  it('finds no floor where the pointer is on the sky', () => {
    const camera = cameraFor({ yaw: 0, pitch: 0.2, distance: 60, target: { x: 0, z: 0 } })
    expect(floorPoint(camera, 0, 0.99)).toBeUndefined()
  })

  it('picks the hero under the pointer, by its feet, its body or its badge', () => {
    const at = (x: number, y: number) => ({ x, y, visible: true })
    const standees: (Standee | undefined)[] = [{ foot: at(100, 200), top: at(100, 160) }, undefined, { foot: at(300, 210), top: at(300, 170) }]
    expect(pick(standees, 102, 198)).toBe(0)
    expect(pick(standees, 99, 165)).toBe(0)
    expect(pick(standees, 305, 205)).toBe(2)
    expect(pick(standees, 200, 190)).toBeUndefined()
    // overlapping figures: the one nearer the camera (lower on screen) wins
    const crowd = [{ foot: at(100, 200), top: at(100, 160) }, { foot: at(101, 204), top: at(101, 164) }]
    expect(pick(crowd, 100, 185)).toBe(1)
  })
})

describe('the ghost judges a spot with the formation rules', () => {
  it('says why a spot will not take the hero', () => {
    const f = emptyFormation()
    expect(judge(f, { side: 0, hero: 0 }, { x: 0, z: -12 })).toEqual({ kind: 'ok' })
    expect(judge(f, { side: 0, hero: 0 }, { x: 0, z: 12 })).toEqual({ kind: 'bad', reason: 'wrong-half' })
    expect(judge(f, { side: 0, hero: 0 }, { x: -21, z: -8.5 })).toEqual({ kind: 'bad', reason: 'in-ruins' })
    expect(judge(f, { side: 0, hero: 0 }, { x: W - 0.5, z: -12 })).toEqual({ kind: 'bad', reason: 'edge' })
    expect(judge(f, { side: 0, hero: 0 }, { x: 0, z: -L - 5 })).toEqual({ kind: 'bad', reason: 'off-arena' })
    expect(judge(f, { side: 0, hero: 0 }, undefined)).toEqual({ kind: 'bad', reason: 'off-arena' })
    const one = place(f, 0, 3, 0, -12)
    if (!one.ok) throw new Error('setup')
    expect(judge(one.formation, { side: 0, hero: 1 }, { x: 1, z: -12 })).toEqual({ kind: 'bad', reason: 'crowded' })
    const full = deployHeroes(f, 1, Array.from({ length: MAX_PER_SIDE }, (_, i) => i))
    expect(judge(full, { side: 1, hero: 0 }, { x: 0, z: 26 })).toEqual({ kind: 'bad', reason: 'full' })
  })

  it('a placed hero may move onto its own old spot, and goes back to the row when let go off the arena', () => {
    const r = place(emptyFormation(), 1, 2, 4, 12)
    if (!r.ok) throw new Error('setup')
    expect(judge(r.formation, { side: 1, hero: 2, index: 0 }, { x: 4.5, z: 12 })).toEqual({ kind: 'ok' })
    expect(judge(r.formation, { side: 1, hero: 2, index: 0 }, { x: 0, z: L + 6 })).toEqual({ kind: 'remove' })
    expect(judge(r.formation, { side: 1, hero: 2, index: 0 }, undefined)).toEqual({ kind: 'remove' })
  })

  it('captions each reason from the point of view of the side being set up', () => {
    expect(reasonText('wrong-half', 0, 0)).toBe('Not here: the enemy half')
    expect(reasonText('wrong-half', 1, 0)).toBe('Not here: your half')
    expect(reasonText('in-ruins', 0, 0)).toBe('Not here: inside the ruins')
    expect(reasonText('full', 1, 0)).toBe(`The enemy side is full (${MAX_PER_SIDE} of ${MAX_PER_SIDE})`)
  })
})

describe('figures follow the formation without being rebuilt', () => {
  const slot = (side: 0 | 1, key: string, x: number, z: number) => ({ side, key, x, z })

  it('keeps a hero that stayed, follows one that moved, and makes new ones for the rest', () => {
    const current = [slot(0, 'a', 0, -10), slot(0, 'b', 4, -10), slot(1, 'a', 0, 10)]
    // b moved, a stayed, a second a arrived, and the red a left
    const next = [slot(0, 'a', 0, -10), slot(0, 'b', 8, -14), slot(0, 'a', -4, -10)]
    expect(matchSlots(current, next)).toEqual([0, 1, -1])
  })

  it('never hands one figure to two placements, nor a figure across sides', () => {
    const current = [slot(0, 'a', 0, -10)]
    expect(matchSlots(current, [slot(1, 'a', 0, 10), slot(0, 'a', 2, -10), slot(0, 'a', 0, -12)])).toEqual([-1, 0, -1])
  })
})
