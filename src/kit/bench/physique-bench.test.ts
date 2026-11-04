import { mkdirSync, writeFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { ARCHETYPES } from '../body/physique.js'
import { benchArchetype, BENCH_CLIPS, type ArchetypeScore, type ClipScore } from './physique-bench.js'

/**
 * The physique bench's scores (GAME.md §9.7) over every archetype and key clip. BENCH_WRITE=1 also writes them to
 * src/kit/bench/physique-bench.json, the record regressions are read against.
 */
let scores: ArchetypeScore[]

beforeAll(async () => {
  scores = []
  for (const id of ARCHETYPES) scores.push(await benchArchetype(id))
  if (process.env.BENCH_WRITE) {
    mkdirSync('docs/bench', { recursive: true })
    writeFileSync('src/kit/bench/physique-bench.json', `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), clips: BENCH_CLIPS, scores }, null, 1)}\n`)
  }
}, 120000)

const played = (s: ArchetypeScore) => Object.values(s.clips).filter((c): c is ClipScore => c !== 'missing')

describe('the physique bench (§9.7)', () => {
  it('scores every archetype on every key clip the library has, and says which it lacks', () => {
    expect(scores).toHaveLength(ARCHETYPES.length)
    for (const s of scores) {
      expect(s.clips.mantle).toBe('missing')
      for (const c of played(s)) {
        for (const v of [c.raw.penetration.worst, c.fixed.penetration.worst, c.footSlide, c.raw.limits.worst]) expect(Number.isFinite(v), `${s.archetype} ${c.clip}`).toBe(true)
        expect(c.frames).toBeGreaterThan(1)
      }
    }
  })

  it('keeps every retargeted clip and its fix-ups inside the joint limits', () => {
    for (const s of scores) for (const c of played(s)) expect(c.fixed.limits.violations, `${s.archetype} ${c.clip}`).toBe(0)
  })

  it('never lets a fix-up push limbs further into the body, and spreads the bulky ones clear', () => {
    for (const s of scores) for (const c of played(s)) expect(c.fixed.penetration.worst, `${s.archetype} ${c.clip}`).toBeLessThanOrEqual(c.raw.penetration.worst + 0.5)
    const heavy = scores.find((s) => s.archetype === 'heavyweight')!.clips.jog as ClipScore
    expect(heavy.fixed.penetration.worst).toBeLessThan(heavy.raw.penetration.worst / 2)
  })

  it('brings the off hand onto a two-handed grip', () => {
    for (const s of scores) {
      const c = s.clips.heavy as ClipScore
      if (c.raw.grip === undefined) continue
      expect(c.fixed.grip!, s.archetype).toBeLessThanOrEqual(c.raw.grip)
    }
  })
})
