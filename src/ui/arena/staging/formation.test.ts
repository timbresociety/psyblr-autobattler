import { describe, expect, it } from 'vitest'
import { LEVEL } from '../../../arena/engine/house.js'
import { BOUNDS, MAX_PER_SIDE, SPACING, autoDeploy, emptyFormation, landingOf, move, place, remove, standAt } from './formation.js'

describe('staging formation (U16)', () => {
  it('refuses a hero dropped on the other half', () => {
    expect(place(emptyFormation(), 0, 0, 0, 36)).toEqual({ ok: false, reason: 'wrong-half' })
    expect(place(emptyFormation(), 1, 0, 0, 36).ok).toBe(true)
  })

  it('refuses an 11th hero on one side', () => {
    let f = emptyFormation()
    for (let i = 0; i < MAX_PER_SIDE; i++) {
      const r = place(f, 0, 0, (i % 5) * 3 - 6, -35 - Math.floor(i / 5) * 3)
      if (!r.ok) throw new Error(r.reason)
      f = r.formation
    }
    expect(place(f, 0, 0, 0, -30)).toEqual({ ok: false, reason: 'full' })
  })

  it('lets the same hero be placed three times', () => {
    let f = emptyFormation()
    for (const x of [-4, 0, 4]) {
      const r = place(f, 0, 7, x, -12)
      if (!r.ok) throw new Error(r.reason)
      f = r.formation
    }
    expect(f[0].map((p) => p.hero)).toEqual([7, 7, 7])
  })

  it('moves a placed hero to a free spot, refuses a spot on another hero, and removes', () => {
    let f = emptyFormation()
    for (const x of [-4, 4]) f = (place(f, 1, 0, x, 8) as { formation: typeof f }).formation
    expect(move(f, 1, 0, 4 + SPACING / 2, 8)).toEqual({ ok: false, reason: 'crowded' })
    const moved = move(f, 1, 0, 0, 12)
    expect(moved.ok && moved.formation[1][0]).toEqual({ hero: 0, x: 0, z: 12 })
    expect(remove(f, 1, 0)[1]).toHaveLength(1)
  })

  it('auto-deploy fills a side to the chosen size on its half with no overlaps', () => {
    for (const count of [1, 6, 10]) {
      const f = autoDeploy(emptyFormation(), 1, 4, count)
      expect(f[1]).toHaveLength(count)
      expect(f[1].every((p) => p.z > 0)).toBe(true)
      for (const a of f[1]) for (const b of f[1]) if (a !== b) expect((a.x - b.x) ** 2 + (a.z - b.z) ** 2).toBeGreaterThanOrEqual(SPACING ** 2)
    }
    expect(autoDeploy(emptyFormation(), 0, 3, 10)[0].map((p) => p.hero).slice(0, 4)).toEqual([0, 1, 2, 0])
  })

  it('places on any level: a machine island top, the concourse, a deck over a hero below (owner, 2026-11-03)', () => {
    // Pachinko Alley's island at x 61.5-63.5: its top is a level of its own, and the pointer finds it from above
    const top = LEVEL.main + 5.4
    const seen = landingOf({ x: 62.5, y: 80, z: -2 }, { x: 0, y: -1, z: 0.01 })
    expect(seen?.y).toBeCloseTo(top, 3)
    const r = place(emptyFormation(), 0, 0, 62.5, -2, seen!.y)
    if (!r.ok) throw new Error(r.reason)
    expect(r.formation[0][0].y).toBeCloseTo(top, 3)
    expect(standAt(62.5, -2, r.formation[0][0].y)).toBeCloseTo(top, 3)
    // on the main floor there it would be inside the island
    expect(place(emptyFormation(), 0, 0, 62.5, -2)).toEqual({ ok: false, reason: 'in-ruins' })
    // the concourse past the old 56 m bounds is part of each half
    expect(BOUNDS.halfWidth).toBeGreaterThan(70)
    expect(place(emptyFormation(), 0, 0, 68, -20).ok).toBe(true)
    // a hero on the island and one on the floor beside it are on different levels, not crowded
    const up = place(emptyFormation(), 0, 0, 61.8, -16, top)
    if (!up.ok) throw new Error(up.reason)
    expect(place(up.formation, 0, 1, 60.4, -16).ok).toBe(true)
    expect(place(up.formation, 0, 1, 62.5, -16.5, top)).toEqual({ ok: false, reason: 'crowded' })
    // met side-on, the pointer lands on the floor in front of the island
    const side = landingOf({ x: 50, y: LEVEL.main + 2, z: -2 }, { x: 1, y: -0.02, z: 0 })
    expect(side!.x).toBeLessThan(61.5)
    expect(side!.y).toBeCloseTo(LEVEL.main, 3)
  })
})
