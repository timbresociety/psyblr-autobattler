import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HEAD_SHAPES, SCULPT_FEATURES, SCULPT_IDS, hydrateSculpt, sculptWeights, shapeId } from './sculpt'

const basis = JSON.parse(readFileSync(new URL('../../../public/kit/face-basis.json', import.meta.url), 'utf8')) as { groups: { name: string }[] | string[] }
const groups = basis.groups.map((g) => (typeof g === 'string' ? g : g.name))

describe('sculpting a face', () => {
  it('moves only targets the face basis has: both ends of every slider and every head shape', () => {
    const have = new Set(groups)
    for (const f of SCULPT_FEATURES) {
      expect(have.has(f.up), `${f.id} up: ${f.up}`).toBe(true)
      expect(have.has(f.down!), `${f.id} down: ${f.down}`).toBe(true)
    }
    for (const s of HEAD_SHAPES) expect(have.has(`head-${s}`), s).toBe(true)
    expect(new Set(SCULPT_IDS).size).toBe(SCULPT_IDS.length)
  })

  it('keeps known sliders only, each held to its range and rounded, and nothing when nothing is left', () => {
    expect(hydrateSculpt({ eye_size: 1.7, nose_width: -3, shape_round: -0.5, shape_square: 2, chin_width: 0.123456, mouth_width: 0, head_width: '0.5', bogus: 0.4, forehead: Number.NaN })).toEqual({
      eye_size: 1,
      nose_width: -1,
      shape_square: 1,
      chin_width: 0.12,
    })
    expect(hydrateSculpt({ bogus: 1, eye_size: 0.001 })).toBeUndefined()
    expect(hydrateSculpt(undefined)).toBeUndefined()
    expect(hydrateSculpt('eye_size')).toBeUndefined()
  })

  it('puts a slider on its high target above zero and its low one below, by size, and a head shape on its own', () => {
    const w = sculptWeights({ eye_size: 0.5, nose_width: -0.25, [shapeId('diamond')]: 0.6 }, groups)!
    const at = (g: string) => w[groups.indexOf(g)]
    expect(at('l-eye-scale-incr+r-eye-scale-incr')).toBeCloseTo(0.5)
    expect(at('l-eye-scale-decr+r-eye-scale-decr')).toBe(0)
    expect(at('nose-scale-horiz-decr')).toBeCloseTo(0.25)
    expect(at('nose-scale-horiz-incr')).toBe(0)
    expect(at('head-diamond')).toBeCloseTo(0.6)
    expect(w.filter(Boolean)).toHaveLength(3)
  })

  it('moves nothing for no sculpt, or one whose targets the basis lacks', () => {
    expect(sculptWeights(undefined, groups)).toBeUndefined()
    expect(sculptWeights({ eye_size: 0.5 }, ['head-oval'])).toBeUndefined()
  })
})
