import { describe, expect, it } from 'vitest'
import { MAX_PER_SIDE, SPACING, autoDeploy, emptyFormation, move, place, remove } from './formation.js'

describe('staging formation (U16)', () => {
  it('refuses a hero dropped on the other half', () => {
    expect(place(emptyFormation(), 0, 0, 0, 5)).toEqual({ ok: false, reason: 'wrong-half' })
    expect(place(emptyFormation(), 1, 0, 0, 5).ok).toBe(true)
  })

  it('refuses an 11th hero on one side', () => {
    let f = emptyFormation()
    for (let i = 0; i < MAX_PER_SIDE; i++) {
      const r = place(f, 0, 0, (i % 5) * 3 - 6, -5 - Math.floor(i / 5) * 4)
      if (!r.ok) throw new Error(r.reason)
      f = r.formation
    }
    expect(place(f, 0, 0, 0, -25)).toEqual({ ok: false, reason: 'full' })
  })

  it('lets the same hero be placed three times', () => {
    let f = emptyFormation()
    for (const x of [-4, 0, 4]) {
      const r = place(f, 0, 7, x, -10)
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
})
