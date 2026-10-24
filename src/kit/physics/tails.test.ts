import { describe, expect, it } from 'vitest'
import { MAX_PARTICLES } from './cloth.js'
import { createTails, placeTails, restPoint, stepTails, tailPoint } from './tails.js'

type V3 = [number, number, number]

const point = (t: ReturnType<typeof createTails>, tail: number, i: number): V3 => {
  const k = (tail * t.points + i) * 3
  return [t.pos[k], t.pos[k + 1], t.pos[k + 2]]
}
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

describe('tails on chains', () => {
  it("fits nine tails inside a hero's particle budget, and refuses more", () => {
    const t = createTails(9, 6)
    expect(t.count * (t.points - 1)).toBeLessThanOrEqual(MAX_PARTICLES)
    expect(() => createTails(9, 9)).toThrow(/particles/)
  })

  it('stays at rest behind a hero standing still, fanned out and curling up', () => {
    const t = createTails(9, 6, 1.4)
    const root: V3 = [2, 1, -3]
    placeTails(t, root, 0, 1)
    for (let k = 0; k < 120; k++) stepTails(t, root, 0, 1, 1 / 60)
    for (let tail = 0; tail < 9; tail++) for (let i = 0; i < 6; i++) expect(dist(point(t, tail, i), restPoint(t, tail, i, root, 0, 1))).toBeLessThan(1e-3)
    // facing +z, every tip is behind the root and above it; the outer tails fan wide
    for (let tail = 0; tail < 9; tail++) {
      const tip = point(t, tail, 5)
      expect(tip[2]).toBeLessThan(root[2])
      expect(tip[1]).toBeGreaterThan(root[1])
    }
    expect(Math.abs(point(t, 0, 5)[0] - point(t, 8, 5)[0])).toBeGreaterThan(1.5)
  })

  it('trails behind a running hero, every link held at its length', () => {
    const t = createTails(9, 6, 1.4)
    const root: V3 = [0, 1, 0]
    placeTails(t, root, 0, 1)
    for (let k = 0; k < 60; k++) {
      root[2] += 8 / 60
      stepTails(t, root, 0, 1, 1 / 60)
    }
    const seg = 1.4 / 5
    for (let tail = 0; tail < 9; tail++) {
      // swept back past where it rests
      expect(point(t, tail, 5)[2]).toBeLessThan(restPoint(t, tail, 5, root, 0, 1)[2] - 0.05)
      for (let i = 1; i < 6; i++) expect(dist(point(t, tail, i), point(t, tail, i - 1))).toBeCloseTo(seg, 3)
    }
  })

  it('keeps out of the column the body stands in, even through a sudden turn', () => {
    const t = createTails(9, 6, 1.4)
    const root: V3 = [0, 1, 0]
    placeTails(t, root, 0, 1)
    const body = 0.35
    const ahead = 0.3
    for (let k = 0; k < 30; k++) stepTails(t, root, Math.PI, 1, 1 / 60, body, ahead)
    const cx = root[0] + Math.sin(Math.PI) * ahead
    const cz = root[2] + Math.cos(Math.PI) * ahead
    for (let tail = 0; tail < 9; tail++)
      for (let i = 1; i < 6; i++) {
        const p = point(t, tail, i)
        expect(Math.hypot(p[0] - cx, p[2] - cz)).toBeGreaterThanOrEqual(body - 1e-6)
      }
  })

  it('steps at a fixed rate, so a slow frame moves the tails as far as several quick ones', () => {
    const a = createTails(3, 6)
    const b = createTails(3, 6)
    const root: V3 = [0, 1, 0]
    placeTails(a, root, 0, 1)
    placeTails(b, root, 0, 1)
    root[0] = 0.5
    stepTails(a, root, 0, 1, 3 / 60)
    for (let k = 0; k < 3; k++) stepTails(b, root, 0, 1, 1 / 60)
    for (let i = 0; i < a.pos.length; i++) expect(a.pos[i]).toBeCloseTo(b.pos[i], 5)
  })

  it('smooths a ribbon down each tail from its root to its tip', () => {
    const t = createTails(9, 6)
    const root: V3 = [0, 1, 0]
    placeTails(t, root, 0.4, 1.3)
    const out = { x: 0, y: 0, z: 0 }
    tailPoint(t, 4, 0, out)
    expect(dist([out.x, out.y, out.z], root)).toBeLessThan(1e-6)
    tailPoint(t, 4, 1, out)
    expect(dist([out.x, out.y, out.z], point(t, 4, 5))).toBeLessThan(1e-6)
  })
})
